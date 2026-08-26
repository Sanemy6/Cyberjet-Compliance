using System.Collections.Concurrent;
using Cyberjet.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Cyberjet.Api.Services.Search;

/// <summary>
/// Construction et mise en cache de l'index, puis composition de la réponse
/// proposée.
///
/// L'indexation est linéaire en nombre d'entrées et serait sinon refaite à
/// chaque requête. L'index est donc gardé en mémoire, invalidé par une empreinte
/// dérivée du contenu de la base plutôt que par un compteur applicatif : ainsi
/// une modification faite hors de l'application est détectée elle aussi.
///
/// Enregistré en singleton : l'index est immuable une fois construit et peut
/// être partagé entre requêtes concurrentes.
/// </summary>
public sealed class SearchEngine(IServiceScopeFactory scopeFactory)
{
    /// <summary>Empreinte bon marché du contenu indexé. Toute création,
    /// suppression ou édition la change.</summary>
    private readonly record struct CacheToken(
        int KbCount, int KbMaxId, DateTime? KbMaxUpdated,
        int ConfigCount, int ConfigMaxId, DateTime? ConfigMaxUpdated);

    private const int MaxCachedIndexes = 8;

    /// <summary>Clé du cache. 0 = portée générique uniquement — les identifiants
    /// de client sont des IDENTITY(1,1), la valeur ne peut donc pas entrer en
    /// collision avec un dossier réel.</summary>
    private static int CacheKey(int? clientId) => clientId ?? 0;

    private readonly ConcurrentDictionary<int, (CacheToken Token, SearchIndex Index, long Stamp)> _cache = new();
    private long _clock;

    public async Task<SearchIndex> GetIndexAsync(int? clientId, CancellationToken ct = default)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var token = await ComputeTokenAsync(db, clientId, ct);
        var key = CacheKey(clientId);

        if (_cache.TryGetValue(key, out var cached) && cached.Token.Equals(token))
            return cached.Index;

