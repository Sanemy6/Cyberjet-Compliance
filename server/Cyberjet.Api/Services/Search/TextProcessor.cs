using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Cyberjet.Api.Services.Search;

/// <summary>
/// Normalisation textuelle bilingue FR/EN et extraction de références normatives.
///
/// Chaîne de traitement d'un texte :
/// <code>
///   texte brut
///     → repli des accents + minuscules
///     → repli des expressions multi-mots (Thesaurus.Phrases)
///     → tokenisation
///     → retrait des mots vides
///     → repli sur la forme canonique, sinon désuffixation
///   → liste de termes comparables
/// </code>
///
/// Les références normatives (A.8.24, IS.I.OR.205, CC6.1…) sont extraites du
/// texte <em>brut</em>, avant normalisation : la ponctuation y porte le sens.
/// </summary>
public static partial class TextProcessor
{
    [GeneratedRegex("[^a-z0-9]+")]
    private static partial Regex NonWord();

    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();

    /// <summary>
    /// Désuffixation légère, ordonnée du suffixe le plus long au plus court.
    /// Volontairement rustique : un vrai stemmer (Snowball) sur-tronque les
    /// sigles et les termes techniques, très fréquents ici.
    /// </summary>
    private static readonly string[] Suffixes =
    [
        "issements", "issement", "ationnel", "ations", "atrices", "ateurs", "ements",
        "isation", "atrice", "ateur", "ement", "ances", "ences", "ation", "ition",
        "sions", "tions", "ities", "ques", "eurs", "euse", "ives", "elle", "sion",
        "tion", "ance", "ence", "ings", "ique", "aux", "eur", "ive", "els", "ing",
        "ers", "ees", "ies", "er", "ee", "es", "ez", "s", "e",
    ];

    private const int MinStem = 4;

    /// <summary>
    /// Références normatives reconnues, du motif le plus spécifique au plus
    /// général.
    /// </summary>
    private static readonly Regex[] RefPatterns =
    [
        new(@"\bIS\.[ID]\.(?:OR|AR)\.\d{3}(?:\([a-z0-9]+\))?", RegexOptions.IgnoreCase),  // EASA Part-IS
        new(@"\bA\.\s?\d{1,2}\.\d{1,2}\b"),                                               // ISO 27001 Annexe A
        new(@"\bCC\d\.\d{1,2}\b", RegexOptions.IgnoreCase),                               // SOC 2
        new(@"\b(?:ID|PR|DE|RS|RC|GV)\.[A-Z]{2}-\d{1,2}\b"),                              // NIST CSF
        new(@"\bart(?:icle)?\.?\s*\d{1,2}(?:\.\d{1,2})?\b", RegexOptions.IgnoreCase),     // NIS2 / DORA
    ];

    private sealed record PhraseRule(string Anchor, Regex Pattern, string Token);

    private static readonly PhraseRule[] PhraseRules = CompilePhrases();
    private static readonly Dictionary<string, string> CanonicalFull = BuildCanonicalFull();

