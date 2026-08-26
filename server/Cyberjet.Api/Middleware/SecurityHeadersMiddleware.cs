using Microsoft.Extensions.Options;

namespace Cyberjet.Api.Middleware;

/// <summary>
/// En-têtes de sécurité applicables à toute réponse, qu'elle serve l'API ou
/// l'interface React. Pas de CSP `script-src`/`style-src` restrictive au-delà
/// de `default-src 'self'` : l'interface est un bundle Vite unique, sans
/// script ni feuille de style chargés depuis un tiers.
/// </summary>
public sealed class SecurityHeadersMiddleware(RequestDelegate next, IOptions<SecurityOptions> options)
{
    public async Task InvokeAsync(HttpContext context)
    {
        var headers = context.Response.Headers;

        headers["X-Content-Type-Options"] = "nosniff";
        headers["X-Frame-Options"] = "DENY";
        headers["Referrer-Policy"] = "same-origin";
        headers["Content-Security-Policy"] =
            "default-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'";

        // HSTS n'a de sens que si le trafic est effectivement en HTTPS : l'envoyer
        // sur un déploiement HTTP interne n'aurait aucun effet, mais l'envoyer par
        // erreur juste avant un passage temporaire en HTTP casserait l'accès pour
        // la durée du max-age mémorisé par le navigateur.
        if (options.Value.RequireSecureCookies || context.Request.IsHttps)
            headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";

        await next(context);
    }
}
