using System.Text;
using Cyberjet.Api.Services.Search;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;

namespace Cyberjet.Api.Services.Parsing;

/// <summary>
/// Extraction des questions d'un document Word.
///
/// Les tableaux d'abord — c'est la structure la plus fréquente dans les
/// questionnaires reçus — puis les paragraphes qui ressemblent vraiment à des
/// questions. Aucune réinjection possible dans le document d'origine : l'export
/// se fait alors en rapport Excel.
/// </summary>
public static class WordParser
{
    public static ParseResult Parse(string path)
    {
        var result = new ParseResult { FileType = "docx" };

        using var document = WordprocessingDocument.Open(path, isEditable: false);
        var body = document.MainDocumentPart?.Document?.Body;
        if (body is null)
        {
            result.Warnings.Add("Document Word illisible ou vide.");
            return result;
        }

        var styleNames = ReadStyleNames(document);
        var idx = 0;

        // --- Tableaux ---
        var tables = body.Elements<Table>().ToList();
        for (var t = 0; t < tables.Count; t++)
        {
            var rows = tables[t].Elements<TableRow>()
                .Select(row => row.Elements<TableCell>()
                                  .Select(cell => ParseVocabulary.Clean(CellText(cell)))
                                  .ToArray())
                .Where(row => row.Any(cell => cell.Length > 0))
                .ToList();
            if (rows.Count < 2) continue;

            var header = rows[0];
            int? questionCol = null;
            var top = 0;
            for (var c = 0; c < header.Length; c++)
            {
                var score = ParseVocabulary.HeaderScore(header[c], ParseVocabulary.QuestionHeaders);
                if (score > top) (questionCol, top) = (c, score);
            }

            var start = top > 0 ? 1 : 0;
            if (questionCol is null)
            {
                // Pas d'en-tête exploitable : colonne au texte le plus long.
                var width = rows.Max(row => row.Length);
                var widest = 0;
                var bestTotal = -1;
                for (var c = 0; c < width; c++)
                {
                    var total = rows.Where(row => c < row.Length).Sum(row => row[c].Length);
                    if (total > bestTotal) (widest, bestTotal) = (c, total);
                }
                questionCol = widest;
                start = 0;
            }

            for (var r = start; r < rows.Count; r++)
            {
                var row = rows[r];
                if (questionCol.Value >= row.Length) continue;

                var text = row[questionCol.Value];
                if (text.Length < 12) continue;

                var (reference, body_) = ParseVocabulary.StripNumbering(text);
                idx++;
                result.Questions.Add(new ExtractedQuestion
                {
                    Idx = idx,
                    Text = body_,
                    Ref = reference,
                    Section = $"Tableau {t + 1}",
                });
            }
        }

        // --- Paragraphes de premier niveau ---
        // Elements<Paragraph>() et non Descendants : les paragraphes internes aux
        // tableaux ont déjà été traités ci-dessus, les reprendre dupliquerait
        // chaque ligne.
        string? section = null;
        foreach (var paragraph in body.Elements<Paragraph>())
        {
            var text = ParseVocabulary.Clean(paragraph.InnerText);
            if (text.Length == 0) continue;

            var styleId = paragraph.ParagraphProperties?.ParagraphStyleId?.Val?.Value;
            var styleName = (styleId is not null && styleNames.TryGetValue(styleId, out var name)
                                ? name : styleId) ?? "";
            var flatStyle = TextProcessor.StripAccents(styleName).ToLowerInvariant();

            if (flatStyle.StartsWith("heading", StringComparison.Ordinal)
                || flatStyle.StartsWith("titre", StringComparison.Ordinal))
            {
                section = text;
                continue;
            }

            if (!TextProcessor.LooksLikeQuestion(text)) continue;

            var (reference, body_) = ParseVocabulary.StripNumbering(text);
            idx++;
            result.Questions.Add(new ExtractedQuestion
            {
                Idx = idx,
                Text = body_,
                Ref = reference,
                Section = section,
            });
        }

        if (result.Questions.Count == 0)
            result.Warnings.Add(
                "Aucune question détectée dans le document Word. "
                + "Vous pouvez saisir les questions manuellement.");

        return result;
    }

    /// <summary>
    /// Une cellule Word contient des paragraphes : les concaténer sans séparateur
    /// collerait deux phrases l'une à l'autre.
    /// </summary>
    private static string CellText(TableCell cell)
    {
        var builder = new StringBuilder();
        foreach (var paragraph in cell.Elements<Paragraph>())
        {
            if (builder.Length > 0) builder.Append(' ');
            builder.Append(paragraph.InnerText);
        }
        return builder.ToString();
    }

    /// <summary>
    /// styleId → nom lisible du style. OpenXML ne manipule que des identifiants
    /// (« Heading1 »), alors que les documents produits par un Word francophone
    /// portent des noms localisés (« Titre 1 ») : les deux doivent être reconnus.
    /// </summary>
    private static Dictionary<string, string> ReadStyleNames(WordprocessingDocument document)
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var styles = document.MainDocumentPart?.StyleDefinitionsPart?.Styles;
        if (styles is null) return map;

        foreach (var style in styles.Elements<Style>())
        {
            var id = style.StyleId?.Value;
            var name = style.StyleName?.Val?.Value;
            if (id is not null && name is not null) map[id] = name;
        }
        return map;
    }
}
