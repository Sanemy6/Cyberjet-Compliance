namespace Cyberjet.Api.Services.Search;

/// <summary>Unité indexable : une entrée de base de connaissance ou une configuration.</summary>
public sealed class SearchDocument
{
    /// <summary>« kb » ou « config ».</summary>
    public required string Kind { get; init; }

    public required int Id { get; init; }

    /// <summary>Nul = entrée générique, partagée par tous les dossiers.</summary>
    public required int? ClientId { get; init; }

    public required string Title { get; init; }
    public required string Body { get; init; }
    public string Category { get; init; } = "";
    public string Tags { get; init; } = "";
    public string Status { get; init; } = "validated";
    public IReadOnlyList<string> Refs { get; init; } = [];

    /// <summary>Charge utile rendue au front (valeur d'une configuration, preuve…).</summary>
    public Dictionary<string, string?> Extra { get; init; } = [];

    // Rempli à l'indexation.
    internal Dictionary<string, int> TermFrequencies = [];
    internal int Length;
    internal HashSet<string> RefSet = new(StringComparer.Ordinal);

    /// <summary>Calculé à la première comparaison puis conservé : inutile de payer
    /// les trigrammes de titres que personne n'interroge.</summary>
    internal HashSet<string>? TitleTrigrams;
}

public sealed record SearchMatch(
    SearchDocument Document,
    double Confidence,
    double Bm25,
    double Coverage,
    double Trigram,
    bool RefHit,
    IReadOnlyList<string> MatchedTerms);

/// <summary>
/// Index inversé léger, construit une fois puis interrogé en boucle.
///
/// Immuable une fois construit (au détail près du cache de trigrammes, qui n'est
/// qu'une mémoïsation) : il peut donc être partagé entre requêtes concurrentes.
/// </summary>
public sealed class SearchIndex
{
    /// <summary>Pondération des champs : la question pèse trois fois plus que le
    /// corps de la réponse, une réponse citant un mot en passant ne doit pas
    /// concurrencer une question qui porte sur ce mot.</summary>
    private static readonly (string Field, int Weight)[] FieldWeights =
    [
        ("title", 3), ("tags", 2), ("refs", 3), ("category", 1), ("body", 1),
    ];

    // Paramètres BM25 classiques.
    private const double Bm25K1 = 1.4;
    private const double Bm25B = 0.72;

    /// <summary>Saturation du score BM25 vers [0, 1[. Volontairement asymptotique
    /// plutôt qu'écrêtée : un écrêtage à 1,0 met à égalité tous les documents qui
    /// dépassent le plafond, ce qui détruit le classement dès que la requête tient
    /// en un seul terme — cas fréquent après retrait des mots vides.</summary>
    private const double Bm25Saturation = 1.8;

    /// <summary>Amortissement de spécificité : une requête portant peu
    /// d'information (un mot, ou des mots très fréquents) ne peut pas atteindre la
    /// confiance haute, même sur une correspondance parfaite.</summary>
    private const double SpecificityFull = 5.0;
    private const double SpecificityFloor = 0.70;

    // Combinaison des signaux (somme = 1).
    private const double WeightBm25 = 0.42;
    private const double WeightCoverage = 0.40;
    private const double WeightTrigram = 0.18;

    private const double RefBonus = 0.25;

    public const double High = 0.62;
    public const double Medium = 0.38;
    public const double Low = 0.28;

    public static string Band(double confidence) => confidence switch
    {
        >= High => "haute",
        >= Medium => "moyenne",
        >= Low => "faible",
        _ => "aucune",
    };

    private static double ClientFactor(int? clientId) => clientId is not null ? 1.0 : 0.85;

    private static double StatusFactor(string status) => status switch
    {
        "validated" => 1.0,
        "draft" => 0.85,
        "obsolete" => 0.45,
        _ => 0.8,
    };

    private readonly List<SearchDocument> _documents = [];
    private readonly Dictionary<string, List<int>> _postings = new(StringComparer.Ordinal);
    private readonly Dictionary<string, List<int>> _refPostings = new(StringComparer.Ordinal);
    private readonly Dictionary<string, double> _idf = new(StringComparer.Ordinal);
    private readonly double _defaultIdf;
    private readonly double _averageLength;

    public int Count => _documents.Count;