        var index = await BuildAsync(db, clientId, ct);
        _cache[key] = (token, index, Interlocked.Increment(ref _clock));
        Evict();
        return index;
    }

    /// <summary>Vide le cache : appelé après toute écriture qui touche au contenu
    /// indexé, pour que la recherche suivante reparte de la base sans même payer
    /// le calcul de l'empreinte.</summary>
    public void Invalidate() => _cache.Clear();

    private void Evict()
    {
        while (_cache.Count > MaxCachedIndexes)
        {
            var oldest = _cache.OrderBy(entry => entry.Value.Stamp).FirstOrDefault();
            if (!_cache.TryRemove(oldest.Key, out _)) break;
        }
    }

    private static async Task<CacheToken> ComputeTokenAsync(
        AppDbContext db, int? clientId, CancellationToken ct)
    {
        var kb = db.KbEntries.Where(e =>
            e.Status != "obsolete" && (e.ClientId == null || e.ClientId == clientId));
        var configs = db.ConfigItems.Where(c => c.ClientId == clientId);

        return new CacheToken(
            await kb.CountAsync(ct),
            await kb.Select(e => (int?)e.Id).MaxAsync(ct) ?? 0,
            await kb.Select(e => (DateTime?)e.UpdatedAt).MaxAsync(ct),
            await configs.CountAsync(ct),
            await configs.Select(c => (int?)c.Id).MaxAsync(ct) ?? 0,
            await configs.Select(c => (DateTime?)c.UpdatedAt).MaxAsync(ct));
    }

    /// <summary>Index des entrées génériques, de celles du client, et de ses configurations.</summary>
    private static async Task<SearchIndex> BuildAsync(
        AppDbContext db, int? clientId, CancellationToken ct)
    {
        var documents = new List<SearchDocument>();

        var entries = await db.KbEntries
            .AsNoTracking()
            .Where(e => e.Status != "obsolete" && (e.ClientId == null || e.ClientId == clientId))
            .Select(e => new
            {
                e.Id, e.ClientId, e.Question, e.Answer, e.Category, e.Tags, e.Status,
                e.Evidence, e.Source,
                ControlRefs = e.Controls.Select(link => link.Control.Ref).ToList(),
            })
            .ToListAsync(ct);

        foreach (var entry in entries)
        {
            // Les références citées dans l'intitulé comptent autant que celles
            // rattachées explicitement : un questionnaire qui cite A.8.24 doit
            // retrouver une entrée dont la question mentionne A.8.24, même si
            // personne n'a pris le temps de faire le rattachement.
            var refs = entry.ControlRefs
                .Concat(TextProcessor.ExtractRefs(entry.Question))
                .Where(r => !string.IsNullOrWhiteSpace(r))
                .Distinct(StringComparer.Ordinal)
                .Order(StringComparer.Ordinal)
                .ToList();

            documents.Add(new SearchDocument
            {
                Kind = "kb",
                Id = entry.Id,
                ClientId = entry.ClientId,
                Title = entry.Question,
                Body = entry.Answer,
                Category = entry.Category,
                Tags = entry.Tags,
                Status = entry.Status,
                Refs = refs,
                Extra = new Dictionary<string, string?>
                {
                    ["evidence"] = entry.Evidence,
                    ["source"] = entry.Source,
                },
            });
        }

        if (clientId is not null)
        {
            var configs = await db.ConfigItems.AsNoTracking()
                .Where(c => c.ClientId == clientId)
                .ToListAsync(ct);

            foreach (var config in configs)
            {
                documents.Add(new SearchDocument
                {
                    Kind = "config",
                    Id = config.Id,
                    ClientId = config.ClientId,
                    // Le libellé et la catégorie forment la « question » implicite.
                    Title = $"{config.Category} — {config.Label}",
                    Body = $"{config.Value} {config.Details ?? ""} {config.Scope ?? ""}",
                    Category = config.Category,
                    Tags = config.Scope ?? "",
                    Status = config.Status == "en place" ? "validated" : "draft",
                    Extra = new Dictionary<string, string?>
                    {
                        ["label"] = config.Label,
                        ["value"] = config.Value,
                        ["details"] = config.Details,
                        ["scope"] = config.Scope,
                        ["state"] = config.Status,
                    },
                });
            }
        }

        return new SearchIndex(documents);
    }

    // ----------------------------------------------------------------------
    // Composition de la réponse proposée
    // ----------------------------------------------------------------------

    public sealed record ComposedAnswer(string Text, double Confidence, SearchMatch? Best);

    private static string ConfigLine(SearchMatch match, bool withDetails = true)
    {
        var extra = match.Document.Extra;
        var line = $"- {extra.GetValueOrDefault("label")} : {extra.GetValueOrDefault("value")}";
        var details = extra.GetValueOrDefault("details");
        if (withDetails && !string.IsNullOrWhiteSpace(details)) line += $" ({details})";
        return line;
    }

    /// <summary>
    /// Rédige une proposition de réponse à partir des meilleurs candidats.
    ///
    /// Deux comportements qui font la différence en usage réel :
    ///
    /// <list type="bullet">
    /// <item>Quand plusieurs <em>configurations</em> d'une même famille répondent
    /// à la question (« décrivez le chiffrement mis en place » → au repos, en
    /// transit, gestion des clés), elles sont agrégées plutôt que d'en retenir
    /// une seule arbitrairement.</item>
    /// <item>Quand la meilleure réponse est une entrée de base de connaissance —
    /// souvent une formulation de principe — les configurations du client qui
    /// correspondent aussi sont ajoutées en précisions. C'est ce qui transforme
    /// « nous chiffrons selon l'état de l'art » en « … AES-256-GCM au repos,
    /// TLS 1.3 en transit ».</item>
    /// </list>
    /// </summary>
    public static ComposedAnswer Compose(IReadOnlyList<SearchMatch> matches)
    {
        if (matches.Count == 0) return new ComposedAnswer("", 0.0, null);

        var best = matches[0];
        if (best.Confidence < SearchIndex.Low)
            return new ComposedAnswer("", best.Confidence, null);

        if (best.Document.Kind == "config")
        {
            var floor = Math.Max(SearchIndex.Medium, best.Confidence * 0.75);
            var family = matches
                .Where(m => m.Document.Kind == "config"
                         && m.Document.Category == best.Document.Category
                         && m.Confidence >= floor)
                .ToList();

            if (family.Count > 1)
            {
                var aggregated = string.Join('\n', family.Select(m => ConfigLine(m)));
                return new ComposedAnswer(aggregated, best.Confidence, best);
            }

            var extra = best.Document.Extra;
            var single = $"{extra.GetValueOrDefault("label")} : {extra.GetValueOrDefault("value")}";
            if (!string.IsNullOrWhiteSpace(extra.GetValueOrDefault("details")))
                single += $"\n{extra["details"]}";
            if (!string.IsNullOrWhiteSpace(extra.GetValueOrDefault("scope")))
                single += $"\nPérimètre : {extra["scope"]}";
            return new ComposedAnswer(single, best.Confidence, best);
        }

        var text = best.Document.Body;
        var threshold = Math.Max(0.25, best.Confidence * 0.45);
        var configs = matches.Skip(1)
            .Where(m => m.Document.Kind == "config" && m.Confidence >= threshold)
            .Take(4)
            .ToList();

        if (configs.Count > 0)
        {
            var precisions = string.Join('\n', configs.Select(m => ConfigLine(m, withDetails: false)));
            text = $"{text}\n\nÉléments de configuration en place :\n{precisions}";
        }

        return new ComposedAnswer(text, best.Confidence, best);
    }
}
