using Cyberjet.Api.Contracts;
using Cyberjet.Api.Data;
using Cyberjet.Api.Middleware;
using Cyberjet.Api.Services;
using Cyberjet.Api.Services.Auth;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Cyberjet.Api.Controllers;

/// <summary>
/// Gestion des comptes — réservée aux administrateurs.
///
/// Toute personne connectée peut consulter et modifier les dossiers clients ;
/// seul le rôle administrateur décide qui a accès.
/// </summary>
[ApiController]
[Route("api/users")]
public sealed class UsersController(
    AppDbContext db, SessionService sessions, AuditService audit,
    LoginThrottle throttle) : ControllerBase
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
    public async Task<List<PublicUserResponse>> List(CancellationToken ct)
    {
        await RequireAdminAsync(ct);
        var users = await db.AppUsers.OrderBy(u => u.Username).ToListAsync(ct);
        return [.. users.Select(user =>
            Mapper.ToPublicUser(user, throttle.RetryAfterAnywhere(user.Username)))];
    }

    [HttpPost]
    [ProducesResponseType(StatusCodes.Status201Created)]
    public async Task<ActionResult<PublicUserResponse>> Create(
        UserCreateRequest payload, CancellationToken ct)
    {
        var admin = await RequireAdminAsync(ct);
        var username = payload.Username.Trim();

        if (await db.AppUsers.AnyAsync(u => u.Username == username, ct))
            throw ApiException.Conflict("Ce nom d'utilisateur existe déjà.");

        var hashed = PasswordHasher.Hash(payload.Password);
        var user = new AppUser
        {
            Username = username,
            PasswordHash = hashed.Hash,
            PasswordSalt = hashed.Salt,
            IsAdmin = payload.IsAdmin,
            Active = true,
            CreatedAt = DateTime.UtcNow,
            Email = Mapper.CleanEmail(payload.Email),
            FirstName = Mapper.CleanText(payload.FirstName),
            LastName = Mapper.CleanText(payload.LastName),
        };
        db.AppUsers.Add(user);
        await db.SaveChangesAsync(ct);

        await audit.RecordAsync("user.created", actor: admin, targetType: "user",
            targetId: user.Id, targetLabel: username,
            detail: payload.IsAdmin ? "Administrateur" : "Membre", ct: ct);

        return StatusCode(StatusCodes.Status201Created, Mapper.ToPublicUser(user));
    }

    [HttpPatch("{userId:int}")]
    public async Task<PublicUserResponse> Patch(
        int userId, UserPatchRequest payload, CancellationToken ct)
    {
        var admin = await RequireAdminAsync(ct);
        var target = await db.AppUsers.FirstOrDefaultAsync(u => u.Id == userId, ct)
            ?? throw ApiException.NotFound("Compte introuvable.");

        if (userId == admin.Id && (payload.IsAdmin == false || payload.Active == false))
            throw ApiException.BadRequest(
                "Impossible de modifier vos propres droits d'administration ou de "
                + "désactiver votre propre compte.");

        // Retirer le dernier administrateur actif fermerait la porte de
        // l'administration à tout le monde, sans recours dans l'application.
        if (payload.IsAdmin == false || payload.Active == false)
        {
            var otherAdmins = await db.AppUsers.CountAsync(
                u => u.IsAdmin && u.Active && u.Id != userId, ct);
            if (otherAdmins == 0)
                throw ApiException.BadRequest(
                    "Impossible : il doit rester au moins un administrateur actif.");
        }

        var wasAdmin = target.IsAdmin;
        var wasActive = target.Active;

        if (!string.IsNullOrEmpty(payload.Password))
        {
            var hashed = PasswordHasher.Hash(payload.Password);
            target.PasswordHash = hashed.Hash;
            target.PasswordSalt = hashed.Salt;
        }
        if (payload.IsAdmin is not null) target.IsAdmin = payload.IsAdmin.Value;
        if (payload.Active is not null) target.Active = payload.Active.Value;
        if (payload.Email is not null) target.Email = Mapper.CleanEmail(payload.Email);
        if (payload.FirstName is not null) target.FirstName = Mapper.CleanText(payload.FirstName);
        if (payload.LastName is not null) target.LastName = Mapper.CleanText(payload.LastName);

        await db.SaveChangesAsync(ct);

        if (!string.IsNullOrEmpty(payload.Password))
        {
            // Un mot de passe changé par un tiers doit chasser les sessions
            // ouvertes : sinon l'ancien détenteur reste connecté.
            var revoked = await sessions.DeleteUserSessionsAsync(userId, ct: ct);

            // Et lever le verrouillage : le mot de passe qu'on vient de poser
            // ne sert à rien si le compte reste bloqué. L'oublier ferait croire
            // à l'administrateur qu'il a dépanné son collègue, qui resterait
            // dehors sans comprendre pourquoi.
            var unlocked = throttle.ClearAll(target.Username);

            await audit.RecordAsync("user.password.changed", actor: admin, targetType: "user",
                targetId: userId, targetLabel: target.Username,
                detail: $"Réinitialisé par un administrateur ; {revoked} session(s) révoquée(s)"
                      + (unlocked > 0 ? " ; verrouillage anti-bruteforce levé" : ""),
                ct: ct);
        }
        if (payload.IsAdmin is not null && payload.IsAdmin.Value != wasAdmin)
        {
            await audit.RecordAsync("user.role.changed", actor: admin, targetType: "user",
                targetId: userId, targetLabel: target.Username,
                detail: payload.IsAdmin.Value
                    ? "Promu administrateur" : "Droits d'administration retirés", ct: ct);
        }
        if (payload.Active is not null && payload.Active.Value != wasActive)
        {
            if (payload.Active.Value)
            {
                await audit.RecordAsync("user.reactivated", actor: admin, targetType: "user",
                    targetId: userId, targetLabel: target.Username, ct: ct);
            }
            else
            {
                var revoked = await sessions.DeleteUserSessionsAsync(userId, ct: ct);
                await audit.RecordAsync("user.deactivated", actor: admin, targetType: "user",
                    targetId: userId, targetLabel: target.Username,
                    detail: $"{revoked} session(s) révoquée(s)", ct: ct);
            }
        }

        return Mapper.ToPublicUser(target, throttle.RetryAfterAnywhere(target.Username));
    }

    /// <summary>
    /// Retire le second facteur d'un compte — le recours quand un collègue a perdu
    /// son téléphone et ses codes de récupération.
    ///
    /// Opération sensible : elle ramène le compte à un simple mot de passe, elle
    /// est donc journalisée en nommant l'administrateur qui l'a demandée.
    /// </summary>
    [HttpPost("{userId:int}/mfa/reset")]
    public async Task<PublicUserResponse> ResetMfa(int userId, CancellationToken ct)
    {
        var admin = await RequireAdminAsync(ct);
        var target = await db.AppUsers.FirstOrDefaultAsync(u => u.Id == userId, ct)
            ?? throw ApiException.NotFound("Compte introuvable.");

        if (!target.TotpEnabled)
            throw ApiException.Conflict("Ce compte n'a pas de second facteur activé.");

        await sessions.DisableMfaAsync(userId, ct);
        var revoked = await sessions.DeleteUserSessionsAsync(userId, ct: ct);

        await audit.RecordAsync("mfa.reset.admin", actor: admin, targetType: "user",
            targetId: userId, targetLabel: target.Username,
            detail: $"Second facteur retiré ; {revoked} session(s) révoquée(s). "
                  + "Le compte n'est plus protégé que par son mot de passe.", ct: ct);

        await db.Entry(target).ReloadAsync(ct);
        return Mapper.ToPublicUser(target, throttle.RetryAfterAnywhere(target.Username));
    }

    /// <summary>
    /// Lève le verrouillage anti-bruteforce d'un compte, depuis toutes les
    /// adresses — la personne appelle pour dire qu'elle est bloquée, on ne va
    /// pas lui demander son adresse IP.
    ///
    /// Le compteur vit en mémoire : ce geste ne touche pas la base, et le
    /// journal d'audit est donc la seule trace qu'il ait eu lieu. Il en faut
    /// une : débloquer, c'est retirer la protection qui ralentit une attaque
    /// par force brute, et l'administrateur qui le demande doit être nommé.
    /// </summary>
    [HttpPost("{userId:int}/unlock")]
    public async Task<PublicUserResponse> Unlock(int userId, CancellationToken ct)
    {
        var admin = await RequireAdminAsync(ct);
        var target = await db.AppUsers.FirstOrDefaultAsync(u => u.Id == userId, ct)
            ?? throw ApiException.NotFound("Compte introuvable.");

        if (throttle.RetryAfterAnywhere(target.Username) is null)
            throw ApiException.Conflict("Ce compte n'est pas verrouillé.");

        var cleared = throttle.ClearAll(target.Username);

        await audit.RecordAsync("auth.unlocked", actor: admin, targetType: "user",
            targetId: userId, targetLabel: target.Username,
            detail: $"Verrouillage anti-bruteforce levé pour {cleared} adresse(s). "
                  + "Le compte peut de nouveau tenter de se connecter.", ct: ct);

        return Mapper.ToPublicUser(target);
    }

    [HttpDelete("{userId:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(int userId, CancellationToken ct)
    {
        var admin = await RequireAdminAsync(ct);
        if (userId == admin.Id)
            throw ApiException.BadRequest("Impossible de supprimer votre propre compte.");

        var target = await db.AppUsers.FirstOrDefaultAsync(u => u.Id == userId, ct)
            ?? throw ApiException.NotFound("Compte introuvable.");

        if (target.IsAdmin)
        {
            var otherAdmins = await db.AppUsers.CountAsync(
                u => u.IsAdmin && u.Active && u.Id != userId, ct);
            if (otherAdmins == 0)
                throw ApiException.BadRequest("Impossible : il doit rester au moins un administrateur.");
        }

        var username = target.Username;
        db.AppUsers.Remove(target);
        await db.SaveChangesAsync(ct);

        // Le nom est conservé dans la trace : le compte disparaît, pas son
        // historique d'actions.
        await audit.RecordAsync("user.deleted", actor: admin, targetType: "user",
                                targetId: userId, targetLabel: username, ct: ct);
        return NoContent();
    }
}