    public SearchIndex(IEnumerable<SearchDocument> documents)
    {
        var documentFrequency = new Dictionary<string, int>(StringComparer.Ordinal);

        foreach (var doc in documents)
        {
            var tf = new Dictionary<string, int>(StringComparer.Ordinal);
            foreach (var (field, weight) in FieldWeights)
            {
                var text = field switch
                {
                    "title" => doc.Title,
                    "tags" => doc.Tags,
                    "refs" => string.Join(' ', doc.Refs),
                    "category" => doc.Category,
                    _ => doc.Body,
                };
                if (string.IsNullOrEmpty(text)) continue;

                foreach (var term in TextProcessor.Terms(text))
                    tf[term] = tf.GetValueOrDefault(term) + weight;
            }

            doc.TermFrequencies = tf;
            doc.Length = tf.Values.Sum();
            doc.RefSet = new HashSet<string>(
                doc.Refs.Select(r => r.ToUpperInvariant()), StringComparer.Ordinal);

            foreach (var term in tf.Keys)
                documentFrequency[term] = documentFrequency.GetValueOrDefault(term) + 1;

            var position = _documents.Count;
            foreach (var term in tf.Keys)
            {
                if (!_postings.TryGetValue(term, out var list))
                    _postings[term] = list = [];
                list.Add(position);
            }
            foreach (var reference in doc.RefSet)
            {
                if (!_refPostings.TryGetValue(reference, out var list))
                    _refPostings[reference] = list = [];
                list.Add(position);
            }
            _documents.Add(doc);
        }

        var n = _documents.Count;
        _averageLength = n > 0 ? _documents.Sum(d => (double)d.Length) / n : 1.0;
        if (_averageLength <= 0) _averageLength = 1.0;

        foreach (var (term, count) in documentFrequency)
            _idf[term] = Math.Log(1 + (n - count + 0.5) / (count + 0.5));

        // Terme absent du corpus : IDF maximal, il discrimine totalement.
        _defaultIdf = n > 0 ? Math.Log(1 + (n + 0.5) / 0.5) : 1.0;
    }

    private double Idf(string term) => _idf.TryGetValue(term, out var value) ? value : _defaultIdf;

    public IReadOnlyList<SearchMatch> Search(
        string query, int? clientId = null, int topK = 5, IReadOnlyCollection<string>? kinds = null)
    {
        var queryTerms = TextProcessor.Terms(query);
        if (queryTerms.Count == 0) return [];

        var distinct = queryTerms.Distinct(StringComparer.Ordinal).ToList();
        var queryTf = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var term in queryTerms)
            queryTf[term] = queryTf.GetValueOrDefault(term) + 1;

        var queryRefs = new HashSet<string>(TextProcessor.ExtractRefs(query), StringComparer.Ordinal);

        var sumIdf = distinct.Sum(Idf);
        if (sumIdf <= 0) sumIdf = 1.0;
        var bm25Reference = 1.5 * sumIdf;
        var specificity = SpecificityFloor
            + (1 - SpecificityFloor) * Math.Min(1.0, sumIdf / SpecificityFull);

        // Seuls les documents partageant au moins un terme — ou une référence —
        // avec la question méritent d'être scorés.
        var candidates = new HashSet<int>();
        foreach (var term in distinct)
            if (_postings.TryGetValue(term, out var list)) candidates.UnionWith(list);
        foreach (var reference in queryRefs)
            if (_refPostings.TryGetValue(reference, out var list)) candidates.UnionWith(list);

        var queryTrigrams = TextProcessor.Trigrams(query);
        var matches = new List<SearchMatch>();

        foreach (var position in candidates)
        {
            var doc = _documents[position];

            // Cloisonnement client : jamais de fuite d'un dossier vers un autre.
            if (doc.ClientId is not null && doc.ClientId != clientId) continue;
            if (kinds is { Count: > 0 } && !kinds.Contains(doc.Kind)) continue;

            var score = 0.0;
            var hits = new List<string>();
            var norm = Bm25K1 * (1 - Bm25B + Bm25B * doc.Length / _averageLength);

            foreach (var term in distinct)
            {
                if (!doc.TermFrequencies.TryGetValue(term, out var freq) || freq == 0) continue;
                hits.Add(term);
                score += Idf(term) * (freq * (Bm25K1 + 1)) / (freq + norm)
                         * Math.Min(queryTf[term], 3);
            }

            // Couverture pondérée par l'IDF : retrouver « chiffrement au repos »
            // vaut bien plus que retrouver « données ». Une couverture en nombre
            // brut de termes traiterait les deux à égalité.
            var coverage = hits.Sum(Idf) / sumIdf;
            var bm25Norm = 1.0 - Math.Exp(-Bm25Saturation * score / bm25Reference);

            var titleTrigrams = doc.TitleTrigrams ??= TextProcessor.Trigrams(doc.Title);
            var shared = queryTrigrams.Count(titleTrigrams.Contains);
            var unionSize = queryTrigrams.Count + titleTrigrams.Count - shared;
            var trigram = unionSize > 0 ? (double)shared / unionSize : 0.0;

            var confidence = WeightBm25 * bm25Norm
                           + WeightCoverage * coverage
                           + WeightTrigram * trigram;

            var refHit = queryRefs.Overlaps(doc.RefSet);
            if (refHit) confidence += RefBonus;

            confidence *= ClientFactor(doc.ClientId);
            confidence *= StatusFactor(doc.Status);
            confidence *= specificity;
            confidence = Math.Clamp(confidence, 0.0, 1.0);

            if (confidence < 0.05) continue;
            matches.Add(new SearchMatch(doc, confidence, bm25Norm, coverage, trigram, refHit, hits));
        }

        return [.. matches.OrderByDescending(m => m.Confidence).Take(topK)];
    }
}
