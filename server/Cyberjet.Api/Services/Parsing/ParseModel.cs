using System.Text.RegularExpressions;
using Cyberjet.Api.Services.Search;

namespace Cyberjet.Api.Services.Parsing;

/// <summary>Coordonnées exactes d'une question dans le classeur d'origine.
/// C'est ce qui permet de rendre au client son propre fichier, complété.</summary>
public sealed class QuestionLocator
{
    public string Sheet { get; set; } = "";

    /// <summary>Ligne 1-indexée, comme dans Excel.</summary>
    public int Row { get; set; }

    public int QuestionCol { get; set; }
    public int AnswerCol { get; set; }
    public int HeaderRow { get; set; }

    /// <summary>Vrai quand le classeur d'origine n'avait pas de colonne de
    /// réponse : il faudra en écrire l'en-tête à l'export.</summary>
    public bool AnswerCreated { get; set; }
}

public sealed class ExtractedQuestion
{
    public int Idx { get; set; }
    public string Text { get; set; } = "";
    public string? Ref { get; set; }
    public string? Section { get; set; }
    public QuestionLocator? Locator { get; set; }
}

public sealed class ParseResult
{
    public List<ExtractedQuestion> Questions { get; } = [];
    public string FileType { get; set; } = "";
    public List<string> Warnings { get; } = [];
}

/// <summary>
/// Vocabulaire et petites règles partagés par les quatre analyseurs.
///
/// L'enjeu n'est pas de lire le fichier — c'est de deviner sa structure, car
/// chaque client a la sienne.
/// </summary>
public static partial class ParseVocabulary
{
    // Mots-clés d'en-tête, comparés sur la forme normalisée sans accents.
    public static readonly string[] QuestionHeaders =
    [
        "question", "questions", "exigence", "requirement", "control objective",
        "controle", "control", "critere", "criteria", "description", "libelle",
        "intitule", "enonce", "demande", "objet", "item", "mesure", "point de controle",
        "expected", "attendu", "sujet", "ask",
    ];

    public static readonly string[] AnswerHeaders =
    [
        "reponse", "answer", "response", "commentaire", "comment", "remarque",
        "remark", "statut", "status", "compliance", "conformite", "conforme",
        "justification", "explication", "explanation", "detail", "observation",
        "supplier response", "vendor response", "reponse fournisseur",
    ];

    public static readonly string[] RefHeaders =
    [
        "ref", "reference", "id", "n", "no", "num", "numero", "code", "article",
        "clause", "question id", "item id", "identifiant", "index",
    ];

    public static readonly string[] SectionHeaders =
    [
        "section", "domaine", "domain", "categorie", "category", "theme", "chapitre",
        "chapter", "famille", "groupe", "group", "area", "topic", "pilier", "volet",
    ];

    public static readonly string[] EvidenceHeaders =
    [
        "preuve", "evidence", "piece", "attachment", "document", "proof",
    ];

    /// <summary>Préfixes de numérotation : « 1. », « 1.2.3 », « Q12 », « A.8.24 », « (a) ».</summary>
    [GeneratedRegex(@"^\s*(?:(?:Q|R|C|A)?\d+(?:[.\-]\d+)*|[A-Z]\.\d+(?:\.\d+)*|\(?[a-z]\))[\.\)\-–:]?\s+",
                    RegexOptions.IgnoreCase)]
    public static partial Regex Numbering();

    [GeneratedRegex(@"[ \t]+")]
    private static partial Regex InnerSpaces();

    public static string Clean(object? value)
    {
        if (value is null) return "";
        var text = value.ToString()?.Replace('\r', ' ').Trim() ?? "";
        return InnerSpaces().Replace(text, " ");
    }

    /// <summary>Score de correspondance d'un en-tête : exact &gt; préfixe ou
    /// suffixe &gt; inclusion. Un seuil unique produirait trop de faux positifs
    /// sur des en-têtes composés (« Réponse fournisseur »).</summary>
    public static int HeaderScore(string text, string[] keywords)
    {
        var flat = TextProcessor.Normalize(text);
        if (flat.Length == 0) return 0;

        var best = 0;
        foreach (var keyword in keywords)
        {
            if (flat == keyword) best = Math.Max(best, 3);
            else if (flat.StartsWith(keyword, StringComparison.Ordinal)
                  || flat.EndsWith(keyword, StringComparison.Ordinal)) best = Math.Max(best, 2);
            else if (keyword.Length > 3 && flat.Contains(keyword, StringComparison.Ordinal))
                best = Math.Max(best, 1);
        }
        return best;
    }

    /// <summary>Sépare un éventuel préfixe de numérotation du corps de la question.</summary>
    public static (string? Ref, string Body) StripNumbering(string text)
    {
        var match = Numbering().Match(text);
        if (!match.Success) return (null, text);

        var reference = match.Value.Trim(' ', '.', ')', '-', '–', ':');
        var body = text[match.Length..].Trim();

        // On ne coupe que si ce qui reste est substantiel : sinon « 3.2 » aurait
        // dévoré une question qui n'était qu'un numéro suivi de trois mots.
        if (body.Length < 10) return (null, text);
        return (string.IsNullOrEmpty(reference) ? null : reference, body);
    }

    public static string DetectFileType(string filename)
    {
        var ext = Path.GetExtension(filename).ToLowerInvariant().TrimStart('.');
        return ext switch
        {
            "xlsx" or "xlsm" or "xls" => "xlsx",
            "docx" or "doc" => "docx",
            "pdf" => "pdf",
            "csv" or "txt" => "csv",
            "" => "inconnu",
            _ => ext,
        };
    }
}
