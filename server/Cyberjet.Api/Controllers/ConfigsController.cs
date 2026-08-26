using Cyberjet.Api.Contracts;
using Cyberjet.Api.Data;
using Cyberjet.Api.Middleware;
using Cyberjet.Api.Services;
using Cyberjet.Api.Services.Search;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Cyberjet.Api.Controllers;

/// <summary>
/// Configurations techniques d'un client : les faits précis — algorithme de
/// chiffrement au repos, version TLS en transit, solution de MFA, RTO/RPO,
/// hébergeur. Saisis une fois, ils sont injectés directement dans les réponses.
/// </summary>
[ApiController]
[Route("api/configs")]
public sealed class ConfigsController(
    AppDbContext db, AuditService audit, SearchEngine engine) : ControllerBase
{
    [HttpGet]
    public async Task<List<ConfigResponse>> List([FromQuery] int? clientId, CancellationToken ct)
    {
        if (clientId is null)
        {
            return await db.ConfigItems.AsNoTracking()
                .OrderBy(c => c.Client.Name).ThenBy(c => c.Category).ThenBy(c => c.Label)
                .Select(c => new ConfigResponse(c.Id, c.ClientId, c.Client.Name, c.Category,
                    c.Label, c.Value, c.Details, c.Scope, c.Status, c.UpdatedAt))
                .ToListAsync(ct);
        }

        return await db.ConfigItems.AsNoTracking()
            .Where(c => c.ClientId == clientId)
            .OrderBy(c => c.Category).ThenBy(c => c.Label)
            .Select(c => new ConfigResponse(c.Id, c.ClientId, null, c.Category,
                c.Label, c.Value, c.Details, c.Scope, c.Status, c.UpdatedAt))
            .ToListAsync(ct);
    }

    [HttpPost]
    [ProducesResponseType(StatusCodes.Status201Created)]
    public async Task<ActionResult<ConfigResponse>> Create(ConfigRequest payload, CancellationToken ct)
    {
        if (!await db.Clients.AnyAsync(c => c.Id == payload.ClientId, ct))
            throw ApiException.NotFound("Client introuvable.");

        var item = new ConfigItem
        {
            ClientId = payload.ClientId,
            Category = string.IsNullOrWhiteSpace(payload.Category) ? "Chiffrement" : payload.Category,
            Label = payload.Label.Trim(),
            Value = payload.Value.Trim(),
            Details = Mapper.CleanText(payload.Details),
            Scope = Mapper.CleanText(payload.Scope),
            Status = string.IsNullOrWhiteSpace(payload.Status) ? "en place" : payload.Status,
            UpdatedAt = DateTime.UtcNow,
        };
        db.ConfigItems.Add(item);
        await db.SaveChangesAsync(ct);
        engine.Invalidate();

        await audit.RecordAsync("config.created", actor: HttpContext.CurrentUser(),
            targetType: "config_item", targetId: item.Id,
            targetLabel: $"{item.Category} — {item.Label}",
            detail: await Mapper.ScopeLabelAsync(db, payload.ClientId, ct), ct: ct);

        return StatusCode(StatusCodes.Status201Created, Mapper.ToConfig(item));
    }

    [HttpPut("{configId:int}")]
    public async Task<ConfigResponse> Update(int configId, ConfigRequest payload, CancellationToken ct)
    {
        var item = await db.ConfigItems.FirstOrDefaultAsync(c => c.Id == configId, ct)
            ?? throw ApiException.NotFound("Configuration introuvable.");

        var previousValue = item.Value;
        var newValue = payload.Value.Trim();

        item.ClientId = payload.ClientId;
        item.Category = string.IsNullOrWhiteSpace(payload.Category) ? "Chiffrement" : payload.Category;
        item.Label = payload.Label.Trim();
        item.Value = newValue;
        item.Details = Mapper.CleanText(payload.Details);
        item.Scope = Mapper.CleanText(payload.Scope);
        item.Status = string.IsNullOrWhiteSpace(payload.Status) ? "en place" : payload.Status;
        item.UpdatedAt = DateTime.UtcNow;

        await db.SaveChangesAsync(ct);
        engine.Invalidate();

        // La valeur d'une configuration technique (« AES-256-GCM », « TLS 1.3 »)
        // est un fait d'architecture, pas un secret : la tracer permet de savoir
        // depuis quand une réponse client affirme telle ou telle mesure.
        var detail = previousValue != newValue
            ? $"valeur « {previousValue} » → « {newValue} »"
            : "métadonnées";

        await audit.RecordAsync("config.updated", actor: HttpContext.CurrentUser(),
            targetType: "config_item", targetId: configId,
            targetLabel: $"{item.Category} — {item.Label}", detail: detail, ct: ct);

        return Mapper.ToConfig(item);
    }

    [HttpDelete("{configId:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(int configId, CancellationToken ct)
    {
        var item = await db.ConfigItems.FirstOrDefaultAsync(c => c.Id == configId, ct)
            ?? throw ApiException.NotFound("Configuration introuvable.");

        var label = $"{item.Category} — {item.Label}";
        db.ConfigItems.Remove(item);
        await db.SaveChangesAsync(ct);
        engine.Invalidate();

        await audit.RecordAsync("config.deleted", actor: HttpContext.CurrentUser(),
            targetType: "config_item", targetId: configId, targetLabel: label, ct: ct);

        return NoContent();
    }
}