    public static string StripAccents(string? text)
    {
        if (string.IsNullOrEmpty(text)) return "";
        var decomposed = text.Normalize(NormalizationForm.FormKD);
        var builder = new StringBuilder(decomposed.Length);
        foreach (var ch in decomposed)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(ch) != UnicodeCategory.NonSpacingMark)
                builder.Append(ch);
        }
        return builder.ToString();
    }

    /// <summary>Minuscules, sans accents, ponctuation repliée en espaces.</summary>
    public static string Normalize(string? text)
    {
        var flat = StripAccents(text).ToLowerInvariant();
        flat = NonWord().Replace(flat, " ");
        return Whitespace().Replace(flat, " ").Trim();
    }

    // ----------------------------------------------------------------------
    // Repli des expressions multi-mots
    //
    // Un simple remplacement de chaîne serait trop rigide : « vérifications
    // d'antécédents » ne correspondrait pas à « vérification des antécédents ».
    // Chaque expression est donc compilée en une expression régulière qui tolère
    // le pluriel de chaque mot porteur de sens et n'importe quel mot de liaison
    // entre eux.
    // ----------------------------------------------------------------------
    private static PhraseRule[] CompilePhrases()
    {
        var connectorAlternation = string.Join(
            '|', Thesaurus.Connectors.OrderByDescending(c => c.Length).Select(Regex.Escape));
        var separator = $@"\s+(?:(?:{connectorAlternation})\s+)*";

        var rules = new List<PhraseRule>();
        foreach (var (phrase, token) in Thesaurus.Phrases)
        {
            var content = phrase.Split(' ', StringSplitOptions.RemoveEmptyEntries)
                                .Where(word => !Thesaurus.Connectors.Contains(word))
                                .ToArray();
            if (content.Length == 0) continue;

            var body = string.Join(separator, content.Select(word => Regex.Escape(word) + "s?"));
            var pattern = $"(?<![a-z0-9]){body}(?![a-z0-9])";
            rules.Add(new PhraseRule(content[0], new Regex(pattern, RegexOptions.Compiled), token));
        }

        // Les expressions les plus spécifiques d'abord, pour qu'une expression
        // courte n'ampute pas une expression longue qui la contient.
        return [.. rules.OrderByDescending(rule => rule.Pattern.ToString().Length)];
    }

    /// <summary>Replie les expressions multi-mots connues en un jeton unique.</summary>
    public static string ApplyPhrases(string text)
    {
        foreach (var rule in PhraseRules)
        {
            // Pré-filtre bon marché : évite d'exécuter ~180 expressions
            // régulières sur chaque texte indexé.
            if (!text.Contains(rule.Anchor, StringComparison.Ordinal)) continue;
            text = rule.Pattern.Replace(text, rule.Token);
        }
        return text;
    }

    public static string LightStem(string token)
    {
        foreach (var suffix in Suffixes)
        {
            if (token.EndsWith(suffix, StringComparison.Ordinal)
                && token.Length - suffix.Length >= MinStem)
                return token[..^suffix.Length];
        }
        return token;
    }

    /// <summary>
    /// Étend le thésaurus aux formes désuffixées de ses propres entrées.
    ///
    /// Sans cela, chaque entrée dont le radical diffère de la forme de surface
    /// laisse un trou : « suites » se désuffixe en « suit », que le thésaurus ne
    /// connaît pas, et le terme rate sa famille alors que « suite » y figure.
    /// </summary>
    private static Dictionary<string, string> BuildCanonicalFull()
    {
        var map = new Dictionary<string, string>(Thesaurus.Canonical, StringComparer.Ordinal);
        foreach (var (term, canonical) in Thesaurus.Canonical)
            map.TryAdd(LightStem(term), canonical);
        return map;
    }

    /// <summary>Forme canonique d'un jeton : thésaurus d'abord, désuffixation ensuite.</summary>
    public static string Canonicalize(string token)
    {
        if (CanonicalFull.TryGetValue(token, out var direct)) return direct;
        var stem = LightStem(token);
        return CanonicalFull.TryGetValue(stem, out var viaStem) ? viaStem : stem;
    }

    /// <summary>Liste des termes canoniques d'un texte, mots vides retirés.</summary>
    public static List<string> Terms(string? text)
    {
        var flat = ApplyPhrases(Normalize(text));
        var output = new List<string>();

        foreach (var token in flat.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            if (token.Length < 2 || Thesaurus.StopWords.Contains(token)) continue;

            // Un nombre isolé n'apporte rien, sauf s'il ressemble à une année ou
            // à un numéro de version.
            if (token.All(char.IsAsciiDigit))
            {
                var looksMeaningful = token.Length <= 3
                    || (long.TryParse(token, out var value) && value is > 1900 and < 2100);
                if (!looksMeaningful) continue;
            }

            output.Add(Canonicalize(token));
        }
        return output;
    }

    /// <summary>Trigrammes de caractères — rattrape fautes de frappe et variantes.</summary>
    public static HashSet<string> Trigrams(string? text)
    {
        var flat = Normalize(text).Replace(' ', '_');
        var set = new HashSet<string>(StringComparer.Ordinal);
        if (flat.Length == 0) return set;
        if (flat.Length < 3)
        {
            set.Add(flat);
            return set;
        }
        for (var i = 0; i <= flat.Length - 3; i++)
            set.Add(flat.Substring(i, 3));
        return set;
    }

    public static double TrigramSimilarity(string a, string b)
    {
        var ta = Trigrams(a);
        var tb = Trigrams(b);
        if (ta.Count == 0 || tb.Count == 0) return 0.0;
        var intersection = ta.Count(t => tb.Contains(t));
        var union = ta.Count + tb.Count - intersection;
        return union == 0 ? 0.0 : (double)intersection / union;
    }

    /// <summary>Références normatives citées dans un texte, normalisées en majuscules.</summary>
    public static List<string> ExtractRefs(string? text)
    {
        var found = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        foreach (var pattern in RefPatterns)
        {
            foreach (Match match in pattern.Matches(text ?? ""))
            {
                var reference = Whitespace().Replace(match.Value, "")
                                            .ToUpperInvariant()
                                            .TrimEnd('.');
                if (seen.Add(reference)) found.Add(reference);
            }
        }
        return found;
    }

    private static readonly string[] QuestionHints =
    [
        "?", "decri", "descri", "expliqu", "explain", "detail", "precis", "indiqu",
        "confirm", "list", "fourni", "provide", "avez-vous", "avez vous", "disposez",
        "comment", "quel", "quelle", "quels", "quelles", "combien", "est-ce",
        "does ", "do you", "have you", "are you", "is there", "how ", "what ",
        "which ", "who ", "when ", "please ", "veuillez", "specify", "identify",
        "documented", "documente", "in place", "en place", "mis en oeuvre",
        "implemented", "shall ", "doit ", "must ",
    ];

    /// <summary>Ce fragment ressemble-t-il à une question ou à une exigence ?</summary>
    public static bool LooksLikeQuestion(string? text)
    {
        var raw = (text ?? "").Trim();
        if (raw.Length is < 12 or > 2000) return false;
        if (raw.EndsWith('?')) return true;

        var flat = StripAccents(raw).ToLowerInvariant();
        if (!QuestionHints.Any(hint => flat.Contains(hint, StringComparison.Ordinal)))
            return false;

        // Un fragment doit contenir assez de mots pour être une vraie question.
        return raw.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length >= 4;
    }
}
