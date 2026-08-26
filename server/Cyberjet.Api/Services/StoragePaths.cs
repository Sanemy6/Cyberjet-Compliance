namespace Cyberjet.Api.Services;

/// <summary>
/// Emplacements sur disque des fichiers qui ne vont pas en base : questionnaires
/// reçus et exports produits.
///
/// Un seul dossier racine, configurable par <c>Storage:DataDirectory</c>, parce
/// que c'est le seul à sauvegarder — et qu'un chemin de sauvegarde doit tenir en
/// une ligne dans une procédure d'exploitation.
/// </summary>
public sealed class StoragePaths
{
    public string DataDirectory { get; }
    public string UploadDirectory { get; }
    public string ExportDirectory { get; }

    public StoragePaths(IConfiguration configuration, IHostEnvironment environment)
    {
        var configured = configuration["Storage:DataDirectory"];
        DataDirectory = string.IsNullOrWhiteSpace(configured)
            ? Path.Combine(environment.ContentRootPath, "data")
            : Path.GetFullPath(configured, environment.ContentRootPath);

        UploadDirectory = Path.Combine(DataDirectory, "uploads");
        ExportDirectory = Path.Combine(DataDirectory, "exports");

        Directory.CreateDirectory(DataDirectory);
        Directory.CreateDirectory(UploadDirectory);
        Directory.CreateDirectory(ExportDirectory);
    }

    /// <summary>Supprime un fichier sans jamais faire échouer l'appelant : un
    /// fichier déjà absent, ou verrouillé par l'antivirus, ne doit pas empêcher
    /// la suppression de l'enregistrement qui le référence.</summary>
    public static void TryDelete(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return;
        try { File.Delete(path); }
        catch (IOException) { /* fichier verrouillé : il sera nettoyé plus tard */ }
        catch (UnauthorizedAccessException) { /* droits insuffisants : idem */ }
    }

    public static (int Count, long Bytes) Measure(string directory)
    {
        if (!Directory.Exists(directory)) return (0, 0);
        var files = Directory.EnumerateFiles(directory, "*", SearchOption.AllDirectories)
                             .Select(path => new FileInfo(path))
                             .ToList();
        return (files.Count, files.Sum(file => file.Length));
    }
}
