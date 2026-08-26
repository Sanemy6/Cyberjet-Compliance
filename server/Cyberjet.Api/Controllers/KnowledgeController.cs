using Cyberjet.Api.Contracts;
using Cyberjet.Api.Data;
using Cyberjet.Api.Middleware;
using Cyberjet.Api.Services;
using Cyberjet.Api.Services.Search;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Cyberjet.Api.Controllers;

/// <summary>
/// Base de connaissance : le patrimoine de réponses réutilisables.
///
/// Règle structurante, reprise telle quelle du moteur : une entrée rattachée à
/// un client n'est jamais proposée pour un autre. Seules les entrées génériques
/// (<c>ClientId</c> nul) sont partagées entre les dossiers.
/// </summary>
[ApiController]
[Route("api/kb")]
public sealed class KnowledgeController(
    AppDbContext db, AuditService audit, SearchEngine engine) : ControllerBase
{
    private static readonly string[] AllowedStatuses = ["validated", "draft", "obsolete"];

    private static string ValidateStatus(string? status)
    {
        var value = string.IsNullOrWhiteSpace(status) ? "validated" : status.Trim();
        if (!AllowedStatuses.Contains(value))
            throw ApiException.Unprocessable(
                $"Statut « {value} » inconnu. Attendu : {string.Join(", ", AllowedStatuses)}.");
        return value;
    }

    [HttpGet]
    public async Task<List<KbEntryResponse>> List(
        [FromQuery] int? clientId,
        [FromQuery] bool includeGeneric = true,
        [FromQuery] string q = "",
        [FromQuery] string category = "",
        [FromQuery] string status = "",
        [FromQuery] int? controlId = null,
        [FromQuery] int limit = 400,
        CancellationToken ct = default)
    {
        var query = db.KbEntries.AsNoTracking().AsQueryable();

        if (clientId is not null)
        {
            query = includeGeneric
                ? query.Where(e => e.ClientId == clientId || e.ClientId == null)
                : query.Where(e => e.ClientId == clientId);
        }
        else if (!includeGeneric)
        {
            query = query.Where(e => e.ClientId != null);
        }

        var term = q.Trim();
        if (term.Length > 0)
        {
            var like = $"%{term}%";
            query = query.Where(e => EF.Functions.Like(e.Question, like)
                                  || EF.Functions.Like(e.Answer, like)
                                  || EF.Functions.Like(e.Tags, like));
        }
        if (!string.IsNullOrWhiteSpace(category)) query = query.Where(e => e.Category == category);
        if (!string.IsNullOrWhiteSpace(status)) query = query.Where(e => e.Status == status);
        if (controlId is not null)
            query = query.Where(e => e.Controls.Any(link => link.ControlId == controlId));

        var rows = await query
            .OrderByDescending(e => e.UpdatedAt)
            .Take(Math.Clamp(limit, 1, 2000))
            .Select(e => new
            {
                Entry = e,
                ClientName = e.Client != null ? e.Client.Name : null,
                Controls = e.Controls
                    .OrderBy(link => link.Control.Framework.SortOrder)
                    .ThenBy(link => link.Control.SortOrder)
                    .Select(link => new ControlChipResponse(
                        link.Control.Id, link.Control.Ref, link.Control.Title,
                        link.Control.Framework.Code, link.Control.Framework.Accent))
                    .ToList(),
            })
            .ToListAsync(ct);

        return [.. rows.Select(r => Mapper.ToKbEntry(r.Entry, r.ClientName, r.Controls))];
    }

    [HttpGet("categories")]
    public async Task<List<KbCategoryCount>> Categories(CancellationToken ct)
    {
        // Type anonyme puis construction en mémoire : EF Core ne sait pas
        // traduire un GroupBy qui projette dans le constructeur d'un record.
        var rows = await db.KbEntries.AsNoTracking()
            .GroupBy(e => e.Category)
            .Select(g => new { Category = g.Key, N = g.Count() })
            .OrderBy(row => row.Category)
            .ToListAsync(ct);

        return [.. rows.Select(row => new KbCategoryCount(row.Category, row.N))];
    }

    [HttpPost]
    [ProducesResponseType(StatusCodes.Status201Created)]
    public async Task<ActionResult<KbEntryResponse>> Create(KbRequest payload, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var status = ValidateStatus(payload.Status);
        var question = payload.Question.Trim();

        var entry = new KbEntry
        {
            ClientId = payload.ClientId,
            Question = question,
            Answer = payload.Answer.Trim(),
            Category = string.IsNullOrWhiteSpace(payload.Category) ? "Général" : payload.Category,
            Tags = payload.Tags ?? "",
            Status = status,
            Evidence = Mapper.CleanText(payload.Evidence),
            Source = Mapper.CleanText(payload.Source),
            CreatedAt = now,
            UpdatedAt = now,
            ReviewedAt = status == "validated" ? now : null,
        };
        db.KbEntries.Add(entry);
        await db.SaveChangesAsync(ct);

        await SetControlsAsync(entry.Id, payload.ControlIds, ct);
        engine.Invalidate();

        // On journalise la question — elle identifie l'entrée — mais jamais la
        // réponse : c'est le contenu de conformité du client, il n'a rien à faire
        // dupliqué dans un journal consultable par tout administrateur.
        await audit.RecordAsync("kb.created", actor: HttpContext.CurrentUser(),
            targetType: "kb_entry", targetId: entry.Id, targetLabel: question,
            detail: $"{await Mapper.ScopeLabelAsync(db, payload.ClientId, ct)} · "
                  + $"{entry.Category} · statut {status}", ct: ct);

        return StatusCode(StatusCodes.Status201Created, await DetailAsync(entry.Id, ct));
    }

    [HttpPut("{entryId:int}")]
    public async Task<KbEntryResponse> Update(int entryId, KbRequest payload, CancellationToken ct)
    {
        var entry = await db.KbEntries.FirstOrDefaultAsync(e => e.Id == entryId, ct)
            ?? throw ApiException.NotFound("Entrée introuvable.");

        var status = ValidateStatus(payload.Status);
        var question = payload.Question.Trim();
        var answer = payload.Answer.Trim();

        var changes = new List<string>();
        if (entry.Answer != answer) changes.Add("réponse modifiée");
        if (entry.Status != status) changes.Add($"statut {entry.Status} → {status}");
        if (entry.ClientId != payload.ClientId)
            changes.Add($"portée → {await Mapper.ScopeLabelAsync(db, payload.ClientId, ct)}");

        entry.ClientId = payload.ClientId;
        entry.Question = question;
        entry.Answer = answer;
        entry.Category = string.IsNullOrWhiteSpace(payload.Category) ? "Général" : payload.Category;
        entry.Tags = payload.Tags ?? "";
        entry.Status = status;
        entry.Evidence = Mapper.CleanText(payload.Evidence);
        entry.Source = Mapper.CleanText(payload.Source);
        entry.UpdatedAt = DateTime.UtcNow;
        if (status == "validated") entry.ReviewedAt = DateTime.UtcNow;

        await db.SaveChangesAsync(ct);
        await SetControlsAsync(entryId, payload.ControlIds, ct);
        engine.Invalidate();

        await audit.RecordAsync("kb.updated", actor: HttpContext.CurrentUser(),
            targetType: "kb_entry", targetId: entryId, targetLabel: question,
            detail: changes.Count > 0 ? string.Join(" ; ", changes) : "métadonnées", ct: ct);

        return await DetailAsync(entryId, ct);
    }

    [HttpDelete("{entryId:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(int entryId, CancellationToken ct)
    {
        var entry = await db.KbEntries.FirstOrDefaultAsync(e => e.Id == entryId, ct)
            ?? throw ApiException.NotFound("Entrée introuvable.");

        var scope = await Mapper.ScopeLabelAsync(db, entry.ClientId, ct);
        var question = entry.Question;

        db.KbEntries.Remove(entry);
        await db.SaveChangesAsync(ct);
        engine.Invalidate();

        await audit.RecordAsync("kb.deleted", actor: HttpContext.CurrentUser(),
            targetType: "kb_entry", targetId: entryId, targetLabel: question,
            detail: scope, ct: ct);

        return NoContent();
    }

    private async Task SetControlsAsync(int entryId, List<int>? controlIds, CancellationToken ct)
    {
        await db.KbEntryControls.Where(link => link.KbEntryId == entryId).ExecuteDeleteAsync(ct);
        if (controlIds is null || controlIds.Count == 0) return;

        // Distinct : le sélecteur de l'interface peut renvoyer deux fois le même
        // contrôle, et la clé primaire composite lèverait alors une violation.
        var existing = await db.Controls
            .Where(c => controlIds.Contains(c.Id))
            .Select(c => c.Id)
            .ToListAsync(ct);

        foreach (var controlId in existing.Distinct())
            db.KbEntryControls.Add(new KbEntryControl { KbEntryId = entryId, ControlId = controlId });

        await db.SaveChangesAsync(ct);
    }

    private async Task<KbEntryResponse> DetailAsync(int entryId, CancellationToken ct)
    {
        var row = await db.KbEntries.AsNoTracking()
            .Where(e => e.Id == entryId)
            .Select(e => new
            {
                Entry = e,
                ClientName = e.Client != null ? e.Client.Name : null,
                Controls = e.Controls
                    .OrderBy(link => link.Control.Framework.SortOrder)
                    .ThenBy(link => link.Control.SortOrder)
                    .Select(link => new ControlChipResponse(
                        link.Control.Id, link.Control.Ref, link.Control.Title,
                        link.Control.Framework.Code, link.Control.Framework.Accent))
                    .ToList(),
            })
            .FirstOrDefaultAsync(ct)
            ?? throw ApiException.NotFound("Entrée introuvable.");

        return Mapper.ToKbEntry(row.Entry, row.ClientName, row.Controls);
    }
}
