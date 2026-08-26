using Cyberjet.Api.Contracts;
using Cyberjet.Api.Data;
using Cyberjet.Api.Middleware;
using Cyberjet.Api.Services;
using Cyberjet.Api.Services.Auth;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Cyberjet.Api.Controllers;

/// <summary>
/// Tout ce qui porte sur le compte de la personne connectée : aucun de ces
/// endpoints ne prend d'identifiant en paramètre. La gestion des comptes des
/// autres reste sous <c>/api/users</c> et réservée aux administrateurs.
/// </summary>
[ApiController]
[Route("api/account")]
public sealed class AccountController(
    AppDbContext db, SessionService sessions, AuditService audit) : ControllerBase
{
    [HttpGet]
    public Task<AccountResponse> Get(CancellationToken ct) =>
        BuildAsync(HttpContext.CurrentUser(), ct);

    /// <summary>
    /// Fiche du compte. L'identifiant de connexion, lui, n'est pas modifiable :
    /// il sert de clé dans le journal d'audit, où réécrire l'histoire n'est pas
    /// une option.
    /// </summary>
    [HttpPatch]
    public async Task<AccountResponse> Update(AccountProfileRequest payload, CancellationToken ct)
    {
        var user = HttpContext.CurrentUser();

        // `null` = champ non transmis, chaîne vide = effacer. Cette distinction est
        // ce qui rend « retirer mon numéro » exprimable.
        var changed = new List<string>();

        void Apply(string label, string? incoming, Func<string?> read, Action<string?> write)
        {
            if (incoming is null) return;
            var cleaned = label switch
            {
                "adresse" => Mapper.CleanEmail(incoming),
                "téléphone" => Mapper.CleanPhone(incoming),
                _ => Mapper.CleanText(incoming),
            };
            if (read() == cleaned) return;
            write(cleaned);
            changed.Add(label);
        }

        Apply("prénom", payload.FirstName, () => user.FirstName, v => user.FirstName = v);
        Apply("nom", payload.LastName, () => user.LastName, v => user.LastName = v);
        Apply("intitulé de poste", payload.JobTitle, () => user.JobTitle, v => user.JobTitle = v);
        Apply("adresse", payload.Email, () => user.Email, v => user.Email = v);
        Apply("téléphone", payload.Phone, () => user.Phone, v => user.Phone = v);

        if (changed.Count > 0)
        {
            await db.SaveChangesAsync(ct);
            await audit.RecordAsync("account.profile.updated", actor: user, targetType: "user",
                targetId: user.Id, targetLabel: user.Username,
                detail: "Champs modifiés : " + string.Join(", ", changed), ct: ct);
        }

        return await BuildAsync(user, ct);
    }

    /// <summary>
    /// Réglages d'affichage. Volontairement hors journal d'audit : un thème changé
    /// n'est pas un événement de sécurité, et noyer le journal sous ce bruit lui
    /// ferait perdre sa valeur.
    /// </summary>
    [HttpPut("preferences")]
    public async Task<Dictionary<string, string>> UpdatePreferences(
        PreferencesRequest payload, CancellationToken ct)
    {
        var user = HttpContext.CurrentUser();
        var merged = Mapper.MergePreferences(user.Preferences, payload);
        user.Preferences = Mapper.SerializePreferences(merged);
        await db.SaveChangesAsync(ct);
        return merged;
    }

    /// <summary>
    /// Changement de mot de passe par son titulaire. Le mot de passe actuel est
    /// exigé, et les autres sessions tombent : un jeton volé ne doit pas survivre
    /// au changement censé le neutraliser.
    /// </summary>
    [HttpPost("password")]
    public async Task<object> ChangePassword(PasswordChangeRequest payload, CancellationToken ct)
    {
        var user = HttpContext.CurrentUser();
        var token = Request.Cookies[SessionService.CookieName];

        if (!PasswordHasher.Verify(payload.CurrentPassword, user.PasswordSalt, user.PasswordHash))
        {
            await audit.RecordAsync("account.password.changed", actor: user, outcome: "failure",
                targetType: "user", targetId: user.Id, targetLabel: user.Username,
                detail: "Mot de passe actuel incorrect", ct: ct);
            throw ApiException.Unauthorized("Mot de passe actuel incorrect.");
        }
        if (payload.NewPassword == payload.CurrentPassword)
            throw ApiException.Unprocessable("Le nouveau mot de passe doit être différent de l'actuel.");

        var hashed = PasswordHasher.Hash(payload.NewPassword);
        user.PasswordHash = hashed.Hash;
        user.PasswordSalt = hashed.Salt;
        await db.SaveChangesAsync(ct);

        var revoked = await sessions.DeleteUserSessionsAsync(user.Id, token, ct);
        await audit.RecordAsync("account.password.changed", actor: user, targetType: "user",
            targetId: user.Id, targetLabel: user.Username,
            detail: $"{revoked} autre(s) session(s) révoquée(s)", ct: ct);

        return new { revokedSessions = revoked };
    }

    /// <summary>Déconnecte partout ailleurs. Confirmé par mot de passe, comme tout
    /// ce qui touche à l'accès au compte.</summary>
    [HttpPost("sessions/revoke")]
    public async Task<object> RevokeOtherSessions(PasswordConfirmRequest payload, CancellationToken ct)
    {
        var user = HttpContext.CurrentUser();
        var token = Request.Cookies[SessionService.CookieName];

        if (!PasswordHasher.Verify(payload.Password, user.PasswordSalt, user.PasswordHash))
            throw ApiException.Unauthorized("Mot de passe incorrect.");

        var revoked = await sessions.DeleteUserSessionsAsync(user.Id, token, ct);
        await audit.RecordAsync("account.sessions.revoked", actor: user, targetType: "user",
            targetId: user.Id, targetLabel: user.Username,
            detail: $"{revoked} session(s) fermée(s) à distance", ct: ct);

        return new { revokedSessions = revoked };
    }

    /// <summary>
    /// Marque la visite guidée comme faite — vue jusqu'au bout ou passée
    /// explicitement, les deux comptent. Idempotent : la rappeler une fois déjà
    /// posée ne réécrit pas la date, pour que celle-ci reste celle du premier
    /// passage plutôt que du dernier clic sur « Passer ».
    ///
    /// Pas de journal d'audit ici : ce n'est pas une action sur la sécurité ou
    /// l'accès du compte, seulement l'écran qui ne se propose plus.
    /// </summary>
    [HttpPost("onboarded")]
    public async Task<object> MarkOnboarded(CancellationToken ct)
    {
        var user = HttpContext.CurrentUser();
        if (user.OnboardedAt is null)
        {
            user.OnboardedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
        }
        return new { onboarded = true };
    }

    private async Task<AccountResponse> BuildAsync(AppUser user, CancellationToken ct)
    {
        var token = Request.Cookies[SessionService.CookieName];

        var openSessions = await db.AppSessions
            .Where(s => s.UserId == user.Id && !s.MfaPending)
            .OrderByDescending(s => s.CreatedAt)
            .Select(s => new { s.Token, s.CreatedAt, s.ExpiresAt })
            .ToListAsync(ct);

        return new AccountResponse(
            user.Id, user.Username, user.FirstName, user.LastName, user.DisplayName,
            user.Email, user.Phone, user.JobTitle, user.IsAdmin, user.CreatedAt, user.LastLoginAt,
            user.TotpEnabled, user.MfaEnabledAt,
            await sessions.RecoveryCodesRemainingAsync(user.Id, ct),
            Mapper.ReadPreferences(user.Preferences),
            [.. openSessions.Select(s => new SessionResponse(
                s.CreatedAt, s.ExpiresAt, !string.IsNullOrEmpty(token) && s.Token == token))]);
    }
}
