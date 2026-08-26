using Cyberjet.Api.Contracts;
using Cyberjet.Api.Data;
using Cyberjet.Api.Middleware;
using Cyberjet.Api.Services;
using Cyberjet.Api.Services.Search;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Cyberjet.Api.Controllers;

[ApiController]
[Route("api/clients")]
public sealed class ClientsController(
    AppDbContext db, AuditService audit, SearchEngine engine) : ControllerBase
{
    private static readonly string[] AllowedStatuses = ["prospect", "actif", "archivé"];

    private static string ValidateStatus(string? status)
    {
        var value = string.IsNullOrWhiteSpace(status) ? "actif" : status.Trim();
        if (!AllowedStatuses.Contains(value))
            throw ApiException.Unprocessable(
                $"Statut « {value} » inconnu. Attendu : {string.Join(", ", AllowedStatuses)}.");
        return value;
    }

    [HttpGet]
    public async Task<List<ClientResponse>> List(CancellationToken ct) =>
        await db.Clients
            .OrderBy(c => c.Name)
            .Select(c => new ClientResponse(
                c.Id, c.Name, c.Country, c.Contact, c.Description, c.Status,
                c.CreatedAt, c.UpdatedAt,
                c.KbEntries.Count, c.ConfigItems.Count, c.Questionnaires.Count))
            .ToListAsync(ct);

    [HttpPost]
    [ProducesResponseType(StatusCodes.Status201Created)]
    public async Task<ActionResult<ClientResponse>> Create(ClientRequest payload, CancellationToken ct)
    {
        var name = payload.Name.Trim();
        if (await db.Clients.AnyAsync(c => c.Name == name, ct))
            throw ApiException.Conflict("Un client porte déjà ce nom.");

        var now = DateTime.UtcNow;
        var client = new Client
        {
            Name = name,
            Country = Mapper.CleanText(payload.Country),
            Contact = Mapper.CleanText(payload.Contact),
            Description = Mapper.CleanText(payload.Description),
            Status = ValidateStatus(payload.Status),
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Clients.Add(client);
        await db.SaveChangesAsync(ct);

        await audit.RecordAsync("client.created", actor: HttpContext.CurrentUser(),
            targetType: "client", targetId: client.Id, targetLabel: name, ct: ct);

        return StatusCode(StatusCodes.Status201Created,
            new ClientResponse(client.Id, client.Name, client.Country, client.Contact,
                client.Description, client.Status, client.CreatedAt, client.UpdatedAt, 0, 0, 0));
    }

    [HttpGet("{clientId:int}")]
    public async Task<ClientDetailResponse> Get(int clientId, CancellationToken ct)
    {
        var client = await db.Clients.FirstOrDefaultAsync(c => c.Id == clientId, ct)
            ?? throw ApiException.NotFound("Client introuvable.");

        var nKb = await db.KbEntries.CountAsync(e => e.ClientId == clientId, ct);
        var nConfigs = await db.ConfigItems.CountAsync(c => c.ClientId == clientId, ct);
        var nQuestionnaires = await db.Questionnaires.CountAsync(q => q.ClientId == clientId, ct);

        return new ClientDetailResponse(
            client.Id, client.Name, client.Country, client.Contact, client.Description,
            client.Status, client.CreatedAt, client.UpdatedAt,
            nKb, nConfigs, nQuestionnaires,
            await CoverageAsync(db, clientId, ct));
    }

    [HttpPut("{clientId:int}")]
    public async Task<ClientResponse> Update(int clientId, ClientRequest payload, CancellationToken ct)
    {
        var client = await db.Clients.FirstOrDefaultAsync(c => c.Id == clientId, ct)
            ?? throw ApiException.NotFound("Client introuvable.");

        var name = payload.Name.Trim();
        if (await db.Clients.AnyAsync(c => c.Name == name && c.Id != clientId, ct))
            throw ApiException.Conflict("Un client porte déjà ce nom.");

        client.Name = name;
        client.Country = Mapper.CleanText(payload.Country);
        client.Contact = Mapper.CleanText(payload.Contact);
        client.Description = Mapper.CleanText(payload.Description);
        client.Status = ValidateStatus(payload.Status);
        client.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        await audit.RecordAsync("client.updated", actor: HttpContext.CurrentUser(),
            targetType: "client", targetId: clientId, targetLabel: name, ct: ct);

        var nKb = await db.KbEntries.CountAsync(e => e.ClientId == clientId, ct);
        var nConfigs = await db.ConfigItems.CountAsync(c => c.ClientId == clientId, ct);
        var nQuestionnaires = await db.Questionnaires.CountAsync(q => q.ClientId == clientId, ct);

        return new ClientResponse(client.Id, client.Name, client.Country, client.Contact,
            client.Description, client.Status, client.CreatedAt, client.UpdatedAt,
            nKb, nConfigs, nQuestionnaires);
    }

    [HttpDelete("{clientId:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(int clientId, CancellationToken ct)
    {
        var client = await db.Clients.FirstOrDefaultAsync(c => c.Id == clientId, ct)
            ?? throw ApiException.NotFound("Client introuvable.");

        // Ce que la cascade va emporter : chiffré dans la trace, car le détail ne
        // sera plus reconstituable après coup.
        var losses = new (string Label, int Count)[]
        {
            ("réponses", await db.KbEntries.CountAsync(e => e.ClientId == clientId, ct)),
            ("configurations", await db.ConfigItems.CountAsync(c => c.ClientId == clientId, ct)),
            ("questionnaires", await db.Questionnaires.CountAsync(q => q.ClientId == clientId, ct)),
        };

        var storedFiles = await db.Questionnaires
            .Where(q => q.ClientId == clientId)
            .Select(q => q.StoredPath)
            .ToListAsync(ct);

        db.Clients.Remove(client);
        await db.SaveChangesAsync(ct);
        engine.Invalidate();

        // Les fichiers ne partent qu'une fois la base à jour : un fichier effacé
        // pour une suppression qui échoue ensuite serait irrécupérable.
        foreach (var path in storedFiles) StoragePaths.TryDelete(path);

        await audit.RecordAsync("client.deleted", actor: HttpContext.CurrentUser(),
            targetType: "client", targetId: clientId, targetLabel: client.Name,
            detail: "Suppression en cascade : "
                  + string.Join(", ", losses.Select(l => $"{l.Count} {l.Label}")), ct: ct);

        return NoContent();
    }

    /// <summary>
    /// Couverture par référentiel : contrôles reliés à au moins une réponse
    /// <em>disponible pour ce client</em> — la sienne ou une générique. Compter
    /// tous les rattachements donnerait une couverture flatteuse et fausse.
    /// </summary>
    internal static async Task<List<CoverageRow>> CoverageAsync(
        AppDbContext db, int? clientId, CancellationToken ct)
    {
        var rows = await db.Frameworks
            .OrderBy(f => f.SortOrder)
            .Select(f => new CoverageRow(
                f.Code,
                f.Name,
                f.Accent,
                f.Controls.Count,
                f.Controls.Count(c => c.KbLinks.Any(link =>
                    link.KbEntry.Status != "obsolete"
                    && (link.KbEntry.ClientId == null || link.KbEntry.ClientId == clientId)))))
            .ToListAsync(ct);
        return rows;
    }
}
