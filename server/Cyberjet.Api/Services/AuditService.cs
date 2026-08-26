using Cyberjet.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Cyberjet.Api.Services;

/// <summary>
/// Journal d'audit.
///
/// Ce qui est journalisé suit les recommandations usuelles en la matière (OWASP
/// Logging Cheat Sheet, ISO/IEC 27001:2022 A.8.15 « Journalisation », guide
/// ANSSI sur la journalisation), ramenées au strict nécessaire pour un outil de
/// cette taille. Deux principes gouvernent le contenu :
///
/// <list type="bullet">
/// <item><b>Tracer ce qui engage.</b> Les événements d'authentification, les
/// changements de droits, les modifications de données et les sorties de données
/// (exports). Les simples consultations ne sont pas journalisées : elles
/// noieraient le signal sans rien prouver d'utile ici.</item>
///
/// <item><b>Ne jamais journaliser de secret.</b> Aucun mot de passe, aucun jeton
/// de session, aucun secret TOTP, aucun code de récupération, même haché, même
/// tronqué. Aucun contenu métier complet non plus : on trace l'identifiant et le
/// libellé de l'objet touché, pas la réponse de conformité elle-même.</item>
/// </list>
///
/// Chaque entrée porte les cinq informations qui rendent une trace exploitable :
/// quand, qui, depuis où, quoi, et avec quel résultat.
///
/// L'écriture se fait dans son propre <see cref="AppDbContext"/>, validée
/// aussitôt. C'est indispensable sur les chemins d'échec : une trace écrite dans
/// le contexte de la requête juste avant de renvoyer une erreur risquerait de
/// partir avec un <c>SaveChanges</c> jamais appelé. Or ce sont précisément les
/// échecs — connexions refusées, seconds facteurs invalides — qu'un journal doit
/// conserver.
/// </summary>
public sealed class AuditService(IServiceScopeFactory scopeFactory, IHttpContextAccessor accessor)
{
    /// <summary>Un an couvre le cycle d'audit annuel typique tout en restant
    /// proportionné : conserver au-delà sans besoin établi contreviendrait au
    /// principe de minimisation.</summary>
    public const int RetentionDays = 365;

    private const int UserAgentMaxLength = 180;

    /// <summary>Catalogue des événements. Codes stables et hiérarchiques
    /// (<c>domaine.objet.action</c>) afin de rester filtrables et de survivre aux
    /// changements de libellé.</summary>
    public static readonly IReadOnlyDictionary<string, string> Events = new Dictionary<string, string>
    {
        // Contrôle d'accès
        ["access.denied"] = "Accès refusé (droits insuffisants)",
        // Authentification
        ["auth.login.success"] = "Connexion réussie",
        ["auth.login.failure"] = "Échec de connexion",
        ["auth.login.locked"] = "Connexion bloquée (trop de tentatives)",
        ["auth.unlocked"] = "Compte débloqué par un administrateur",
        ["auth.logout"] = "Déconnexion",
        ["auth.setup"] = "Création du compte administrateur initial",
        // Second facteur
        ["mfa.enabled"] = "Second facteur activé",
        ["mfa.disabled"] = "Second facteur désactivé",
        ["mfa.verify.success"] = "Second facteur validé",
        ["mfa.verify.failure"] = "Échec du second facteur",
        ["mfa.recovery.used"] = "Code de récupération utilisé",
        ["mfa.recovery.regenerated"] = "Codes de récupération régénérés",
        ["mfa.reset.admin"] = "Second facteur réinitialisé par un administrateur",
        // Comptes
        ["user.created"] = "Compte créé",
        ["user.updated"] = "Compte modifié",
        ["user.deleted"] = "Compte supprimé",
        ["user.password.changed"] = "Mot de passe modifié",
        ["user.role.changed"] = "Droits d'administration modifiés",
        ["user.deactivated"] = "Compte désactivé",
        ["user.reactivated"] = "Compte réactivé",
        // Fiche et sessions du compte, tenues par la personne elle-même
        ["account.profile.updated"] = "Fiche du compte modifiée",
        ["account.password.changed"] = "Mot de passe changé par son titulaire",
        ["account.sessions.revoked"] = "Autres sessions déconnectées",
        // Données métier
        ["client.created"] = "Client créé",
        ["client.updated"] = "Client modifié",
        ["client.deleted"] = "Client supprimé",
        ["kb.created"] = "Réponse de référence créée",
        ["kb.updated"] = "Réponse de référence modifiée",
        ["kb.deleted"] = "Réponse de référence supprimée",
        ["config.created"] = "Configuration technique créée",
        ["config.updated"] = "Configuration technique modifiée",
        ["config.deleted"] = "Configuration technique supprimée",
        ["questionnaire.imported"] = "Questionnaire importé",
        ["questionnaire.deleted"] = "Questionnaire supprimé",
        ["questionnaire.rejected"] = "Fichier importé rejeté (contenu incohérent)",
        // Sortie de données : à tracer en priorité, c'est ce qui quitte l'outil.
        ["export.generated"] = "Export généré",
        // Réglages de l'application
        ["settings.updated"] = "Réglage modifié",
        // Maintenance du journal lui-même
        ["audit.purged"] = "Purge du journal d'audit",
    };

