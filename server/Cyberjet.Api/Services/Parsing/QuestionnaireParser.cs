namespace Cyberjet.Api.Services.Parsing;

/// <summary>Aiguillage vers l'analyseur correspondant au format reçu.</summary>
public static class QuestionnaireParser
{
    public static readonly string[] SupportedTypes = ["xlsx", "docx", "pdf", "csv"];

    public static ParseResult Parse(string path, string? filename = null)
    {
        var kind = ParseVocabulary.DetectFileType(filename ?? Path.GetFileName(path));

        // xlsx et docx sont tous deux des archives ZIP : la borne s'applique
        // avant que ClosedXML ou OpenXml ne décompresse quoi que ce soit.
        if (kind is "xlsx" or "docx") ZipGuard.EnsureSafeToExpand(path);

        return kind switch
        {
            "xlsx" => ExcelParser.Parse(path),
            "docx" => WordParser.Parse(path),
            "pdf" => PdfParser.Parse(path),
            "csv" => CsvParser.Parse(path),
            _ => Unsupported(kind),
        };
    }

    public static ParseResult ParseTextBlock(string raw) => CsvParser.ParseTextBlock(raw);

    private static ParseResult Unsupported(string kind)
    {
        var result = new ParseResult { FileType = kind };
        result.Warnings.Add($"Format « {kind} » non pris en charge.");
        return result;
    }
}
