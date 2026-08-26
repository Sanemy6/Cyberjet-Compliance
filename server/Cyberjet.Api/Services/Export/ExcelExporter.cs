using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using ClosedXML.Excel;
using Cyberjet.Api.Data;
using Cyberjet.Api.Services.Parsing;
using Cyberjet.Api.Services.Search;

namespace Cyberjet.Api.Services.Export;

/// <summary>
/// Export des questionnaires traités. Deux modes :
///
///   * <b>original</b> — réinjection des réponses dans le classeur Excel reçu du
///     client, à l'emplacement exact repéré à l'import. C'est ce que le client
///     attend : son propre fichier, complété.
///   * <b>rapport</b>  — classeur récapitulatif autonome, disponible quel que
///     soit le format d'origine (Word, PDF, saisie manuelle).
/// </summary>
public sealed partial class ExcelExporter(StoragePaths paths)
{
    private static readonly XLColor HeaderFill = XLColor.FromHtml("#0F2740");
    private static readonly XLColor BorderColor = XLColor.FromHtml("#D6DEE8");

    private static XLColor BandFill(string band) => band switch
    {
        "haute" => XLColor.FromHtml("#E4F5EC"),
        "moyenne" => XLColor.FromHtml("#FFF4E0"),
        "faible" => XLColor.FromHtml("#FDE9E7"),
        _ => XLColor.FromHtml("#F1F3F7"),
    };

    [GeneratedRegex(@"[^A-Za-z0-9_.\- ]+")]
    private static partial Regex UnsafeFilenameChars();

    private static string SafeName(string name)
    {
        var cleaned = UnsafeFilenameChars().Replace(name, "_").Trim();
        return cleaned.Length == 0 ? "export" : cleaned;
    }

    private static string AnswerOf(QuestionnaireQuestion question) =>
        (question.FinalAnswer ?? question.SuggestedAnswer ?? "").Trim();

    private static string Stamp() => DateTime.Now.ToString("yyyyMMdd-HHmm", CultureInfo.InvariantCulture);

    /// <summary>
    /// Recopie les réponses dans le classeur d'origine et enregistre une copie.
    /// </summary>
    /// <exception cref="FileNotFoundException">Le fichier reçu du client a disparu du disque.</exception>
    /// <exception cref="InvalidOperationException">Aucune réponse à écrire.</exception>
    public string ExportOriginal(Questionnaire questionnaire, IReadOnlyList<QuestionnaireQuestion> questions)
    {
        if (string.IsNullOrWhiteSpace(questionnaire.StoredPath) || !File.Exists(questionnaire.StoredPath))
            throw new FileNotFoundException("Le fichier d'origine est introuvable.");

        using var workbook = new XLWorkbook(questionnaire.StoredPath);
        var written = 0;
        var headersDone = new HashSet<(string Sheet, int Column)>();

        foreach (var question in questions)
        {
            if (string.IsNullOrWhiteSpace(question.LocatorJson)) continue;

            QuestionLocator? locator;
            try { locator = JsonSerializer.Deserialize<QuestionLocator>(question.LocatorJson); }
            catch (JsonException) { continue; }
            if (locator is null || !workbook.Worksheets.Contains(locator.Sheet)) continue;

            var answer = AnswerOf(question);
            if (answer.Length == 0) continue;

            var sheet = workbook.Worksheet(locator.Sheet);

            // Le classeur d'origine n'avait pas de colonne de réponse : on lui en
            // écrit l'en-tête une seule fois, dans le style du reste du tableau.
            if (locator.AnswerCreated && headersDone.Add((locator.Sheet, locator.AnswerCol)))
            {
                var headerRow = Math.Max(locator.HeaderRow, 1);
                var headerCell = sheet.Cell(headerRow, locator.AnswerCol);
                headerCell.Value = "Réponse";
                headerCell.Style.Fill.BackgroundColor = HeaderFill;
                headerCell.Style.Font.FontColor = XLColor.White;
                headerCell.Style.Font.Bold = true;
                headerCell.Style.Font.FontSize = 11;
                headerCell.Style.Alignment.WrapText = true;
                headerCell.Style.Alignment.Vertical = XLAlignmentVerticalValues.Top;
                sheet.Column(locator.AnswerCol).Width = 70;
            }

            var cell = sheet.Cell(locator.Row, locator.AnswerCol);
            cell.Value = answer;
            cell.Style.Alignment.WrapText = true;
            cell.Style.Alignment.Vertical = XLAlignmentVerticalValues.Top;
            written++;
        }

        if (written == 0)
            throw new InvalidOperationException("Aucune réponse à écrire : validez au moins une question.");

        var stem = SafeName(Path.GetFileNameWithoutExtension(
            questionnaire.OriginalFilename ?? questionnaire.Name));
        var target = Path.Combine(paths.ExportDirectory, $"{stem}_complete_{Stamp()}.xlsx");
        workbook.SaveAs(target);
        return target;
    }