    /// <summary>Familles proposées comme filtre dans l'interface.</summary>
    public static readonly IReadOnlyDictionary<string, string> Categories = new Dictionary<string, string>
    {
        ["access"] = "Contrôle d'accès",
        ["auth"] = "Authentification",
        ["mfa"] = "Second facteur",
        ["account"] = "Mon compte",
        ["user"] = "Comptes",
        ["client"] = "Clients",
        ["kb"] = "Base de connaissance",
        ["config"] = "Configurations",
        ["questionnaire"] = "Questionnaires",
        ["export"] = "Exports",
        ["settings"] = "Réglages",
        ["audit"] = "Journal",
    };

    public static string Label(string eventCode) =>
        Events.TryGetValue(eventCode, out var label) ? label : eventCode;

    public string ClientIp()
    {
        var address = accessor.HttpContext?.Connection.RemoteIpAddress;
        return address is null ? "inconnu" : address.ToString();
    }

    private string? UserAgent()
    {
        var raw = accessor.HttpContext?.Request.Headers.UserAgent.ToString();
        if (string.IsNullOrWhiteSpace(raw)) return null;
        return raw.Length > UserAgentMaxLength ? raw[..UserAgentMaxLength] : raw;
    }

    /// <summary>
    /// Enregistre un événement.
    /// </summary>
    /// <param name="actor">Compte à l'origine de l'action, s'il est authentifié.</param>
    /// <param name="actorName">Permet de nommer un acteur non authentifié —
    /// typiquement l'identifiant saisi lors d'un échec de connexion, qui est
    /// justement l'information utile dans ce cas.</param>
    public async Task RecordAsync(
        string eventCode,
        AppUser? actor = null,
        string outcome = "success",
        string? targetType = null,
        int? targetId = null,
        string? targetLabel = null,
        string? detail = null,
        string? actorName = null,
        CancellationToken ct = default)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        db.AuditLogs.Add(new AuditLog
        {
            At = DateTime.UtcNow,
            Event = eventCode,
            Outcome = outcome,
            ActorId = actor?.Id,
            ActorName = actor?.Username ?? actorName,
            Ip = ClientIp(),
            UserAgent = UserAgent(),
            TargetType = targetType,
            TargetId = targetId,
            TargetLabel = Truncate(targetLabel, 200),
            Detail = Truncate(detail, 500),
        });
        await db.SaveChangesAsync(ct);
    }

    private static string? Truncate(string? value, int max) =>
        string.IsNullOrEmpty(value) ? value : (value.Length > max ? value[..max] : value);

    /// <summary>
    /// Supprime les entrées au-delà de la rétention. La purge se journalise
    /// elle-même : un trou dans le journal doit toujours être explicable.
    /// </summary>
    public static async Task<int> PurgeExpiredAsync(AppDbContext db, CancellationToken ct = default)
    {
        var cutoff = DateTime.UtcNow.Date.AddDays(-RetentionDays);
        var deleted = await db.AuditLogs.Where(entry => entry.At < cutoff).ExecuteDeleteAsync(ct);

        if (deleted > 0)
        {
            db.AuditLogs.Add(new AuditLog
            {
                At = DateTime.UtcNow,
                Event = "audit.purged",
                Outcome = "success",
                Detail = $"{deleted} entrée(s) antérieure(s) au {cutoff:yyyy-MM-dd} supprimée(s)",
            });
            await db.SaveChangesAsync(ct);
        }
        return deleted;
    }
}
