using System.Security.Cryptography;
using System.Text;
using Cyberjet.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Cyberjet.Api.Services.Auth;

/// <summary>Un compte en ligne, et l'instant de sa dernière activité connue.</summary>
public sealed record OnlinePresence(AppUser User, DateTime LastSeenAt);

/// <summary>
/// Sessions serveur et codes de récupération.
///
/// Les sessions sont stockées en base plutôt que dans un cookie signé ou un JWT :
/// une session se révoque alors immédiatement — désactivation d'un compte,
/// changement de mot de passe, déconnexion à distance — sans dépendre d'une date
/// d'expiration de jeton qu'on ne peut pas rattraper.
///
/// Deux échéances coexistent : <see cref="SessionDays"/> borne la durée totale,
/// et le délai d'inactivité (<c>Security:SessionIdleTimeoutMinutes</c>) ferme un
/// poste laissé sans surveillance.
/// </summary>
public sealed class SessionService(AppDbContext db, AppSettingsService settings)
{
    public const string CookieName = "cyberjet_session";
    public const int SessionDays = 30;

    private TimeSpan? IdleTimeout =>
        settings.SessionIdleTimeoutMinutes > 0
            ? TimeSpan.FromMinutes(settings.SessionIdleTimeoutMinutes)
            : null;

    /// <summary>Fenêtre de présence : une session vue plus récemment que ça est
    /// considérée « en ligne ». Le front interroge <c>/api/presence</c> toutes
    /// les 30 secondes, et cet appel — comme n'importe quelle requête
    /// authentifiée — rafraîchit lui-même <see cref="AppSession.LastSeenAt"/> ;
    /// une marge de 4× absorbe un onglet mis en arrière-plan sans faire
    /// disparaître quelqu'un de la liste entre deux sondages.</summary>
    public static readonly TimeSpan PresenceWindow = TimeSpan.FromMinutes(2);

    private const int RecoveryCodeCount = 10;

    /// <summary>Sans I, O, 0 ni 1 : ces codes sont recopiés à la main depuis un
    /// papier ou un gestionnaire de mots de passe.</summary>
    private const string RecoveryAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    private static DateTime Expiry() => DateTime.UtcNow.AddDays(SessionDays);

    /// <summary>Ouvre une session. <paramref name="mfaPending"/> marque une session
    /// à demi ouverte : le mot de passe est validé, le second facteur pas encore.</summary>
    public async Task<string> CreateSessionAsync(int userId, bool mfaPending = false,
                                                 CancellationToken ct = default)
    {
        var token = Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        var now = DateTime.UtcNow;
        db.AppSessions.Add(new AppSession
        {
            Token = token,
            UserId = userId,
            CreatedAt = now,
            ExpiresAt = Expiry(),
            LastSeenAt = now,
            MfaPending = mfaPending,
        });
        await db.SaveChangesAsync(ct);
        return token;
    }

    /// <summary>
    /// Utilisateur d'une session pleinement authentifiée, ou <c>null</c>.
    ///
    /// Une session en attente de second facteur est délibérément traitée comme
    /// absente : elle ne doit ouvrir aucun accès en dehors de la vérification MFA.
    ///
    /// Prolonge la session à chaque appel réussi (fenêtre glissante) : un usage
    /// régulier ne redemande quasiment jamais de se reconnecter, sans pour autant
    /// garder une session active indéfiniment.
    ///
    /// Une session restée inactive au-delà du délai configuré est fermée sur
    /// place plutôt qu'ignorée : un jeton périmé ne doit pas survivre en base
    /// jusqu'à son échéance absolue, où il resterait exploitable si la valeur du
    /// délai venait à être rallongée entre-temps.
    /// </summary>
    public async Task<AppUser?> GetSessionUserAsync(string? token, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(token)) return null;

        var now = DateTime.UtcNow;
        var session = await db.AppSessions
            .Include(s => s.User)
            .FirstOrDefaultAsync(s => s.Token == token
                                   && s.ExpiresAt > now
                                   && !s.MfaPending
                                   && s.User.Active, ct);
        if (session is null) return null;