    /// <summary>Classeur récapitulatif : synthèse puis détail question par question.</summary>
    public string ExportReport(Questionnaire questionnaire,
                               IReadOnlyList<QuestionnaireQuestion> questions,
                               string clientName)
    {
        using var workbook = new XLWorkbook();

        // --- Synthèse ---
        var summary = workbook.AddWorksheet("Synthèse");
        var total = questions.Count;
        var validated = questions.Count(q => q.Status == "validated");
        var notApplicable = questions.Count(q => q.Status == "na");
        var answered = questions.Count(q => AnswerOf(q).Length > 0);

        var meta = new (string Label, string Value)[]
        {
            ("Client", clientName),
            ("Questionnaire", questionnaire.Name),
            ("Fichier d'origine", questionnaire.OriginalFilename ?? "—"),
            ("Date d'export", DateTime.Now.ToString("dd/MM/yyyy HH:mm", CultureInfo.InvariantCulture)),
            ("", ""),
            ("Questions", total.ToString(CultureInfo.InvariantCulture)),
            ("Réponses proposées", answered.ToString(CultureInfo.InvariantCulture)),
            ("Réponses validées", validated.ToString(CultureInfo.InvariantCulture)),
            ("Sans objet", notApplicable.ToString(CultureInfo.InvariantCulture)),
            ("Taux de couverture", total > 0 ? $"{answered * 100.0 / total:0} %" : "—"),
            ("Taux de validation", total > 0 ? $"{validated * 100.0 / total:0} %" : "—"),
        };

        for (var r = 0; r < meta.Length; r++)
        {
            summary.Cell(r + 1, 1).Value = meta[r].Label;
            summary.Cell(r + 1, 1).Style.Font.Bold = true;
            summary.Cell(r + 1, 2).Value = meta[r].Value;
        }
        summary.Column(1).Width = 26;
        summary.Column(2).Width = 60;

        // --- Détail ---
        var detail = workbook.AddWorksheet("Réponses");
        string[] headers =
            ["N°", "Section", "Réf.", "Question", "Réponse", "Confiance", "Statut", "Source"];

        for (var c = 0; c < headers.Length; c++)
        {
            var cell = detail.Cell(1, c + 1);
            cell.Value = headers[c];
            cell.Style.Fill.BackgroundColor = HeaderFill;
            cell.Style.Font.FontColor = XLColor.White;
            cell.Style.Font.Bold = true;
            cell.Style.Font.FontSize = 11;
            cell.Style.Alignment.WrapText = true;
            cell.Style.Alignment.Vertical = XLAlignmentVerticalValues.Top;
            ApplyBorder(cell);
        }

        for (var i = 0; i < questions.Count; i++)
        {
            var question = questions[i];
            var row = i + 2;
            var confidence = question.Confidence;

            detail.Cell(row, 1).Value = question.Idx;
            detail.Cell(row, 2).Value = question.Section ?? "";
            detail.Cell(row, 3).Value = question.Ref ?? "";
            detail.Cell(row, 4).Value = question.Text;
            detail.Cell(row, 5).Value = AnswerOf(question);
            detail.Cell(row, 6).Value = confidence > 0 ? $"{confidence * 100:0} %" : "—";
            detail.Cell(row, 7).Value = StatusLabel(question.Status);
            detail.Cell(row, 8).Value = SourceLabel(question);

            for (var c = 1; c <= headers.Length; c++)
            {
                var cell = detail.Cell(row, c);
                cell.Style.Alignment.WrapText = true;
                cell.Style.Alignment.Vertical = XLAlignmentVerticalValues.Top;
                ApplyBorder(cell);
            }
            detail.Cell(row, 6).Style.Fill.BackgroundColor = BandFill(SearchIndex.Band(confidence));
        }

        var widths = new[] { 6, 22, 14, 60, 70, 12, 14, 28 };
        for (var c = 0; c < widths.Length; c++) detail.Column(c + 1).Width = widths[c];
        detail.SheetView.FreezeRows(1);

        var target = Path.Combine(paths.ExportDirectory,
                                  $"{SafeName(questionnaire.Name)}_rapport_{Stamp()}.xlsx");
        workbook.SaveAs(target);
        return target;
    }

    private static void ApplyBorder(IXLCell cell)
    {
        cell.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
        cell.Style.Border.OutsideBorderColor = BorderColor;
    }

    private static string StatusLabel(string status) => status switch
    {
        "validated" => "Validée",
        "auto" => "Proposée",
        "pending" => "À traiter",
        "na" => "Sans objet",
        _ => status,
    };

    private static string SourceLabel(QuestionnaireQuestion question) => question.MatchedKind switch
    {
        "kb" => "Base de connaissance",
        "config" => "Configuration client",
        _ => AnswerOf(question).Length > 0 ? "Saisie manuelle" : "",
    };
}
