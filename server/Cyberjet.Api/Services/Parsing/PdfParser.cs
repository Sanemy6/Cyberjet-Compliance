using Cyberjet.Api.Services.Search;
using UglyToad.PdfPig;
using UglyToad.PdfPig.Content;

namespace Cyberjet.Api.Services.Parsing;

/// <summary>
/// Extraction des questions d'un PDF.
///
/// Un PDF ne porte aucune structure : ni tableau, ni paragraphe, seulement des
/// mots posés à des coordonnées. Deux passes, dans cet ordre :
///
///   1. <b>Mise en page tabulaire.</b> Les mots sont regroupés en lignes par leur
///      ligne de base, puis on cherche des <em>gouttières</em> — des positions
///      horizontales où plusieurs lignes présentent toutes un blanc. Une gouttière
///      partagée par un tiers des lignes est une frontière de colonne. C'est ce
///      qui permet de retrouver un questionnaire mis en tableau.
///
///   2. <b>Repli en blocs.</b> Sinon, le texte est découpé en items : un nouvel
///      item s'ouvre à chaque numérotation ou après un point d'interrogation.
///
/// Aucune réinjection possible dans le fichier d'origine : l'export se fait en
/// rapport Excel.
/// </summary>
public static class PdfParser
{
    /// <summary>Écart horizontal minimal, en points typographiques, pour qu'un
    /// blanc entre deux mots compte comme une gouttière et non comme une espace.</summary>
    private const double GutterWidth = 12.0;

    /// <summary>Tolérance verticale pour considérer deux mots sur la même ligne.</summary>
    private const double LineTolerance = 3.0;

    /// <summary>Les gouttières sont regroupées par tranches de cette largeur :
    /// d'une ligne à l'autre, une même colonne ne commence jamais au point près.</summary>
    private const double GutterBucket = 6.0;

    private sealed record TextLine(double Baseline, IReadOnlyList<Word> Words)
    {
        public string Text => string.Join(' ', Words.Select(w => w.Text));
    }

    public static ParseResult Parse(string path)
    {
        var result = new ParseResult { FileType = "pdf" };
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var idx = 0;

        using var document = PdfDocument.Open(path);
        var pageNumber = 0;

        foreach (var page in document.GetPages())
        {
            pageNumber++;
            var lines = BuildLines(page);
            if (lines.Count == 0) continue;

            var handled = 0;
            foreach (var text in TableQuestions(lines))
            {
                if (text.Length < 12) continue;
                if (!Remember(seen, text)) continue;

                var (reference, body) = ParseVocabulary.StripNumbering(text);
                result.Questions.Add(new ExtractedQuestion
                {
                    Idx = ++idx, Text = body, Ref = reference, Section = $"Page {pageNumber}",
                });
                handled++;
            }

            // Une page dont le tableau a été exploité ne repasse pas par le repli :
            // elle produirait les mêmes questions, découpées autrement.
            if (handled > 0) continue;

            foreach (var block in Blocks(lines.Select(line => line.Text)))
            {
                if (!TextProcessor.LooksLikeQuestion(block)) continue;
                if (!Remember(seen, block)) continue;

                var (reference, body) = ParseVocabulary.StripNumbering(block);
                result.Questions.Add(new ExtractedQuestion
                {
                    Idx = ++idx, Text = body, Ref = reference, Section = $"Page {pageNumber}",
                });
            }
        }

        if (result.Questions.Count == 0)
            result.Warnings.Add(
                "Aucune question détectée dans le PDF (document scanné ou mise en page "
                + "atypique). Vous pouvez saisir les questions manuellement.");

        return result;
    }

    /// <summary>Clé de déduplication : deux pages répètent souvent le même
    /// en-tête, et un tableau à cheval sur deux pages rejoue sa ligne de titres.</summary>
    private static bool Remember(HashSet<string> seen, string text)
    {
        var flat = TextProcessor.Normalize(text);
        if (flat.Length > 120) flat = flat[..120];
        return seen.Add(flat);
    }

    /// <summary>Regroupe les mots de la page en lignes, de haut en bas.</summary>
    private static List<TextLine> BuildLines(Page page)
    {
        var words = page.GetWords()
            .Where(w => !string.IsNullOrWhiteSpace(w.Text))
            .OrderByDescending(w => w.BoundingBox.Bottom)
            .ThenBy(w => w.BoundingBox.Left)
            .ToList();

        var lines = new List<TextLine>();
        var current = new List<Word>();
        var baseline = double.NaN;

        foreach (var word in words)
        {
            var y = word.BoundingBox.Bottom;
            if (current.Count > 0 && Math.Abs(y - baseline) > LineTolerance)
            {
                lines.Add(Close(current, baseline));
                current = [];
            }
            if (current.Count == 0) baseline = y;
            current.Add(word);
        }
        if (current.Count > 0) lines.Add(Close(current, baseline));

        return lines;

        static TextLine Close(List<Word> words, double baseline) =>
            new(baseline, [.. words.OrderBy(w => w.BoundingBox.Left)]);
    }

