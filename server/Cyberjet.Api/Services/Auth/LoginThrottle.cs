using System.Collections.Concurrent;

namespace Cyberjet.Api.Services.Auth;

/// <summary>
/// Anti-bruteforce simple, en mémoire : suffisant pour un outil interne à
/// quelques dizaines d'utilisateurs. Réinitialisé au redémarrage du serveur, ce
/// qui est acceptable — l'objectif est de ralentir, pas d'auditer ; c'est le
/// journal d'audit qui conserve la trace.
///
/// La clé est le couple (identifiant, adresse IP) et non l'identifiant seul :
/// sur un réseau partagé, verrouiller par identifiant permettrait à n'importe
/// qui d'empêcher un collègue de se connecter en échouant délibérément cinq fois
/// à sa place depuis un autre poste.
/// </summary>
public sealed class LoginThrottle
{
    public const int Threshold = 5;
    public static readonly TimeSpan Window = TimeSpan.FromMinutes(15);

    private readonly ConcurrentDictionary<string, List<DateTimeOffset>> _failures = new();

    private static string Key(string identifier, string? clientIp) =>
        $"{identifier.Trim().ToLowerInvariant()}|{(string.IsNullOrWhiteSpace(clientIp) ? "inconnu" : clientIp)}";

    public bool IsLockedOut(string identifier, string? clientIp) =>
        RetryAfter(identifier, clientIp) is not null;

    /// <summary>
    /// Combien de temps avant de pouvoir réessayer, ou <c>null</c> si le compte
    /// n'est pas verrouillé.
    ///
    /// La fenêtre glisse : chaque tentative expire quinze minutes après avoir eu
    /// lieu, indépendamment des autres. Le déblocage arrive donc à l'expiration
    /// de la plus ancienne des tentatives retenues — celle qui, en sortant,
    /// ramène le décompte sous le seuil. Ce n'est pas la dernière tentative qui
    /// fait foi, contrairement à ce qu'on suppose spontanément.
    /// </summary>
    public TimeSpan? RetryAfter(string identifier, string? clientIp)
    {
        var key = Key(identifier, clientIp);
        if (!_failures.TryGetValue(key, out var attempts)) return null;

        lock (attempts)
        {
            var now = DateTimeOffset.UtcNow;
            attempts.RemoveAll(at => at <= now - Window);
            if (attempts.Count < Threshold) return null;

            // Les tentatives sont ajoutées dans l'ordre : la plus ancienne à
            // devoir sortir est celle qui précède les `Threshold - 1` dernières.
            var releasing = attempts[attempts.Count - Threshold];
            var remaining = releasing + Window - now;
            return remaining > TimeSpan.Zero ? remaining : null;
        }
    }

    public void RegisterFailure(string identifier, string? clientIp)
    {
        var attempts = _failures.GetOrAdd(Key(identifier, clientIp), _ => []);
        lock (attempts)
        {
            attempts.RemoveAll(at => at <= DateTimeOffset.UtcNow - Window);
            attempts.Add(DateTimeOffset.UtcNow);
        }
    }

    public void ClearFailures(string identifier, string? clientIp) =>
        _failures.TryRemove(Key(identifier, clientIp), out _);

    /// <summary>
    /// Le compte est-il verrouillé depuis au moins une adresse, et pour combien
    /// de temps encore ?
    ///
    /// La clé du compteur mêle identifiant et adresse : un même compte peut
    /// donc être bloqué depuis un poste et libre depuis un autre. On rend ici
    /// le délai le plus long, celui qui décrit la situation telle que la
    /// personne la vit — elle rappelle rarement pour dire « je suis bloqué,
    /// mais seulement depuis le poste du couloir ».
    /// </summary>
    public TimeSpan? RetryAfterAnywhere(string identifier)
    {
        var prefix = $"{identifier.Trim().ToLowerInvariant()}|";
        TimeSpan? longest = null;

        foreach (var entry in _failures)
        {
            if (!entry.Key.StartsWith(prefix, StringComparison.Ordinal)) continue;

            var ip = entry.Key[prefix.Length..];
            var wait = RetryAfter(identifier, ip);
            if (wait is { } value && (longest is null || value > longest)) longest = value;
        }
        return longest;
    }

    /// <summary>
    /// Libère un compte depuis toutes les adresses. C'est le geste
    /// d'administration : la personne appelle pour dire qu'elle est bloquée,
    /// et on ne va pas lui demander son adresse IP.
    ///
    /// Renvoie le nombre d'adresses libérées — zéro si le compte n'était pas
    /// bloqué, ce que l'appelant doit pouvoir distinguer d'un déblocage réel
    /// pour ne pas journaliser une action qui n'a rien fait.
    /// </summary>
    public int ClearAll(string identifier)
    {
        var prefix = $"{identifier.Trim().ToLowerInvariant()}|";
        var cleared = 0;

        foreach (var key in _failures.Keys)
        {
            if (!key.StartsWith(prefix, StringComparison.Ordinal)) continue;
            if (_failures.TryRemove(key, out _)) cleared++;
        }
        return cleared;
    }
}