        if (IdleTimeout is { } idle && now - session.LastSeenAt > idle)
        {
            db.AppSessions.Remove(session);
            await db.SaveChangesAsync(ct);
            return null;
        }

        session.ExpiresAt = Expiry();
        session.LastSeenAt = now;
        await db.SaveChangesAsync(ct);
        return session.User;
    }

    /// <summary>
    /// Comptes actuellement en ligne : une session pleinement authentifiée, vue
    /// dans la fenêtre de présence. Un compte ouvert sur deux postes ou deux
    /// onglets n'apparaît qu'une fois, à sa plus récente activité.
    /// </summary>
    public async Task<List<OnlinePresence>> GetOnlineUsersAsync(CancellationToken ct = default)
    {
        var since = DateTime.UtcNow - PresenceWindow;

        // Type anonyme puis jointure en mémoire, et non un Select qui
        // construirait le record directement depuis le GroupBy : EF Core ne sait
        // pas traduire cette forme (la même erreur avait fait tomber
        // /api/stats). Le nombre de sessions concurrentes reste ici minuscule —
        // deux requêtes valent mieux qu'une jointure SQL qui échouerait.
        var rows = await db.AppSessions.AsNoTracking()
            .Where(s => !s.MfaPending && s.LastSeenAt >= since && s.User.Active)
            .GroupBy(s => s.UserId)
            .Select(g => new { UserId = g.Key, LastSeenAt = g.Max(s => s.LastSeenAt) })
            .ToListAsync(ct);
        if (rows.Count == 0) return [];

        var ids = rows.Select(r => r.UserId).ToList();
        var users = await db.AppUsers.AsNoTracking()
            .Where(u => ids.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, ct);

        return rows
            .Where(r => users.ContainsKey(r.UserId))
            .Select(r => new OnlinePresence(users[r.UserId], r.LastSeenAt))
            .OrderByDescending(p => p.LastSeenAt)
            .ToList();
    }

    /// <summary>Utilisateur d'une session en attente de second facteur, ou <c>null</c>.</summary>
    public async Task<AppUser?> GetPendingSessionUserAsync(string? token, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(token)) return null;

        var now = DateTime.UtcNow;
        var session = await db.AppSessions
            .Include(s => s.User)
            .FirstOrDefaultAsync(s => s.Token == token
                                   && s.ExpiresAt > now
                                   && s.MfaPending
                                   && s.User.Active, ct);
        return session?.User;
    }

    /// <summary>Second facteur validé : la session devient pleinement authentifiée.</summary>
    public async Task PromoteSessionAsync(string token, CancellationToken ct = default) =>
        await db.AppSessions.Where(s => s.Token == token)
                .ExecuteUpdateAsync(set => set.SetProperty(s => s.MfaPending, false), ct);

    public async Task DeleteSessionAsync(string token, CancellationToken ct = default) =>
        await db.AppSessions.Where(s => s.Token == token).ExecuteDeleteAsync(ct);

    /// <summary>
    /// Révoque toutes les sessions d'un compte, sauf éventuellement la courante,
    /// et renvoie le nombre de sessions fermées.
    ///
    /// Utilisé après un changement de mot de passe ou de configuration MFA : si un
    /// jeton a fuité, il ne doit pas survivre au durcissement du compte.
    /// </summary>
    public async Task<int> DeleteUserSessionsAsync(int userId, string? keepToken = null,
                                                   CancellationToken ct = default)
    {
        var query = db.AppSessions.Where(s => s.UserId == userId);
        if (!string.IsNullOrEmpty(keepToken))
            query = query.Where(s => s.Token != keepToken);
        return await query.ExecuteDeleteAsync(ct);
    }

    /// <summary>Purge les sessions échues, qu'elles aient atteint leur échéance
    /// absolue ou dépassé le délai d'inactivité. Appelée au démarrage : sans
    /// elle, les sessions ouvertes avant un arrêt du serveur resteraient en base
    /// alors que personne ne les rouvrira.</summary>
    public async Task CleanupExpiredSessionsAsync(CancellationToken ct = default)
    {
        var now = DateTime.UtcNow;
        await db.AppSessions.Where(s => s.ExpiresAt <= now).ExecuteDeleteAsync(ct);

        if (IdleTimeout is { } idle)
        {
            var cutoff = now - idle;
            await db.AppSessions.Where(s => s.LastSeenAt <= cutoff).ExecuteDeleteAsync(ct);
        }
    }

    // ----------------------------------------------------------------------
    // Codes de récupération
    //
    // Hachés en SHA-256 et non en PBKDF2 : ces codes sont tirés au hasard avec
    // ~60 bits d'entropie, ils ne sont pas devinables par force brute comme le
    // serait un mot de passe choisi par un humain. Un hachage lent obligerait par
    // ailleurs à dérouler jusqu'à dix dérivations coûteuses à chaque essai.
    // ----------------------------------------------------------------------

    private static string NormalizeRecovery(string? code) =>
        new((code ?? "").ToUpperInvariant().Where(RecoveryAlphabet.Contains).ToArray());

    private static string HashRecovery(string code) =>
        Convert.ToHexString(SHA256.HashData(Encoding.ASCII.GetBytes(NormalizeRecovery(code))))
               .ToLowerInvariant();

    /// <summary>
    /// Remplace les codes existants et renvoie les nouveaux, en clair. C'est le
    /// seul moment où ils sont lisibles : seules leurs empreintes sont conservées.
    /// </summary>
    public async Task<List<string>> GenerateRecoveryCodesAsync(int userId, CancellationToken ct = default)
    {
        await db.RecoveryCodes.Where(c => c.UserId == userId).ExecuteDeleteAsync(ct);

        var codes = new List<string>(RecoveryCodeCount);
        for (var i = 0; i < RecoveryCodeCount; i++)
        {
            var raw = new string(Enumerable.Range(0, 12)
                .Select(_ => RecoveryAlphabet[RandomNumberGenerator.GetInt32(RecoveryAlphabet.Length)])
                .ToArray());
            var pretty = $"{raw[..4]}-{raw[4..8]}-{raw[8..]}";
            codes.Add(pretty);

            db.RecoveryCodes.Add(new RecoveryCode
            {
                UserId = userId,
                CodeHash = HashRecovery(pretty),
                CreatedAt = DateTime.UtcNow,
            });
        }
        await db.SaveChangesAsync(ct);
        return codes;
    }

    /// <summary>Valide un code de récupération et le marque comme utilisé (usage unique).</summary>
    public async Task<bool> ConsumeRecoveryCodeAsync(int userId, string code, CancellationToken ct = default)
    {
        if (NormalizeRecovery(code).Length != 12) return false;

        var candidate = HashRecovery(code);
        var entry = await db.RecoveryCodes
            .FirstOrDefaultAsync(c => c.UserId == userId
                                   && c.CodeHash == candidate
                                   && c.UsedAt == null, ct);
        if (entry is null) return false;

        entry.UsedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return true;
    }

    public Task<int> RecoveryCodesRemainingAsync(int userId, CancellationToken ct = default) =>
        db.RecoveryCodes.CountAsync(c => c.UserId == userId && c.UsedAt == null, ct);

    /// <summary>Retire le second facteur et purge tout ce qui s'y rattache.</summary>
    public async Task DisableMfaAsync(int userId, CancellationToken ct = default)
    {
        await db.AppUsers.Where(u => u.Id == userId).ExecuteUpdateAsync(set => set
            .SetProperty(u => u.TotpSecret, (string?)null)
            .SetProperty(u => u.TotpPendingSecret, (string?)null)
            .SetProperty(u => u.TotpEnabled, false)
            .SetProperty(u => u.TotpLastCounter, (long?)null)
            .SetProperty(u => u.MfaEnabledAt, (DateTime?)null), ct);

        await db.RecoveryCodes.Where(c => c.UserId == userId).ExecuteDeleteAsync(ct);
    }

    private static string Base64UrlEncode(byte[] data) =>
        Convert.ToBase64String(data).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
