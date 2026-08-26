namespace Cyberjet.Api.Services.Parsing;

/// <summary>
/// Vérifie que le contenu d'un fichier correspond bien au type annoncé par son
/// extension — une extension se renomme en un clic, les premiers octets
/// beaucoup moins facilement. Défense en profondeur : les analyseurs
/// (ClosedXML, OpenXml, PdfPig) échouent déjà proprement sur un contenu
/// incohérent, mais échouent après avoir commencé à lire le fichier plutôt
/// qu'avant.
///
/// csv/txt n'ont pas de signature binaire — un fichier texte n'a rien à
/// vérifier au-delà de ce que l'extension annonce déjà.
/// </summary>
public static class FileSignature
{
    private static readonly byte[] ZipMagic = [0x50, 0x4B, 0x03, 0x04];
    private static readonly byte[] PdfMagic = [0x25, 0x50, 0x44, 0x46]; // "%PDF"

    /// <summary>Vrai si les premiers octets du fichier correspondent au type
    /// annoncé. Toujours vrai pour csv, faute de signature à vérifier.</summary>
    public static bool Matches(string path, string declaredType)
    {
        if (declaredType is not ("xlsx" or "docx" or "pdf")) return true;

        var header = ReadHeader(path, 4);

        return declaredType switch
        {
            "xlsx" or "docx" => StartsWith(header, ZipMagic),
            "pdf" => StartsWith(header, PdfMagic),
            _ => true,
        };
    }

    private static byte[] ReadHeader(string path, int length)
    {
        using var stream = File.OpenRead(path);
        var buffer = new byte[length];
        var read = stream.Read(buffer, 0, length);
        return read == length ? buffer : buffer[..read];
    }

    private static bool StartsWith(byte[] header, byte[] magic)
    {
        if (header.Length < magic.Length) return false;
        for (var i = 0; i < magic.Length; i++)
            if (header[i] != magic[i]) return false;
        return true;
    }
}