    /// <summary>
    /// Détecte une mise en page tabulaire et rend le contenu de la colonne qui
    /// porte les questions. Liste vide si la page n'a rien de tabulaire.
    /// </summary>
    private static List<string> TableQuestions(List<TextLine> lines)
    {
        var boundaries = DetectColumnBoundaries(lines);
        if (boundaries.Count == 0) return [];

        var rows = lines
            .Select(line => SplitAt(line, boundaries))
            .Where(cells => cells.Count(cell => cell.Length > 0) >= 2)
            .ToList();
        if (rows.Count < 2) return [];

        var width = boundaries.Count + 1;

        // Colonne des questions : par l'en-tête si la première ligne en tient
        // lieu, sinon celle dont le texte cumulé est le plus long.
        var questionCol = 0;
        var top = 0;
        for (var c = 0; c < width && c < rows[0].Length; c++)
        {
            var score = ParseVocabulary.HeaderScore(rows[0][c], ParseVocabulary.QuestionHeaders);
            if (score > top) (questionCol, top) = (c, score);
        }
        if (top == 0)
        {
            var bestTotal = -1;
            for (var c = 0; c < width; c++)
            {
                var total = rows.Where(row => c < row.Length).Sum(row => row[c].Length);
                if (total > bestTotal) (questionCol, bestTotal) = (c, total);
            }
        }

        return rows.Skip(top > 0 ? 1 : 0)
                   .Where(row => questionCol < row.Length)
                   .Select(row => row[questionCol])
                   .Where(cell => cell.Length > 0)
                   .ToList();
    }

    /// <summary>
    /// Positions horizontales où plusieurs lignes présentent toutes un blanc.
    /// Une gouttière isolée n'est qu'une phrase espacée ; c'est sa répétition
    /// d'une ligne à l'autre qui trahit une colonne.
    /// </summary>
    private static List<double> DetectColumnBoundaries(List<TextLine> lines)
    {
        if (lines.Count < 3) return [];

        var support = new Dictionary<int, int>();
        foreach (var line in lines)
        {
            var seenBuckets = new HashSet<int>();
            for (var i = 1; i < line.Words.Count; i++)
            {
                var gapStart = line.Words[i - 1].BoundingBox.Right;
                var gapEnd = line.Words[i].BoundingBox.Left;
                if (gapEnd - gapStart < GutterWidth) continue;

                var bucket = (int)Math.Round((gapStart + gapEnd) / 2 / GutterBucket);
                // Une même ligne ne vote qu'une fois par gouttière.
                if (seenBuckets.Add(bucket))
                    support[bucket] = support.GetValueOrDefault(bucket) + 1;
            }
        }

        var required = Math.Max(3, lines.Count / 3);
        var boundaries = support.Where(entry => entry.Value >= required)
                                .Select(entry => entry.Key * GutterBucket)
                                .Order()
                                .ToList();

        // Une seule frontière peut n'être qu'une marge de numérotation ; à partir
        // de deux, la page a bien une structure en colonnes.
        return boundaries.Count >= 1 && boundaries.Count <= 8 ? boundaries : [];
    }

    private static string[] SplitAt(TextLine line, List<double> boundaries)
    {
        var cells = new List<string>[boundaries.Count + 1];
        for (var i = 0; i < cells.Length; i++) cells[i] = [];

        foreach (var word in line.Words)
        {
            var centre = (word.BoundingBox.Left + word.BoundingBox.Right) / 2;
            var column = 0;
            while (column < boundaries.Count && centre > boundaries[column]) column++;
            cells[column].Add(word.Text);
        }

        return [.. cells.Select(parts => ParseVocabulary.Clean(string.Join(' ', parts)))];
    }

    /// <summary>Regroupe les lignes en blocs : un nouvel item numéroté ouvre un bloc.</summary>
    private static List<string> Blocks(IEnumerable<string> rawLines)
    {
        var blocks = new List<string>();
        var current = new List<string>();

        void Flush()
        {
            if (current.Count == 0) return;
            blocks.Add(string.Join(' ', current));
            current = [];
        }

        foreach (var raw in rawLines)
        {
            var line = ParseVocabulary.Clean(raw);
            if (line.Length == 0) { Flush(); continue; }

            var startsItem = ParseVocabulary.Numbering().IsMatch(line) || line.EndsWith('?');
            if (startsItem && current.Count > 0) Flush();

            current.Add(line);
            if (line.EndsWith('?')) Flush();
        }
        Flush();

        return [.. blocks.Where(block => block.Length >= 12)];
    }
}
