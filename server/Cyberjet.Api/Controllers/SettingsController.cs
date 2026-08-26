using Cyberjet.Api.Contracts;
using Cyberjet.Api.Data;
using Cyberjet.Api.Middleware;
using Cyberjet.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Cyberjet.Api.Controllers;

/// <summary>
/// Réglages de l'application, communs à toute l'organisation.
///
/// La lecture est ouverte à toute personne connectée — l'interface a besoin du
/// délai d'inactivité pour prévenir avant l'échéance. L'écriture est réservée
/// aux administrateurs : une politique de sécurité se décide, elle ne se règle
/// pas compte par compte.
/// </summary>
[ApiController]
[Route("api/settings")]
public sealed class SettingsController(
    AppSettingsService settings, AuditService audit) : ControllerBase
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

    [HttpGet]
    public SettingsResponse Get() => new(
        SessionIdleTimeoutMinutes: settings.SessionIdleTimeoutMinutes,
        MinIdleTimeoutMinutes: AppSettingsService.MinIdleMinutes,
        MaxIdleTimeoutMinutes: AppSettingsService.MaxIdleMinutes);

    /// <summary>Change le délai d'inactivité. Prend effet immédiatement, sans
    /// redémarrage : les sessions ouvertes sont évaluées à leur requête
    /// suivante.</summary>
    [HttpPut("session-idle-timeout")]
    public async Task<SettingsResponse> SetSessionIdleTimeout(
        SessionIdleTimeoutRequest payload, CancellationToken ct)
    {
        var admin = await RequireAdminAsync(ct);
        var minutes = payload.Minutes;

        if (minutes != 0
            && (minutes < AppSettingsService.MinIdleMinutes
             || minutes > AppSettingsService.MaxIdleMinutes))
        {
            throw ApiException.BadRequest(
                $"Le délai doit être compris entre {AppSettingsService.MinIdleMinutes} et "
              + $"{AppSettingsService.MaxIdleMinutes} minutes, ou 0 pour désactiver la "
              + "fermeture automatique.");
        }

        var previous = settings.SessionIdleTimeoutMinutes;
        await settings.SetSessionIdleTimeoutAsync(minutes, ct);

        await audit.RecordAsync("settings.updated", actor: admin, targetType: "setting",
            targetLabel: "Délai d'inactivité",
            detail: Describe(previous) + " → " + Describe(settings.SessionIdleTimeoutMinutes),
            ct: ct);

        return Get();
    }

    private static string Describe(int minutes) =>
        minutes <= 0 ? "désactivé" : $"{minutes} min";

    // ------------------------------------------------------------------
    // Agencement du tableau de bord
    // ------------------------------------------------------------------

    /// <summary>Agencement en vigueur. Public à toute personne connectée : le
    /// tableau de bord de chacun doit le lire pour s'afficher, seule
    /// l'écriture est réservée aux administrateurs.</summary>
    [HttpGet("dashboard-layout")]
    public List<DashboardWidgetSetting> GetDashboardLayout() => settings.DashboardLayout;

    /// <summary>Enregistre le nouvel agencement — visibilité et ordre des
    /// widgets. Prend effet immédiatement pour tout le monde, sans
    /// redémarrage.</summary>
    [HttpPut("dashboard-layout")]
    public async Task<List<DashboardWidgetSetting>> SetDashboardLayout(
        DashboardLayoutRequest payload, CancellationToken ct)
    {
        var admin = await RequireAdminAsync(ct);

        try
        {
            await settings.SetDashboardLayoutAsync(payload.Widgets, ct);
        }
        catch (ArgumentException exception)
        {
            throw ApiException.BadRequest(exception.Message);
        }

        var shown = payload.Widgets.Count(w => w.Visible);
        await audit.RecordAsync("settings.updated", actor: admin, targetType: "setting",
            targetLabel: "Tableau de bord",
            detail: $"Agencement modifié : {shown}/{payload.Widgets.Count} widget(s) affiché(s)",
            ct: ct);

        return settings.DashboardLayout;
    }
}
