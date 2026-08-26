using System.IO.Compression;
using Cyberjet.Api.Services.Parsing;

namespace Cyberjet.Api.Tests.Services.Parsing;

public sealed class ZipGuardTests : IDisposable
{
    private readonly string _tempDir = Directory.CreateTempSubdirectory("cyberjet-zipguard-tests").FullName;

    [Fact]
    public void Une_archive_normale_passe_la_garde()
    {
        var path = CreateZip(zip =>
        {
            using var writer = new StreamWriter(zip.CreateEntry("[Content_Types].xml").Open());
            writer.Write("<Types/>");
        });

        ZipGuard.EnsureSafeToExpand(path); // ne doit pas lever
    }

    [Fact]
    public void Une_archive_hautement_compressible_est_rejetee()
    {
        // Un .xlsx/.docx est un ZIP de XML, hautement compressible : un fichier
        // de quelques centaines de Ko peut décompresser à plusieurs centaines
        // de Mo. C'est exactement ce que cette garde doit intercepter avant
        // que ClosedXML/OpenXml ne commence à tout charger en mémoire.
        var path = CreateZip(zip =>
        {
            using var entry = zip.CreateEntry("[Content_Types].xml", CompressionLevel.SmallestSize).Open();
            var block = new byte[1024 * 1024];
            for (var written = 0L; written < 250L * 1024 * 1024; written += block.Length)
                entry.Write(block);
        });

        Assert.Throws<InvalidDataException>(() => ZipGuard.EnsureSafeToExpand(path));
    }

    [Fact]
    public void Une_archive_avec_trop_d_entrees_est_rejetee()
    {
        var path = CreateZip(zip =>
        {
            for (var i = 0; i < 10_001; i++)
                zip.CreateEntry($"entry-{i}.xml");
        });

        Assert.Throws<InvalidDataException>(() => ZipGuard.EnsureSafeToExpand(path));
    }

    private string CreateZip(Action<ZipArchive> write)
    {
        var path = Path.Combine(_tempDir, $"{Guid.NewGuid():N}.zip");
        using var archive = ZipFile.Open(path, ZipArchiveMode.Create);
        write(archive);
        return path;
    }

    public void Dispose() => Directory.Delete(_tempDir, recursive: true);
}
