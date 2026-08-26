using Cyberjet.Api.Contracts;
using Cyberjet.Api.Data;
using Cyberjet.Api.Middleware;
using Cyberjet.Api.Services;
using Cyberjet.Api.Services.Auth;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Cyberjet.Api.Controllers;

[ApiController]
[Route("api/auth")]
public sealed class AuthController(
    AppDbContext db,
    SessionService sessions,
    LoginThrottle throttle,
    AuditService audit,
    AppSettingsService settings,
    IOptions<SecurityOptions> security) : ControllerBase
{
    private void SetSessionCookie(string token) =>
        Response.Cookies.Append(SessionService.CookieName, token, new CookieOptions
        {
            HttpOnly = true,
            SameSite = SameSiteMode.Lax,
            MaxAge = TimeSpan.FromDays(SessionService.SessionDays),
            Path = "/",
            // Sur réseau interne servi en HTTP simple, un cookie Secure serait
            // ignoré par le navigateur et la connexion deviendrait impossible :
            // Security:RequireSecureCookies doit être posé à true explicitement
            // derrière un reverse proxy TLS plutôt que déduit de la requête
            // courante, qui peut mentir si les en-têtes forwarded sont mal
            // propagés par le proxy.
            Secure = security.Value.RequireSecureCookies || HttpContext.Request.IsHttps,
        });

    /// <summary>
    /// Délai d'attente en clair. Arrondi à la minute supérieure au-delà d'une
    /// minute : annoncer « 4 min 12 s » invite à guetter la seconde près, alors
    /// que seul l'ordre de grandeur sert à décider si l'on attend ou si l'on
    /// fait autre chose. En dessous, les secondes sont dites — « moins d'une
    /// minute » laisserait croire à un blocage plus long qu'il ne l'est.
    /// </summary>
    private static string FormatWait(TimeSpan wait)
    {
        if (wait < TimeSpan.FromMinutes(1))
        {
            var seconds = Math.Max((int)Math.Ceiling(wait.TotalSeconds), 1);
            return seconds == 1 ? "1 seconde" : $"{seconds} secondes";
        }

        var minutes = (int)Math.Ceiling(wait.TotalMinutes);
        return minutes == 1 ? "1 minute" : $"{minutes} minutes";
    }

    [HttpGet("status")]
    public async Task<AuthStatusResponse> Status(CancellationToken ct)
    {
        var needsSetup = !await db.AppUsers.AnyAsync(ct);

        // La session a déjà été résolue par le contrôle d'accès : la redemander
        // ici coûterait deux requêtes de plus sur l'appel le plus fréquent de
        // l'application.
        var user = needsSetup ? null : HttpContext.CurrentUserOrNull();
        var pending = needsSetup || user is not null ? null : HttpContext.PendingUser();

        var remaining = user is null ? 0 : await sessions.RecoveryCodesRemainingAsync(user.Id, ct);

        return new AuthStatusResponse(
            NeedsSetup: needsSetup,
            Authenticated: user is not null,
            MfaPending: pending is not null,
            UserId: user?.Id,
            Username: user?.Username,
            IsAdmin: user?.IsAdmin ?? false,
            MfaEnabled: user?.TotpEnabled ?? false,
            MfaEnabledAt: user?.MfaEnabledAt,
            RecoveryCodesRemaining: remaining,
            Email: user?.Email,
            Phone: user?.Phone,
            FullName: user?.DisplayName,
            FirstName: user?.FirstName,
            LastName: user?.LastName,
            JobTitle: user?.JobTitle,
            CreatedAt: user?.CreatedAt,
            LastLoginAt: user?.LastLoginAt,
            Preferences: Mapper.ReadPreferences(user?.Preferences),
            IdleTimeoutMinutes: settings.SessionIdleTimeoutMinutes,
            Onboarded: user?.OnboardedAt is not null);
    }

    /// <summary>Création du compte administrateur initial, à la toute première
    /// ouverture. Refusée dès qu'un compte existe.</summary>
    [HttpPost("setup")]
    [ProducesResponseType(StatusCodes.Status201Created)]
    public async Task<ActionResult<LoginResponse>> Setup(SetupRequest payload, CancellationToken ct)
    {
        if (await db.AppUsers.AnyAsync(ct))
            throw ApiException.Conflict("Un compte existe déjà : utilisez la page de connexion.");

        var username = payload.Username.Trim();
        var hashed = PasswordHasher.Hash(payload.Password);

        var user = new AppUser
        {
            Username = username,
            PasswordHash = hashed.Hash,
            PasswordSalt = hashed.Salt,
            IsAdmin = true,
            Active = true,
            CreatedAt = DateTime.UtcNow,
            LastLoginAt = DateTime.UtcNow,
        };
        db.AppUsers.Add(user);
        await db.SaveChangesAsync(ct);

        var token = await sessions.CreateSessionAsync(user.Id, ct: ct);
        SetSessionCookie(token);

        await audit.RecordAsync("auth.setup", actor: user, targetType: "user",
                                targetId: user.Id, targetLabel: username, ct: ct);

        return StatusCode(StatusCodes.Status201Created, new LoginResponse(username, true, false));
    }

    [HttpPost("login")]
    public async Task<LoginResponse> Login(LoginRequest payload, CancellationToken ct)
    {
        var username = payload.Username.Trim();
        var clientIp = audit.ClientIp();

        if (throttle.RetryAfter(username, clientIp) is { } wait)
        {
            await audit.RecordAsync("auth.login.locked", outcome: "failure", actorName: username,
                detail: $"Seuil de tentatives dépassé pour ce couple identifiant/adresse ; "
                      + $"déblocage dans {FormatWait(wait)}", ct: ct);
            throw ApiException.TooManyRequests(
                $"Trop de tentatives. Réessayez dans {FormatWait(wait)}.");
        }

        var user = await db.AppUsers.FirstOrDefaultAsync(
            u => u.Username == username && u.Active, ct);

        if (user is null || !PasswordHasher.Verify(payload.Password, user.PasswordSalt, user.PasswordHash))
        {
            throttle.RegisterFailure(username, clientIp);
            // Volontairement : on ne distingue pas « compte inconnu » de « mot de
            // passe faux », ni dans la réponse ni dans le journal.
            await audit.RecordAsync("auth.login.failure", outcome: "failure", actorName: username,
                                    detail: "Identifiant ou mot de passe incorrect", ct: ct);
            throw ApiException.Unauthorized("Identifiants incorrects.");
        }

        throttle.ClearFailures(username, clientIp);

        if (user.TotpEnabled)
        {
            // Session à demi ouverte : le second facteur reste à fournir.
            var pendingToken = await sessions.CreateSessionAsync(user.Id, mfaPending: true, ct: ct);
            SetSessionCookie(pendingToken);
            await audit.RecordAsync("auth.login.success", actor: user,
                                    detail: "Mot de passe validé, second facteur attendu", ct: ct);
            return new LoginResponse(user.Username, user.IsAdmin, MfaRequired: true);
        }

        user.LastLoginAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        var token = await sessions.CreateSessionAsync(user.Id, ct: ct);
        SetSessionCookie(token);
        await audit.RecordAsync("auth.login.success", actor: user,
                                detail: "Sans second facteur", ct: ct);

        return new LoginResponse(user.Username, user.IsAdmin, MfaRequired: false);
    }

    [HttpPost("logout")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Logout(CancellationToken ct)
    {
        var token = Request.Cookies[SessionService.CookieName];
        if (!string.IsNullOrEmpty(token))
        {
            var actor = HttpContext.CurrentUserOrNull() ?? HttpContext.PendingUser();
            if (actor is not null) await audit.RecordAsync("auth.logout", actor: actor, ct: ct);
            await sessions.DeleteSessionAsync(token, ct);
        }
        Response.Cookies.Delete(SessionService.CookieName, new CookieOptions { Path = "/" });
        return NoContent();
    }

    // ----------------------------------------------------------------------
    // Second facteur
    // ----------------------------------------------------------------------

    /// <summary>Deuxième étape de la connexion : code TOTP ou code de récupération.</summary>
    [HttpPost("mfa/verify")]
    public async Task<MfaVerifyResponse> VerifyMfa(MfaCodeRequest payload, CancellationToken ct)
    {
        var pending = HttpContext.PendingUser()
            ?? throw ApiException.Unauthorized("Aucune authentification en cours.");
        var token = Request.Cookies[SessionService.CookieName]!;
        var clientIp = audit.ClientIp();
        var lockKey = $"mfa:{pending.Username}";

        if (throttle.RetryAfter(lockKey, clientIp) is { } wait)
            throw ApiException.TooManyRequests(
                $"Trop de tentatives. Réessayez dans {FormatWait(wait)}.");

        var counter = TotpService.Verify(pending.TotpSecret, payload.Code, pending.TotpLastCounter);

        if (counter is not null)
        {
            pending.TotpLastCounter = counter;
            await db.SaveChangesAsync(ct);
            await audit.RecordAsync("mfa.verify.success", actor: pending,
                                    detail: "Code de l'application d'authentification", ct: ct);
        }
        else if (await sessions.ConsumeRecoveryCodeAsync(pending.Id, payload.Code, ct))
        {
            var left = await sessions.RecoveryCodesRemainingAsync(pending.Id, ct);
            await audit.RecordAsync("mfa.recovery.used", actor: pending,
                                    detail: $"{left} code(s) de récupération restant(s)", ct: ct);
        }
        else
        {
            throttle.RegisterFailure(lockKey, clientIp);
            await audit.RecordAsync("mfa.verify.failure", actor: pending, outcome: "failure",
                                    detail: "Code invalide, expiré ou déjà utilisé", ct: ct);
            throw ApiException.Unauthorized("Code invalide.");
        }

        throttle.ClearFailures(lockKey, clientIp);
        await sessions.PromoteSessionAsync(token, ct);

        pending.LastLoginAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        var remaining = await sessions.RecoveryCodesRemainingAsync(pending.Id, ct);
        return new MfaVerifyResponse(pending.Username, pending.IsAdmin, remaining);
    }

    /// <summary>Abandon de la connexion à l'étape du second facteur.</summary>
    [HttpPost("mfa/cancel")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> CancelMfa(CancellationToken ct)
    {
        var token = Request.Cookies[SessionService.CookieName];
        if (!string.IsNullOrEmpty(token)) await sessions.DeleteSessionAsync(token, ct);
        Response.Cookies.Delete(SessionService.CookieName, new CookieOptions { Path = "/" });
        return NoContent();
    }

    /// <summary>
    /// Prépare un secret TOTP. Il reste en attente tant qu'un premier code n'a pas
    /// été vérifié : impossible de se verrouiller dehors en enregistrant un secret
    /// jamais scanné.
    /// </summary>
    [HttpPost("mfa/totp/init")]
    public async Task<TotpEnrollmentResponse> InitTotp(CancellationToken ct)
    {
        var user = HttpContext.CurrentUser();
        if (user.TotpEnabled)
            throw ApiException.Conflict("Le second facteur est déjà activé sur ce compte.");

        var secret = TotpService.GenerateSecret();
        user.TotpPendingSecret = secret;
        await db.SaveChangesAsync(ct);

        var uri = TotpService.BuildUri(secret, user.Username);
        return new TotpEnrollmentResponse(
            TotpService.FormatForDisplay(secret), uri, TotpService.BuildQrSvg(uri));
    }

    /// <summary>Confirme l'enrôlement et délivre les codes de récupération.</summary>
    [HttpPost("mfa/totp/activate")]
    public async Task<RecoveryCodesResponse> ActivateTotp(MfaCodeRequest payload, CancellationToken ct)
    {
        var user = HttpContext.CurrentUser();
        var secret = user.TotpPendingSecret;
        if (string.IsNullOrEmpty(secret))
            throw ApiException.Conflict("Aucun enrôlement en cours. Recommencez la configuration.");

        var counter = TotpService.Verify(secret, payload.Code);
        if (counter is null)
        {
            await audit.RecordAsync("mfa.verify.failure", actor: user, outcome: "failure",
                                    detail: "Code incorrect lors de l'enrôlement", ct: ct);
            throw ApiException.BadRequest("Code incorrect. Vérifiez l'heure de votre téléphone.");
        }

        user.TotpSecret = secret;
        user.TotpPendingSecret = null;
        user.TotpEnabled = true;
        user.TotpLastCounter = counter;
        user.MfaEnabledAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        var codes = await sessions.GenerateRecoveryCodesAsync(user.Id, ct);

        // Les autres sessions du compte datent d'avant le durcissement : on les
        // révoque pour qu'elles repassent par le second facteur.
        var revoked = await sessions.DeleteUserSessionsAsync(
            user.Id, Request.Cookies[SessionService.CookieName], ct);

        await audit.RecordAsync("mfa.enabled", actor: user,
            detail: $"Application d'authentification (TOTP) ; {codes.Count} codes de "
                  + $"récupération émis ; {revoked} autre(s) session(s) révoquée(s)", ct: ct);

        return new RecoveryCodesResponse(codes);
    }

    /// <summary>Désactive le second facteur. Le mot de passe est redemandé : sans
    /// cela, une session volée suffirait à retirer la protection qu'elle contourne.</summary>
    [HttpPost("mfa/disable")]
    public async Task<object> DisableMfa(PasswordConfirmRequest payload, CancellationToken ct)
    {
        var user = HttpContext.CurrentUser();

        if (!PasswordHasher.Verify(payload.Password, user.PasswordSalt, user.PasswordHash))
        {
            await audit.RecordAsync("mfa.disabled", actor: user, outcome: "failure",
                                    detail: "Mot de passe incorrect à la confirmation", ct: ct);
            throw ApiException.Unauthorized("Mot de passe incorrect.");
        }
        if (!user.TotpEnabled)
            throw ApiException.Conflict("Le second facteur n'est pas activé.");

        await sessions.DisableMfaAsync(user.Id, ct);
        await audit.RecordAsync("mfa.disabled", actor: user,
                                detail: "Désactivé par l'utilisateur lui-même", ct: ct);

        return new { mfaEnabled = false };
    }

    /// <summary>Réémet un jeu complet de codes. Les précédents sont invalidés.</summary>
    [HttpPost("mfa/recovery/regenerate")]
    public async Task<RecoveryCodesResponse> RegenerateRecovery(
        PasswordConfirmRequest payload, CancellationToken ct)
    {
        var user = HttpContext.CurrentUser();

        if (!PasswordHasher.Verify(payload.Password, user.PasswordSalt, user.PasswordHash))
            throw ApiException.Unauthorized("Mot de passe incorrect.");
        if (!user.TotpEnabled)
            throw ApiException.Conflict("Activez d'abord le second facteur.");

        var codes = await sessions.GenerateRecoveryCodesAsync(user.Id, ct);
        await audit.RecordAsync("mfa.recovery.regenerated", actor: user,
            detail: $"{codes.Count} nouveaux codes ; les précédents sont invalidés", ct: ct);

        return new RecoveryCodesResponse(codes);
    }
}
