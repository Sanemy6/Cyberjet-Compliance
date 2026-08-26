using System.Globalization;
using ClosedXML.Excel;

namespace Cyberjet.Api.Services.Parsing;

/// <summary>
/// Extraction des questions d'un classeur Excel.
///
/// Stratégie : on cherche la ligne d'en-tête, puis on identifie par mots-clés les
/// colonnes Question / Réponse / Référence / Section. En dernier recours, la
/// colonne « question » est celle dont le texte est le plus long en moyenne.
///
/// Les coordonnées (feuille, ligne, colonne) sont conservées dans un
/// <see cref="QuestionLocator"/> : ce sont elles qui permettent de réinjecter les
/// réponses dans le classeur d'origine, à leur emplacement exact.
/// </summary>
public static class ExcelParser
{
    private const int MaxRows = 4000;

    /// <summary>Au-delà, ce n'est plus un en-tête mais une phrase : une cellule
    /// longue ne doit pas être élue « colonne Question » par accident.</summary>
    private const int MaxHeaderLength = 60;

    private sealed class ColumnMap
    {
        public int? Question { get; set; }
        public int? Answer { get; set; }
        public int? Ref { get; set; }
        public int? Section { get; set; }
        public int? Evidence { get; set; }
        public bool AnswerCreated { get; set; }
    }

    public static ParseResult Parse(string path)
    {
        var result = new ParseResult { FileType = "xlsx" };
        using var workbook = new XLWorkbook(path);
        var idx = 0;

        foreach (var sheet in workbook.Worksheets)
        {
            if (sheet.Visibility != XLWorksheetVisibility.Visible) continue;

            var grid = ReadGrid(sheet);
            if (grid.Count < 2) continue;

            var (headerRow, columns) = DetectColumns(grid);
            if (columns.Question is null) continue;

            var questionCol = columns.Question.Value;
            if (columns.Answer is null)
            {
                columns.Answer = FirstFreeColumn(grid, headerRow, questionCol);
                columns.AnswerCreated = true;
            }
            var answerCol = columns.Answer.Value;

            string? currentSection = null;
            for (var r = headerRow + 1; r < grid.Count; r++)
            {
                var row = grid[r];
                var question = questionCol < row.Length ? row[questionCol] : "";
                if (string.IsNullOrEmpty(question)) continue;

                var filled = row.Count(cell => cell.Length > 0);

                // Ligne ne contenant qu'un libellé court : c'est un titre de section.
                if (filled == 1 && question.Length < 70 && !question.EndsWith('?'))
                {
                    currentSection = question;
                    continue;
                }
                if (question.Length < 10) continue;

                string? reference = null;
                if (columns.Ref is { } refCol && refCol < row.Length && row[refCol].Length > 0)
                    reference = row[refCol];

                var section = currentSection;
                if (columns.Section is { } sectionCol && sectionCol < row.Length
                    && row[sectionCol].Length > 0)
                    section = row[sectionCol];

                if (reference is null)
                    (reference, question) = ParseVocabulary.StripNumbering(question);

                idx++;
                result.Questions.Add(new ExtractedQuestion
                {
                    Idx = idx,
                    Text = question,
                    Ref = reference,
                    Section = section,
                    Locator = new QuestionLocator
                    {
                        Sheet = sheet.Name,
                        Row = r + 1,                    // 1-indexé, comme Excel
                        QuestionCol = questionCol + 1,
                        AnswerCol = answerCol + 1,
                        HeaderRow = headerRow + 1,
                        AnswerCreated = columns.AnswerCreated,
                    },
                });
            }
        }

        if (result.Questions.Count == 0)
            result.Warnings.Add(
                "Aucune colonne de questions identifiée. Vérifiez que le classeur contient "
                + "bien une colonne d'intitulés (Question, Exigence, Contrôle…).");

        return result;
    }

    /// <summary>
    /// Lit la feuille en une grille de chaînes propres, cellules fusionnées
    /// résolues sur la valeur de leur cellule porteuse. Sans cette résolution, un
    /// libellé de section fusionné sur cinq colonnes apparaîtrait vide partout
    /// sauf en tête, et la détection de colonnes s'en trouverait faussée.
    /// </summary>
    private static List<string[]> ReadGrid(IXLWorksheet sheet)
    {
        var grid = new List<string[]>();

        var lastRow = sheet.LastRowUsed()?.RowNumber() ?? 0;
        var lastColumn = sheet.LastColumnUsed()?.ColumnNumber() ?? 0;
        if (lastRow < 2 || lastColumn < 1) return grid;

        var rowCount = Math.Min(lastRow, MaxRows);

        var mergedAnchors = new Dictionary<(int Row, int Col), (int Row, int Col)>();
        foreach (var range in sheet.MergedRanges)
        {
            var first = range.RangeAddress.FirstAddress;
            var last = range.RangeAddress.LastAddress;
            for (var r = first.RowNumber; r <= last.RowNumber; r++)
                for (var c = first.ColumnNumber; c <= last.ColumnNumber; c++)
                    mergedAnchors[(r, c)] = (first.RowNumber, first.ColumnNumber);
        }

        for (var r = 1; r <= rowCount; r++)
        {
            var values = new string[lastColumn];
            for (var c = 1; c <= lastColumn; c++)
            {
                var text = CellText(sheet.Cell(r, c));
                if (text.Length == 0 && mergedAnchors.TryGetValue((r, c), out var anchor))
                    text = CellText(sheet.Cell(anchor.Row, anchor.Col));
                values[c - 1] = ParseVocabulary.Clean(text);
            }
            grid.Add(values);
        }
        return grid;
    }

