namespace Cyberjet.Api.Data;

/// <summary>
/// Modèle de persistance. Un fichier unique : les entités sont petites, sans
/// comportement, et les lire d'un seul tenant vaut mieux que d'ouvrir douze
/// fichiers pour reconstituer un schéma qui tient sur deux écrans.
///
/// Le mapping vers SQL Server est déclaré explicitement dans
/// <see cref="AppDbContext"/> et doit rester aligné sur
/// <c>database/schema.sql</c>, qui fait foi pour le DDL.
/// </summary>
public class Client
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string? Country { get; set; }
    public string? Contact { get; set; }
    public string? Description { get; set; }

    /// <summary>prospect · actif · archivé — « prospect » = avant signature.</summary>
    public string Status { get; set; } = "actif";

    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public List<KbEntry> KbEntries { get; set; } = [];
    public List<ConfigItem> ConfigItems { get; set; } = [];
    public List<Questionnaire> Questionnaires { get; set; } = [];
}

public class Framework
{
    public int Id { get; set; }
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Version { get; set; }
    public string? Authority { get; set; }
    public string? Description { get; set; }
    public string Accent { get; set; } = "slate";
    public int SortOrder { get; set; }

    public List<Control> Controls { get; set; } = [];
}

public class Control
{
    public int Id { get; set; }
    public int FrameworkId { get; set; }
    public string Ref { get; set; } = "";
    public string Title { get; set; } = "";
    public string? Theme { get; set; }

    /// <summary>Intitulé officiel anglais : indexé au même titre que le titre
    /// français, ce qui permet de rapprocher un questionnaire anglophone.</summary>
    public string? Description { get; set; }

    public int SortOrder { get; set; }

    public Framework Framework { get; set; } = null!;
    public List<KbEntryControl> KbLinks { get; set; } = [];
}

/// <summary>
/// Une entrée = une question récurrente et sa réponse validée.
/// <see cref="ClientId"/> nul = réponse générique, partagée par tous les dossiers.
/// </summary>
public class KbEntry
{
    public int Id { get; set; }
    public int? ClientId { get; set; }
    public string Question { get; set; } = "";
    public string Answer { get; set; } = "";
    public string Category { get; set; } = "Général";
    public string Tags { get; set; } = "";

    /// <summary>validated · draft · obsolete</summary>
    public string Status { get; set; } = "validated";

    public string? Evidence { get; set; }
    public string? Source { get; set; }
    public int UsageCount { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? ReviewedAt { get; set; }

    public Client? Client { get; set; }
    public List<KbEntryControl> Controls { get; set; } = [];
}

public class KbEntryControl
{
    public int KbEntryId { get; set; }
    public int ControlId { get; set; }

    public KbEntry KbEntry { get; set; } = null!;
    public Control Control { get; set; } = null!;
}

public class ConfigItem
{
    public int Id { get; set; }
    public int ClientId { get; set; }
    public string Category { get; set; } = "Chiffrement";
    public string Label { get; set; } = "";
    public string Value { get; set; } = "";
    public string? Details { get; set; }
    public string? Scope { get; set; }

    /// <summary>en place · partiel · planifié · non applicable</summary>
    public string Status { get; set; } = "en place";

    public DateTime UpdatedAt { get; set; }

    public Client Client { get; set; } = null!;
}

public class Questionnaire
{
    public int Id { get; set; }
    public int ClientId { get; set; }
    public string Name { get; set; } = "";
    public string? OriginalFilename { get; set; }
    public string? StoredPath { get; set; }
    public string FileType { get; set; } = "xlsx";
    public string Status { get; set; } = "en cours";
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public Client Client { get; set; } = null!;
    public List<QuestionnaireQuestion> Questions { get; set; } = [];
}

public class QuestionnaireQuestion
{
    public int Id { get; set; }
    public int QuestionnaireId { get; set; }
    public int Idx { get; set; }
    public string? Ref { get; set; }
    public string? Section { get; set; }
    public string Text { get; set; } = "";
    public string? SuggestedAnswer { get; set; }
    public string? FinalAnswer { get; set; }

    /// <summary>pending · auto · validated · na</summary>
    public string Status { get; set; } = "pending";

    public double Confidence { get; set; }

