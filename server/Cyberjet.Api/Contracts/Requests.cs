using System.ComponentModel.DataAnnotations;

namespace Cyberjet.Api.Contracts;

/*
 * Charges utiles reçues du client.
 *
 * Les attributs de validation portent sur le PARAMÈTRE du constructeur primaire,
 * jamais sur la propriété générée. C'est une exigence d'ASP.NET Core : sur un
 * record positionnel, `[property: Required]` est silencieusement ignoré par le
 * lieur de modèle, qui lève alors une InvalidOperationException à la première
 * requête. Écrire `[Required]` sans cible explicite vise le paramètre — c'est ce
 * qu'il faut.
 */

// ==========================================================================
// Authentification
// ==========================================================================

public sealed record SetupRequest(
    [Required, StringLength(60, MinimumLength = 3)] string Username,
    [Required, StringLength(200, MinimumLength = 8)] string Password);

public sealed record LoginRequest(
    [Required] string Username,
    [Required] string Password);

public sealed record MfaCodeRequest(
    [Required, StringLength(32, MinimumLength = 4)] string Code);

public sealed record PasswordConfirmRequest(
    [Required, StringLength(200, MinimumLength = 1)] string Password);

public sealed record PasswordChangeRequest(
    [Required, StringLength(200, MinimumLength = 1)] string CurrentPassword,
    [Required, StringLength(200, MinimumLength = 8)] string NewPassword);

// ==========================================================================
// Mon compte
//
// Convention sur les champs libres de la fiche : `null` signifie « champ non
// transmis, ne pas y toucher », la chaîne vide signifie « effacer ». Effacer une
// adresse est une opération légitime, elle doit être exprimable.
// ==========================================================================

public sealed record AccountProfileRequest(
    [StringLength(80)] string? FirstName,
    [StringLength(80)] string? LastName,
    [StringLength(120)] string? JobTitle,
    [StringLength(200)] string? Email,
    [StringLength(40)] string? Phone);

/// <summary>Préférences d'interface. Liste blanche stricte côté serveur : ce
/// champ est réécrit tel quel dans la page, accepter des valeurs arbitraires
/// reviendrait à laisser un compte stocker n'importe quoi sous couvert de
/// « réglage ».</summary>
public sealed record PreferencesRequest(
    string? Theme, string? Accent, string? Density, string? Sidebar, string? Motion);

// ==========================================================================
// Comptes (administration)
// ==========================================================================

public sealed record UserCreateRequest(
    [Required, StringLength(60, MinimumLength = 3)] string Username,
    [Required, StringLength(200, MinimumLength = 8)] string Password,
    bool IsAdmin,
    [StringLength(80)] string? FirstName,
    [StringLength(80)] string? LastName,
    [StringLength(200)] string? Email);

public sealed record UserPatchRequest(
    [StringLength(200, MinimumLength = 8)] string? Password,
    bool? IsAdmin,
    bool? Active,
    [StringLength(80)] string? FirstName,
    [StringLength(80)] string? LastName,
    [StringLength(200)] string? Email);

// ==========================================================================
// Données métier
// ==========================================================================

public sealed record ClientRequest(
    [Required, StringLength(200, MinimumLength = 1)] string Name,
    [StringLength(120)] string? Country,
    [StringLength(300)] string? Contact,
    string? Description,
    // prospect · actif · archivé
    string? Status);

public sealed record KbRequest(
    int? ClientId,
    [Required, MinLength(3)] string Question,
    [Required, MinLength(1)] string Answer,
    string? Category,
    string? Tags,
    // validated · draft · obsolete
    string? Status,
    [StringLength(500)] string? Evidence,
    [StringLength(300)] string? Source,
    List<int>? ControlIds);

public sealed record ConfigRequest(
    [Required] int ClientId,
    string? Category,
    [Required, StringLength(300, MinimumLength = 1)] string Label,
    [Required, MinLength(1)] string Value,
    string? Details,
    [StringLength(500)] string? Scope,
    string? Status);

// ==========================================================================
// Moteur et questionnaires
// ==========================================================================

public sealed record AnswerQueryRequest(
    int? ClientId,
    [Required, MinLength(3)] string Question,
    int? TopK);

public sealed record ManualQuestionnaireRequest(
    [Required] int ClientId,
    [Required, MinLength(1)] string Name,
    [Required, MinLength(3)] string Text);

public sealed record QuestionPatchRequest(
    string? FinalAnswer,
    // pending · auto · validated · na
    string? Status);

public sealed record PromotionRequest([Required] int KbEntryId);

public sealed record ApplyCandidateRequest(
    [Required] string Kind,
    [Required] int SourceId);

public sealed record RematchRequest(string? Q);

/// <summary>Délai d'inactivité en minutes ; 0 désactive la fermeture
/// automatique. Les bornes sont vérifiées par le contrôleur, qui seul connaît
/// les valeurs acceptées.</summary>
public sealed record SessionIdleTimeoutRequest([Range(0, 720)] int Minutes);

/// <summary>Nouvel agencement du tableau de bord, dans l'ordre d'affichage
/// voulu. Doit couvrir exactement le catalogue de widgets connu — le service
/// vérifie et rejette sinon plutôt que de deviner ce qui manque.</summary>
public sealed record DashboardLayoutRequest(
    [Required] List<Cyberjet.Api.Services.DashboardWidgetSetting> Widgets);
