using Cyberjet.Api.Contracts;
using Cyberjet.Api.Middleware;
using Cyberjet.Api.Services.Auth;
using Microsoft.AspNetCore.Mvc;

namespace Cyberjet.Api.Controllers;

/// <summary>
/// Qui est actuellement en ligne — pas d'historique, pas d'adresse IP : juste le
/// nom et le rôle, pour situer qui d'autre travaille sur l'outil en ce moment.
///
/// Ouvert à toute personne connectée, comme la liste des dossiers clients :
/// contrairement au journal d'audit, la présence ne dit rien de ce que chacun
/// a fait, seulement qu'une session est ouverte.
/// </summary>
[ApiController]
[Route("api/presence")]
public sealed class PresenceController(SessionService sessions) : ControllerBase
{
    [HttpGet]
    public async Task<PresenceResponse> Get(CancellationToken ct)
    {
        var me = HttpContext.CurrentUser();
        var online = await sessions.GetOnlineUsersAsync(ct);

        var users = online
            .Select(p => new OnlineUserResponse(
                p.User.Id, p.User.Username, p.User.DisplayName, p.User.IsAdmin,
                p.User.Id == me.Id))
            // Soi-même en tête : c'est la première chose qu'on vérifie en ouvrant
            // la liste (« est-ce que je suis bien vu comme connecté ? »).
            .OrderByDescending(u => u.IsSelf)
            .ToList();

        return new PresenceResponse(users.Count, users);
    }
}
