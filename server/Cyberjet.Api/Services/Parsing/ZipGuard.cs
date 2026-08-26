using System.IO.Compression;

namespace Cyberjet.Api.Services.Parsing;

/// <summary>
/// Un .xlsx ou .docx est une archive ZIP contenant du XML — hautement
/// compressible. Un fichier de quelques Mo peut donc décompresser à plusieurs
/// Go en mémoire lors du parsing ("zip bomb"), qu'aucune des deux librairies
/// (ClosedXML, DocumentFormat.OpenXml) ne borne elle-même. Cette vérification
/// lit uniquement les tailles déclarées dans les en-têtes de l'archive — pas
/// son contenu — donc coûte peu avant d'accepter de tout décompresser.
/// </summary>
public static class ZipGuard
{
    private const long MaxUncompressedBytes = 200 * 1024 * 1024;
    private const long MaxEntryCount = 10_000;

    /// <summary>Lève si l'archive dépasse les bornes ; ne fait rien sur un
    /// fichier qui n'est pas un ZIP valide, cette erreur-là appartient au
    /// parseur appelant.</summary>
    public static void EnsureSafeToExpand(string path)
    {
        using var archive = ZipFile.OpenRead(path);

        if (archive.Entries.Count > MaxEntryCount)
            throw new InvalidDataException(
                $"Archive suspecte : {archive.Entries.Count} entrées, plus que "
                + $"les {MaxEntryCount} attendues dans un document Office.");

        long total = 0;
        foreach (var entry in archive.Entries)
        {
            total += entry.Length;
            if (total > MaxUncompressedBytes)
                throw new InvalidDataException(
                    "Archive suspecte : le contenu décompressé dépasse "
                    + $"{MaxUncompressedBytes / (1024 * 1024)} Mo.");
        }
    }
}