    private static string CellText(IXLCell cell)
    {
        // Sur une cellule de formule, on lit la valeur mise en cache par Excel
        // plutôt que de demander à ClosedXML de recalculer : le recalcul échoue
        // sur les fonctions qu'il ne connaît pas, et la valeur en cache est
        // précisément ce que le client voyait à l'écran.
        var value = cell.HasFormula ? cell.CachedValue : cell.Value;

        if (value.IsBlank || value.IsError) return "";
        if (value.IsText) return value.GetText();
        if (value.IsNumber) return value.GetNumber().ToString(CultureInfo.InvariantCulture);
        if (value.IsDateTime) return value.GetDateTime().ToString("yyyy-MM-dd");
        if (value.IsTimeSpan) return value.GetTimeSpan().ToString();
        if (value.IsBoolean) return value.GetBoolean() ? "VRAI" : "FAUX";
        return value.ToString() ?? "";
    }

    /// <summary>Localise la ligne d'en-tête et le rôle de chaque colonne.</summary>
    private static (int HeaderRow, ColumnMap Columns) DetectColumns(List<string[]> grid)
    {
        var scan = Math.Min(grid.Count, 25);
        var bestRow = 0;
        var bestScore = -1;

        for (var r = 0; r < scan; r++)
        {
            var score = 0;
            foreach (var cell in grid[r])
            {
                if (cell.Length == 0 || cell.Length > MaxHeaderLength) continue;
                score += Math.Max(
                    Math.Max(ParseVocabulary.HeaderScore(cell, ParseVocabulary.QuestionHeaders),
                             ParseVocabulary.HeaderScore(cell, ParseVocabulary.AnswerHeaders)),
                    Math.Max(ParseVocabulary.HeaderScore(cell, ParseVocabulary.RefHeaders),
                             ParseVocabulary.HeaderScore(cell, ParseVocabulary.SectionHeaders)));
            }
            if (score > bestScore) (bestRow, bestScore) = (r, score);
        }

        var header = bestScore > 0 ? grid[bestRow] : [];
        var columns = new ColumnMap
        {
            Question = BestColumn(header, ParseVocabulary.QuestionHeaders),
            Answer = BestColumn(header, ParseVocabulary.AnswerHeaders),
            Ref = BestColumn(header, ParseVocabulary.RefHeaders),
            Section = BestColumn(header, ParseVocabulary.SectionHeaders),
            Evidence = BestColumn(header, ParseVocabulary.EvidenceHeaders),
        };

        // Repli : la colonne « question » est celle au texte le plus long.
        if (columns.Question is null)
        {
            columns.Question = WidestTextColumn(grid, bestRow);
            // Pas d'en-tête du tout : les données commencent dès la ligne 1.
            if (bestScore <= 0) bestRow = -1;
        }

        // Une même colonne ne peut pas être à la fois question et réponse.
        if (columns.Answer is not null && columns.Answer == columns.Question)
            columns.Answer = null;

        return (bestRow, columns);
    }

    private static int? BestColumn(string[] header, string[] keywords)
    {
        int? best = null;
        var top = 0;
        for (var c = 0; c < header.Length; c++)
        {
            var text = header[c];
            if (text.Length == 0 || text.Length > MaxHeaderLength) continue;
            var score = ParseVocabulary.HeaderScore(text, keywords);
            if (score > top) (best, top) = (c, score);
        }
        return best;
    }

    private static int? WidestTextColumn(List<string[]> grid, int headerRow)
    {
        var width = grid.Count == 0 ? 0 : grid.Max(row => row.Length);
        int? best = null;
        var bestAverage = 0.0;

        for (var c = 0; c < width; c++)
        {
            var lengths = new List<int>();
            for (var r = headerRow + 1; r < grid.Count; r++)
            {
                if (c >= grid[r].Length) continue;
                var length = grid[r][c].Length;
                if (length > 0) lengths.Add(length);
            }
            // Moins de trois valeurs : trop peu pour dire que c'est une colonne.
            if (lengths.Count < 3) continue;

            var average = lengths.Average();
            if (average > bestAverage && average >= 20) (best, bestAverage) = (c, average);
        }
        return best;
    }

    /// <summary>Première colonne entièrement vide après celle des questions —
    /// c'est là qu'on écrira les réponses si le classeur n'en prévoyait pas.</summary>
    private static int FirstFreeColumn(List<string[]> grid, int headerRow, int questionCol)
    {
        var width = grid.Count == 0 ? 0 : grid.Max(row => row.Length);
        for (var c = questionCol + 1; c < width + 2; c++)
        {
            var empty = true;
            for (var r = Math.Max(headerRow, 0); r < grid.Count && empty; r++)
                if (c < grid[r].Length && grid[r][c].Length > 0) empty = false;
            if (empty) return c;
        }
        return width;
    }
}