    /// <summary>kb · config — nature de la source retenue par le moteur.</summary>
    public string? MatchedKind { get; set; }

    public int? MatchedId { get; set; }

    /// <summary>Candidats du moteur, sérialisés : ils alimentent la boîte
    /// « autres propositions » sans relancer une recherche.</summary>
    public string? CandidatesJson { get; set; }

    /// <summary>Coordonnées exactes dans le classeur d'origine (feuille, ligne,
    /// colonnes). C'est ce qui permet de rendre au client son propre fichier,
    /// complété.</summary>
    public string? LocatorJson { get; set; }

    /// <summary>Entrée de base créée depuis cette question — distincte de
    /// <see cref="MatchedId"/>, qui désigne l'entrée d'où vient la proposition.</summary>
    public int? PromotedKbEntryId { get; set; }

    public Questionnaire Questionnaire { get; set; } = null!;
    public KbEntry? PromotedKbEntry { get; set; }
}

public class AppUser
{
    public int Id { get; set; }
    public string Username { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public string PasswordSalt { get; set; } = "";
    public bool IsAdmin { get; set; }
    public bool Active { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime? LastLoginAt { get; set; }

    public string? TotpSecret { get; set; }

    /// <summary>Secret en attente : il ne devient actif qu'une fois un premier
    /// code vérifié — impossible de se verrouiller dehors avec un QR jamais scanné.</summary>
    public string? TotpPendingSecret { get; set; }

    public bool TotpEnabled { get; set; }

    /// <summary>Dernier compteur TOTP consommé : anti-rejeu dans la fenêtre de 30 s.</summary>
    public long? TotpLastCounter { get; set; }

    public DateTime? MfaEnabledAt { get; set; }

    public string? FirstName { get; set; }
    public string? LastName { get; set; }
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public string? JobTitle { get; set; }
    public string? Preferences { get; set; }

    /// <summary>Quand la visite guidée a été vue ou explicitement passée — les
    /// deux comptent comme faites, un compte ne la revoit pas malgré lui à la
    /// connexion suivante. Nul tant qu'elle reste à proposer.</summary>
    public DateTime? OnboardedAt { get; set; }

    public List<AppSession> Sessions { get; set; } = [];
    public List<RecoveryCode> RecoveryCodes { get; set; } = [];

    /// <summary>Nom d'affichage recomposé, jamais stocké : une seule source de
    /// vérité. L'inverse — couper « Jean-Pierre Le Guen » au bon endroit — ne se
    /// devine pas, d'où les deux colonnes.</summary>
    public string? DisplayName
    {
        get
        {
            var parts = new[] { FirstName, LastName }
                .Where(p => !string.IsNullOrWhiteSpace(p))
                .Select(p => p!.Trim());
            var joined = string.Join(' ', parts);
            return string.IsNullOrEmpty(joined) ? null : joined;
        }
    }
}

public class AppSession
{
    public string Token { get; set; } = "";
    public int UserId { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime ExpiresAt { get; set; }

    /// <summary>Rafraîchi à chaque requête authentifiée. C'est ce qui distingue
    /// une session ouverte d'une session active à l'instant — donc ce qui
    /// permet de savoir qui est en ligne.</summary>
    public DateTime LastSeenAt { get; set; }

    /// <summary>Mot de passe validé, second facteur encore attendu.</summary>
    public bool MfaPending { get; set; }

    public AppUser User { get; set; } = null!;
}

public class RecoveryCode
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public string CodeHash { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime? UsedAt { get; set; }

    public AppUser User { get; set; } = null!;
}

public class AuditLog
{
    public long Id { get; set; }
    public DateTime At { get; set; }
    public string Event { get; set; } = "";
    public string Outcome { get; set; } = "success";
    public int? ActorId { get; set; }
    public string? ActorName { get; set; }
    public string? Ip { get; set; }
    public string? UserAgent { get; set; }
    public string? TargetType { get; set; }
    public int? TargetId { get; set; }
    public string? TargetLabel { get; set; }
    public string? Detail { get; set; }
}

/// <summary>
/// Réglage modifiable depuis l'interface. Prime sur la valeur d'appsettings.json,
/// qui ne sert plus que de valeur initiale une fois la clé posée ici.
/// </summary>
public class AppSetting
{
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
    public DateTime UpdatedAt { get; set; }
}
