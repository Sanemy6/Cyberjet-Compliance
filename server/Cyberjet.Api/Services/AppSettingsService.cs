using System.Text.Json;
using Cyberjet.Api.Data;
using Cyberjet.Api.Middleware;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Cyberjet.Api.Services;

/// <summary>Un widget du tableau de bord, dans l'ordre et la visibilité
/// choisis par un administrateur.</summary>
/// <param name="Size">Largeur choisie — sm/md/lg/full — ou <c>null</c> pour
/// garder la taille par défaut du widget. Optionnel pour que les agencements
/// enregistrés avant l'ajout de ce réglage restent valides sans migration :
/// une valeur absente n'est pas une erreur, c'est « pas encore choisi ».</param>
public sealed record DashboardWidgetSetting(string Key, bool Visible, string? Size = null);

/// <summary>
/// Réglages modifiables depuis l'interface.
///
/// Deux sources, dans cet ordre : la table <c>AppSettings</c> si la clé y est
/// posée, sinon <c>appsettings.json</c>. Un réglage changé depuis l'application
/// survit donc au redéploiement, alors qu'un fichier de configuration écrasé
/// l'aurait perdu.
///
/// Les valeurs sont gardées en mémoire : elles sont relues à chaque requête
/// authentifiée — le délai d'inactivité, notamment — et un aller-retour en base
/// à cette fréquence ne se justifie pas pour une poignée d'entiers qui changent
/// deux fois par an. Le cache est vidé à l'écriture ; sur plusieurs instances,
/// il faudrait le remplacer par un cache partagé, ce que ce déploiement
/// mono-instance ne demande pas.
/// </summary>
public sealed class AppSettingsService(
    IServiceScopeFactory scopeFactory, IOptions<SecurityOptions> security)
{
    public const string SessionIdleTimeoutKey = "security.sessionIdleTimeoutMinutes";

    /// <summary>Bornes acceptées. Le plancher évite qu'une valeur trop courte ne
    /// rende l'application inutilisable ; le plafond garde au réglage un sens de
    /// mesure de sécurité — au-delà d'une journée de travail, il n'en a plus.</summary>
    public const int MinIdleMinutes = 5;
    public const int MaxIdleMinutes = 720;

    private int? _idleTimeout;
    private readonly Lock _gate = new();

    /// <summary>Délai d'inactivité effectif, en minutes. Zéro si désactivé.</summary>
    public int SessionIdleTimeoutMinutes
    {
        get
        {
            lock (_gate)
            {
                if (_idleTimeout is { } cached) return cached;
            }

            var value = ReadIdleTimeoutFromStore();

            lock (_gate) { _idleTimeout = value; }
            return value;
        }
    }

    private int ReadIdleTimeoutFromStore()
    {
        // Propre portée : ce service est un singleton, il ne peut pas retenir un
        // DbContext, qui lui est lié à la requête.
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var stored = db.AppSettings
            .AsNoTracking()
            .FirstOrDefault(s => s.Key == SessionIdleTimeoutKey);

        if (stored is not null && int.TryParse(stored.Value, out var parsed))
            return Normalize(parsed);

        return Normalize(security.Value.SessionIdleTimeoutMinutes);
    }

    /// <summary>Enregistre le délai et vide le cache. Zéro désactive la
    /// fermeture pour inactivité ; toute autre valeur est ramenée dans les
    /// bornes plutôt que refusée — le contrôleur valide déjà en amont, ceci
    /// n'est qu'un dernier garde-fou.</summary>
    public async Task SetSessionIdleTimeoutAsync(int minutes, CancellationToken ct = default)
    {
        var value = Normalize(minutes);

        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var existing = await db.AppSettings
            .FirstOrDefaultAsync(s => s.Key == SessionIdleTimeoutKey, ct);

        if (existing is null)
        {
            db.AppSettings.Add(new AppSetting
            {
                Key = SessionIdleTimeoutKey,
                Value = value.ToString(),
                UpdatedAt = DateTime.UtcNow,
            });
        }
        else
        {
            existing.Value = value.ToString();
            existing.UpdatedAt = DateTime.UtcNow;
        }

        await db.SaveChangesAsync(ct);

        lock (_gate) { _idleTimeout = value; }
    }

    private static int Normalize(int minutes) =>
        minutes <= 0 ? 0 : Math.Clamp(minutes, MinIdleMinutes, MaxIdleMinutes);

    // ------------------------------------------------------------------
    // Agencement du tableau de bord
    //
    // Un seul agencement, global : un administrateur le règle, il vaut pour
    // toute l'organisation. Pas de préférence par compte — ce n'est pas un
    // réglage d'affichage personnel comme le thème, c'est ce que la direction
    // du cabinet a décidé de mettre en avant.
    // ------------------------------------------------------------------

    public const string DashboardLayoutKey = "dashboard.layout";

    /// <summary>Catalogue des widgets connus, dans l'ordre par défaut. Sert de
    /// référence pour valider un agencement stocké et pour compléter les
    /// widgets qu'il aurait oubliés — l'ajout d'un widget côté code ne doit
    /// pas exiger de migration de données pour apparaître quelque part.</summary>
    public static readonly IReadOnlyList<string> DashboardWidgetKeys =
    [
        "coverage", "kpi-clients", "kpi-kb", "kpi-questionnaires", "kpi-frameworks",
        "next-step", "recent-questionnaires", "by-category", "top-kb",
    ];

    /// <summary>Largeurs acceptées pour un widget, sur une grille à douze
    /// colonnes : 4, 6, 8 et 12. Le serveur ne connaît que le nom, la mise en
    /// page concrète (colonnes, hauteur) reste une affaire d'écran, pas de
    /// modèle de données.</summary>
    public static readonly IReadOnlyList<string> DashboardWidgetSizes = ["sm", "md", "lg", "full"];

    private List<DashboardWidgetSetting>? _dashboardLayout;

    public List<DashboardWidgetSetting> DashboardLayout
    {
        get
        {
            lock (_gate)
            {
                if (_dashboardLayout is { } cached) return cached;
            }

            var value = ReadDashboardLayoutFromStore();

            lock (_gate) { _dashboardLayout = value; }
            return value;
        }
    }

    private List<DashboardWidgetSetting> ReadDashboardLayoutFromStore()
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var stored = db.AppSettings.AsNoTracking()
            .FirstOrDefault(s => s.Key == DashboardLayoutKey);

        var parsed = stored is not null ? TryParseLayout(stored.Value) : null;
        return Reconcile(parsed);
    }

    /// <summary>Complète l'ordre stocké avec les clés connues qu'il ne
    /// contiendrait pas encore — un widget ajouté après coup côté code
    /// apparaît en fin de liste, visible, plutôt que de rester invisible
    /// jusqu'à ce qu'un administrateur pense à l'ajouter à la main — et
    /// retire les clés qui ne sont plus dans le catalogue, un widget retiré du
    /// code ne doit pas laisser un fantôme éternellement configurable.</summary>
    private static List<DashboardWidgetSetting> Reconcile(List<DashboardWidgetSetting>? stored)
    {
        var known = DashboardWidgetKeys.ToHashSet();
        var result = (stored ?? [])
            .Where(w => known.Contains(w.Key))
            .DistinctBy(w => w.Key)
            .ToList();

        var present = result.Select(w => w.Key).ToHashSet();
        foreach (var key in DashboardWidgetKeys)
            if (!present.Contains(key))
                result.Add(new DashboardWidgetSetting(key, Visible: true));

        return result;
    }

    private static List<DashboardWidgetSetting>? TryParseLayout(string raw)
    {
        try { return JsonSerializer.Deserialize<List<DashboardWidgetSetting>>(raw); }
        catch (JsonException) { return null; }
    }

    /// <summary>Enregistre l'agencement. La liste doit couvrir exactement le
    /// catalogue connu — ni clé inconnue (l'écran d'administration ne peut pas
    /// en produire, un appel direct à l'API si) ni widget manquant, ce qui le
    /// ferait disparaître pour tout le monde sans que ce soit le choix
    /// explicite d'un administrateur.</summary>
    public async Task SetDashboardLayoutAsync(
        List<DashboardWidgetSetting> layout, CancellationToken ct = default)
    {
        var known = DashboardWidgetKeys.ToHashSet();
        var keys = layout.Select(w => w.Key).ToList();

        if (keys.Count != known.Count || keys.Distinct().Count() != keys.Count
            || keys.Any(k => !known.Contains(k)))
        {
            throw new ArgumentException(
                "L'agencement doit contenir chacun des widgets connus exactement une fois.");
        }

        if (layout.Any(w => w.Size is not null && !DashboardWidgetSizes.Contains(w.Size)))
        {
            throw new ArgumentException(
                $"Taille de widget invalide : les valeurs acceptées sont "
              + $"{string.Join(", ", DashboardWidgetSizes)}, ou son absence.");
        }

        var value = JsonSerializer.Serialize(layout);

        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var existing = await db.AppSettings.FirstOrDefaultAsync(
            s => s.Key == DashboardLayoutKey, ct);

        if (existing is null)
        {
            db.AppSettings.Add(new AppSetting
            {
                Key = DashboardLayoutKey,
                Value = value,
                UpdatedAt = DateTime.UtcNow,
            });
        }
        else
        {
            existing.Value = value;
            existing.UpdatedAt = DateTime.UtcNow;
        }

        await db.SaveChangesAsync(ct);

        lock (_gate) { _dashboardLayout = layout; }
    }
}
