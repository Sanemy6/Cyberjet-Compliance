using System.Globalization;
using System.Text;
using Cyberjet.Api.Contracts;
using Cyberjet.Api.Data;
using Cyberjet.Api.Middleware;
using Cyberjet.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Cyberjet.Api.Controllers;

/// <summary>Journal d'audit — consultation réservée aux administrateurs.</summary>
[ApiController]
[Route("api/audit")]
public sealed class AuditController(AppDbContext db, AuditService audit) : ControllerBase
{
    private async Task<AppUser> RequireAdminAsync(CancellationToken ct)
    {
        var user = HttpContext.CurrentUser();
        if (user.IsAdmin) return user;

        await audit.RecordAsync("access.denied", outcome: "failure", actor: user,
            detail: $"Accès refusé à {Request.Method} {Request.Path} : compte non administrateur",
            ct: ct);
        throw ApiException.Forbidden("Réservé aux administrateurs.");
    }

    private IQueryable<AuditLog> Filtered(
        string @event, string category, string outcome, string actor,
        string since, string until, string q)
    {
        var query = db.AuditLogs.AsNoTracking().AsQueryable();

        if (!string.IsNullOrWhiteSpace(@event)) query = query.Where(e => e.Event == @event);
        if (!string.IsNullOrWhiteSpace(category))
            query = query.Where(e => EF.Functions.Like(e.Event, $"{category}.%"));
        if (!string.IsNullOrWhiteSpace(outcome)) query = query.Where(e => e.Outcome == outcome);
        if (!string.IsNullOrWhiteSpace(actor))
            query = query.Where(e => e.ActorName != null && EF.Functions.Like(e.ActorName, $"%{actor}%"));

        if (DateTime.TryParse(since, CultureInfo.InvariantCulture,
                              DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                              out var from))
            query = query.Where(e => e.At >= from.Date);

        if (DateTime.TryParse(until, CultureInfo.InvariantCulture,
                              DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                              out var to))
        {
            // Borne inclusive sur la journée : l'utilisateur saisit une date, pas
            // un instant. Sans cela, filtrer « jusqu'au 4 août » masquerait tout
            // ce qui s'est passé ce jour-là.
            var end = to.Date.AddDays(1);
            query = query.Where(e => e.At < end);
        }

        if (!string.IsNullOrWhiteSpace(q))
        {
            var like = $"%{q}%";
            query = query.Where(e =>
                (e.TargetLabel != null && EF.Functions.Like(e.TargetLabel, like))
                || (e.Detail != null && EF.Functions.Like(e.Detail, like))
                || (e.Ip != null && EF.Functions.Like(e.Ip, like)));
        }

        return query;
    }

    [HttpGet]
    public async Task<AuditResponse> List(
        [FromQuery] string @event = "",
        [FromQuery] string category = "",
        [FromQuery] string outcome = "",
        [FromQuery] string actor = "",
        [FromQuery] string since = "",
        [FromQuery] string until = "",
        [FromQuery] string q = "",
        [FromQuery] int limit = 200,
        [FromQuery] int offset = 0,
        CancellationToken ct = default)
    {
        await RequireAdminAsync(ct);

        limit = Math.Clamp(limit, 1, 1000);
        offset = Math.Max(offset, 0);

        var filtered = Filtered(@event, category, outcome, actor, since, until, q);
        var total = await filtered.CountAsync(ct);

        var entries = await filtered
            .OrderByDescending(e => e.At).ThenByDescending(e => e.Id)
            .Skip(offset).Take(limit)
            .ToListAsync(ct);

        var dayAgo = DateTime.UtcNow.AddDays(-1);
        var summary = new AuditSummary(
            TotalEntries: await db.AuditLogs.CountAsync(ct),
            FailedLogins24h: await db.AuditLogs.CountAsync(
                e => e.Event == "auth.login.failure" && e.At >= dayAgo, ct),
            Lockouts24h: await db.AuditLogs.CountAsync(
                e => e.Event == "auth.login.locked" && e.At >= dayAgo, ct),
            MfaFailures24h: await db.AuditLogs.CountAsync(
                e => e.Event == "mfa.verify.failure" && e.At >= dayAgo, ct),
            Oldest: await db.AuditLogs.MinAsync(e => (DateTime?)e.At, ct));

        var actors = await db.AuditLogs
            .Where(e => e.ActorName != null)
            .Select(e => e.ActorName!)
            .Distinct()
            .OrderBy(name => name)
            .ToListAsync(ct);

        return new AuditResponse(
            Entries: [.. entries.Select(ToResponse)],
            Total: total,
            Limit: limit,
            Offset: offset,
            Summary: summary,
            Actors: actors,
            Events: [.. AuditService.Events.Select(kv => new CodeLabel(kv.Key, kv.Value))],
            Categories: [.. AuditService.Categories.Select(kv => new CodeLabel(kv.Key, kv.Value))],
            RetentionDays: AuditService.RetentionDays);
    }

    /// <summary>Export CSV du journal filtré — pièce à joindre à un dossier d'audit.</summary>
    [HttpGet("export")]
    public async Task<IActionResult> Export(
        [FromQuery] string @event = "",
        [FromQuery] string category = "",
        [FromQuery] string outcome = "",
        [FromQuery] string actor = "",
        [FromQuery] string since = "",
        [FromQuery] string until = "",
        [FromQuery] string q = "",
        CancellationToken ct = default)
    {
        var admin = await RequireAdminAsync(ct);

        var entries = await Filtered(@event, category, outcome, actor, since, until, q)
            .OrderByDescending(e => e.At).ThenByDescending(e => e.Id)
            .ToListAsync(ct);

        await audit.RecordAsync("export.generated", actor: admin, targetType: "audit_log",
            detail: $"Export CSV du journal d'audit : {entries.Count} entrée(s)", ct: ct);

        var csv = new StringBuilder();
        csv.Append(Row("Horodatage (UTC)", "Événement", "Code", "Résultat", "Acteur",
                       "Adresse IP", "Type de cible", "Cible", "Détail", "Navigateur"));

        foreach (var entry in entries)
        {
            csv.Append(Row(
                entry.At.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture),
                AuditService.Label(entry.Event), entry.Event, entry.Outcome,
                entry.ActorName ?? "", entry.Ip ?? "", entry.TargetType ?? "",
                entry.TargetLabel ?? "", entry.Detail ?? "", entry.UserAgent ?? ""));
        }

        // BOM UTF-8 : sans lui, Excel sous Windows massacre les accents.
        var bytes = Encoding.UTF8.GetPreamble()
            .Concat(Encoding.UTF8.GetBytes(csv.ToString()))
            .ToArray();

        var stamp = DateTime.Now.ToString("yyyyMMdd-HHmm", CultureInfo.InvariantCulture);
        return File(bytes, "text/csv; charset=utf-8", $"journal-audit_{stamp}.csv");
    }

    /// <summary>Ligne CSV en séparateur point-virgule, format attendu par un Excel
    /// francophone. Les guillemets sont doublés, comme le veut le RFC 4180.</summary>
    private static string Row(params string[] values) =>
        string.Join(';', values.Select(value => $"\"{value.Replace("\"", "\"\"")}\"")) + "\r\n";

    private static AuditEntryResponse ToResponse(AuditLog entry) => new(
        entry.Id, entry.At, entry.Event, AuditService.Label(entry.Event), entry.Outcome,
        entry.ActorId, entry.ActorName, entry.Ip, entry.UserAgent,
        entry.TargetType, entry.TargetId, entry.TargetLabel, entry.Detail);
}
