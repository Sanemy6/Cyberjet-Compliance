using Cyberjet.Api.Data;
using Cyberjet.Api.Services.Auth;

namespace Cyberjet.Api.Middleware;

/// <summary>
/// Contrôle d'accès global.
///
/// L'application est utilisable en réseau par plusieurs personnes ; sans ce
/// garde-fou, n'importe qui pourrait consulter ou modifier les dossiers clients.
/// Tout ce qui n'est pas explicitement public passe par ici.
/// </summary>
public sealed class AuthGateMiddleware(RequestDelegate next)
{
    private const string UserKey = "cyberjet.user";
    private const string PendingUserKey = "cyberjet.pendingUser";

    /// <summary>
    /// Liste explicite plutôt qu'un préfixe « /api/auth/ » : sinon tout endpoint
    /// ajouté plus tard sous ce préfixe — l'enrôlement du second facteur, par
    /// exemple — deviendrait public sans que personne ne s'en aperçoive.
    /// </summary>
    private static readonly HashSet<string> PublicApi = new(StringComparer.OrdinalIgnoreCase)
    {
        "/api/auth/status",
        "/api/auth/setup",
        "/api/auth/login",
        "/api/auth/logout",
    };

    /// <summary>Endpoints franchissables avec une session à demi ouverte — mot de
    /// passe validé, second facteur en attente — et rien d'autre.</summary>
    private static readonly HashSet<string> MfaPendingApi = new(StringComparer.OrdinalIgnoreCase)
    {
        "/api/auth/mfa/verify",
        "/api/auth/mfa/cancel",
    };

    private static readonly HashSet<string> DocsPaths = new(StringComparer.OrdinalIgnoreCase)
    {
        "/swagger/v1/swagger.json",
    };

    public async Task InvokeAsync(HttpContext context, SessionService sessions)
    {
        var path = context.Request.Path.Value ?? "";

        // La session est résolue pour toutes les requêtes, y compris les
        // endpoints publics : la déconnexion doit pouvoir nommer qui se
        // déconnecte, et le statut n'a alors plus à réinterroger la base.
        // C'est l'exigence d'authentification, plus bas, qui est conditionnelle.
        var token = context.Request.Cookies[SessionService.CookieName];
        var user = await sessions.GetSessionUserAsync(token, context.RequestAborted);
        var pending = user is null
            ? await sessions.GetPendingSessionUserAsync(token, context.RequestAborted)
            : null;

        context.Items[UserKey] = user;
        context.Items[PendingUserKey] = pending;

        if (PublicApi.Contains(path))
        {
            await next(context);
            return;
        }

        if (MfaPendingApi.Contains(path))
        {
            if (pending is null)
            {
                await WriteProblemAsync(context, 401, "Aucune authentification en cours.");
                return;
            }
            await next(context);
            return;
        }

        var isProtectedPath = path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase)
                           || DocsPaths.Contains(path)
                           || path.StartsWith("/swagger", StringComparison.OrdinalIgnoreCase);

        if (user is null && isProtectedPath)
        {
            await WriteProblemAsync(context, 401, "Authentification requise.");
            return;
        }

        // Pages : le shell est toujours servi ; c'est l'application React qui
        // interroge /api/auth/status au chargement et bascule sur l'écran de
        // connexion si nécessaire.
        await next(context);
    }

    private static Task WriteProblemAsync(HttpContext context, int status, string detail)
    {
        context.Response.StatusCode = status;
        context.Response.ContentType = "application/json; charset=utf-8";
        return context.Response.WriteAsJsonAsync(new { detail });
    }

    public static AppUser? GetUser(HttpContext context) =>
        context.Items.TryGetValue(UserKey, out var value) ? value as AppUser : null;

    public static AppUser? GetPendingUser(HttpContext context) =>
        context.Items.TryGetValue(PendingUserKey, out var value) ? value as AppUser : null;
}

public static class HttpContextAuthExtensions
{
    /// <summary>Compte connecté. Sur les endpoints protégés, le middleware garantit
    /// qu'il est non nul avant que le contrôleur ne soit atteint.</summary>
    public static AppUser CurrentUser(this HttpContext context) =>
        AuthGateMiddleware.GetUser(context)
        ?? throw new InvalidOperationException(
            "Endpoint atteint sans session : le contrôle d'accès a été contourné.");

    public static AppUser? CurrentUserOrNull(this HttpContext context) =>
        AuthGateMiddleware.GetUser(context);

    public static AppUser? PendingUser(this HttpContext context) =>
        AuthGateMiddleware.GetPendingUser(context);
}
