using Cyberjet.Api.Services.Parsing;

namespace Cyberjet.Api.Tests.Services.Parsing;

public sealed class FileSignatureTests : IDisposable
{
    private readonly string _tempDir = Directory.CreateTempSubdirectory("cyberjet-filesig-tests").FullName;

    [Fact]
    public void Un_zip_declare_xlsx_correspond()
    {
        var path = WriteBytes([0x50, 0x4B, 0x03, 0x04, 0x00, 0x00]);

        Assert.True(FileSignature.Matches(path, "xlsx"));
    }

    [Fact]
    public void Un_zip_declare_docx_correspond()
    {
        var path = WriteBytes([0x50, 0x4B, 0x03, 0x04]);

        Assert.True(FileSignature.Matches(path, "docx"));
    }

    [Fact]
    public void Un_pdf_declare_pdf_correspond()
    {
        var path = WriteBytes("%PDF-1.7"u8.ToArray());

        Assert.True(FileSignature.Matches(path, "pdf"));
    }

    [Fact]
    public void Un_fichier_texte_renomme_en_xlsx_est_rejete()
    {
        // Le cas concret que cette vérification défend : renommer "notes.txt"
        // en "notes.xlsx" ne change rien au contenu réel du fichier.
        var path = WriteBytes("ceci n'est pas un classeur"u8.ToArray());

        Assert.False(FileSignature.Matches(path, "xlsx"));
    }

    [Fact]
    public void Un_fichier_trop_court_est_rejete_sans_lever()
    {
        var path = WriteBytes([0x50, 0x4B]);

        Assert.False(FileSignature.Matches(path, "xlsx"));
    }

    [Fact]
    public void Csv_n_a_pas_de_signature_a_verifier()
    {
        var path = WriteBytes("colonne1;colonne2"u8.ToArray());

        Assert.True(FileSignature.Matches(path, "csv"));
    }

    private string WriteBytes(byte[] content)
    {
        var path = Path.Combine(_tempDir, $"{Guid.NewGuid():N}.bin");
        File.WriteAllBytes(path, content);
        return path;
    }

    public void Dispose() => Directory.Delete(_tempDir, recursive: true);
}
