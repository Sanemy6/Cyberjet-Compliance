using System.Text;

namespace Cyberjet.Api.Services.Parsing;

/// <summary>
/// Extraction des questions d'un CSV ou d'un texte collé.
///
/// Deux devinettes à faire avant de lire : l'encodage — un CSV exporté depuis un
/// Excel francophone est rarement en UTF-8 — et le séparateur, qui est le
/// point-virgule chez nous et la virgule ailleurs.
/// </summary>
public static class CsvParser
{
    public static ParseResult Parse(string path)
    {
        var result = new ParseResult { FileType = "csv" };
        var text = ReadWithBestEncoding(File.ReadAllBytes(path));

        var delimiter = SniffDelimiter(text);
        var rows = ReadRows(text, delimiter)
            .Where(row => row.Any(cell => ParseVocabulary.Clean(cell).Length > 0))
            .ToList();

        if (rows.Count == 0)
        {
            result.Warnings.Add("Fichier vide.");
            return result;
        }

        var header = rows[0].Select(ParseVocabulary.Clean).ToArray();
        var questionCol = 0;
        var top = 0;
        for (var c = 0; c < header.Length; c++)
        {
            var score = ParseVocabulary.HeaderScore(header[c], ParseVocabulary.QuestionHeaders);
            if (score > top) (questionCol, top) = (c, score);
        }
        // Une seule colonne et aucun en-tête reconnu : le fichier n'est qu'une
        // liste de questions, la première ligne en fait partie.
        if (top == 0 && header.Length == 1) questionCol = 0;

        var idx = 0;
        foreach (var row in rows.Skip(top > 0 ? 1 : 0))
        {
            if (questionCol >= row.Count) continue;

            var value = ParseVocabulary.Clean(row[questionCol]);
            if (value.Length < 10) continue;

            var (reference, body) = ParseVocabulary.StripNumbering(value);
            result.Questions.Add(new ExtractedQuestion { Idx = ++idx, Text = body, Ref = reference });
        }
        return result;
    }

    /// <summary>Saisie manuelle : une question par ligne.</summary>
    public static ParseResult ParseTextBlock(string raw)
    {
        var result = new ParseResult { FileType = "manuel" };
        var idx = 0;

        foreach (var line in (raw ?? "").Split('\n'))
        {
            var text = ParseVocabulary.Clean(line);
            if (text.Length < 8) continue;

            var (reference, body) = ParseVocabulary.StripNumbering(text);
            result.Questions.Add(new ExtractedQuestion { Idx = ++idx, Text = body, Ref = reference });
        }
        return result;
    }

    /// <summary>
    /// UTF-8 d'abord — avec ou sans BOM —, puis Windows-1252, qui est ce que
    /// produit Excel sous Windows. Latin-1 en dernier recours : il accepte
    /// n'importe quel octet, donc il ne peut pas échouer.
    /// </summary>
    private static string ReadWithBestEncoding(byte[] raw)
    {
        var strictUtf8 = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false,
                                          throwOnInvalidBytes: true);
        try
        {
            var text = strictUtf8.GetString(raw);
            return text.TrimStart('﻿');
        }
        catch (DecoderFallbackException)
        {
            // Pas de l'UTF-8 : on passe aux jeux de caractères hérités.
        }

        try { return Encoding.GetEncoding(1252).GetString(raw); }
        catch (ArgumentException) { return Encoding.Latin1.GetString(raw); }
    }

    private static char SniffDelimiter(string text)
    {
        var sample = text.Length > 4096 ? text[..4096] : text;
        var candidates = new[] { ';', ',', '\t', '|' };

        var best = ';';
        var bestCount = -1;
        foreach (var candidate in candidates)
        {
            var count = sample.Count(ch => ch == candidate);
            if (count > bestCount) (best, bestCount) = (candidate, count);
        }
        // Aucun séparateur : une seule colonne, le choix n'a plus d'importance.
        return bestCount > 0 ? best : ';';
    }

    /// <summary>
    /// Lecteur CSV conforme au RFC 4180 pour ce qui compte ici : guillemets,
    /// guillemets doublés à l'intérieur d'un champ, et retours à la ligne
    /// encadrés — une réponse multiligne dans une cellule est fréquente.
    /// </summary>
    private static List<List<string>> ReadRows(string text, char delimiter)
    {
        var rows = new List<List<string>>();
        var row = new List<string>();
        var field = new StringBuilder();
        var inQuotes = false;

        for (var i = 0; i < text.Length; i++)
        {
            var ch = text[i];

            if (inQuotes)
            {
                if (ch != '"') { field.Append(ch); continue; }
                if (i + 1 < text.Length && text[i + 1] == '"') { field.Append('"'); i++; continue; }
                inQuotes = false;
                continue;
            }

            switch (ch)
            {
                case '"':
                    inQuotes = true;
                    break;

                case var _ when ch == delimiter:
                    row.Add(field.ToString());
                    field.Clear();
                    break;

                case '\r':
                    break;  // absorbé : c'est le \n qui termine la ligne

                case '\n':
                    row.Add(field.ToString());
                    field.Clear();
                    rows.Add(row);
                    row = [];
                    break;

                default:
                    field.Append(ch);
                    break;
            }
        }

        if (field.Length > 0 || row.Count > 0)
        {
            row.Add(field.ToString());
            rows.Add(row);
        }
        return rows;
    }
}
