using Cyberjet.Api.Contracts;
using Cyberjet.Api.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Cyberjet.Api.Controllers;

/// <summary>
/// Référentiels et contrôles. Les contrôles servent d'ancrage : une réponse
/// rattachée à <c>IS.I.OR.205</c> ou <c>A.8.24</c> remonte en priorité dès qu'un
/// questionnaire cite cette référence.
/// </summary>
[ApiController]
[Route("api")]
public sealed class FrameworksController(AppDbContext db) : ControllerBase
{
    [HttpGet("frameworks")]
    public async Task<List<FrameworkResponse>> ListFrameworks(CancellationToken ct) =>
        await db.Frameworks.AsNoTracking()
            .OrderBy(f => f.SortOrder)
            .Select(f => new FrameworkResponse(f.Id, f.Code, f.Name, f.Version, f.Authority,
                f.Description, f.Accent, f.SortOrder, f.Controls.Count))
            .ToListAsync(ct);

    [HttpGet("frameworks/{frameworkId:int}/controls")]
    public async Task<List<ControlResponse>> ListControls(int frameworkId, CancellationToken ct) =>
        await db.Controls.AsNoTracking()
            .Where(c => c.FrameworkId == frameworkId)
            .OrderBy(c => c.SortOrder)
            .Select(c => new ControlResponse(c.Id, c.FrameworkId, c.Ref, c.Title, c.Theme,
                c.Description, c.SortOrder, c.KbLinks.Count))
            .ToListAsync(ct);

    /// <summary>Recherche libre sur les contrôles — alimente le sélecteur du
    /// formulaire de réponse.</summary>
    [HttpGet("controls")]
    public async Task<List<ControlChipResponse>> SearchControls(
        [FromQuery] string q = "", [FromQuery] int limit = 40, CancellationToken ct = default)
    {
        var take = Math.Clamp(limit, 1, 200);
        var query = db.Controls.AsNoTracking().AsQueryable();

        var term = q.Trim();
        if (term.Length > 0)
        {
            var like = $"%{term}%";
            query = query.Where(c => EF.Functions.Like(c.Ref, like)
                                  || EF.Functions.Like(c.Title, like)
                                  || (c.Description != null && EF.Functions.Like(c.Description, like))
                                  || EF.Functions.Like(c.Framework.Code, like));
        }

        return await query
            .OrderBy(c => c.Framework.SortOrder).ThenBy(c => c.SortOrder)
            .Take(take)
            .Select(c => new ControlChipResponse(
                c.Id, c.Ref, c.Title, c.Framework.Code, c.Framework.Accent))
            .ToListAsync(ct);
    }
}
