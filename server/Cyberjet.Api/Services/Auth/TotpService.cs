using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using QRCoder;

namespace Cyberjet.Api.Services.Auth;

/// <summary>
/// Second facteur : mot de passe à usage unique fondé sur le temps (TOTP).
///
/// RFC 6238, compatible Google Authenticator, Microsoft Authenticator, Authy,
/// 1Password, Bitwarden. HMAC-SHA1 sur un compteur temporel de 30 secondes,
/// tolérance d'une fenêtre de part et d'autre pour absorber la dérive d'horloge
/// du téléphone sans élargir inutilement la surface d'attaque.
///
/// Le calcul est fait sur le téléphone, hors ligne : ni SMS, ni réseau, ni
/// service tiers.
/// </summary>
public static class TotpService
{
    /// <summary>Nom affiché dans l'application d'authentification.</summary>
    public const string Issuer = "Cyberjet Compliance";

    private const int StepSeconds = 30;
    private const int Digits = 6;
    private const int Window = 1;

    private const string Base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

    /// <summary>Secret partagé de 160 bits, en base32 sans remplissage — le format
    /// attendu par les applications d'authentification.</summary>
    public static string GenerateSecret() => Base32Encode(RandomNumberGenerator.GetBytes(20));

    /// <summary>
    /// Vérifie un code et renvoie le compteur consommé, ou <c>null</c> si invalide.
    ///
    /// Le compteur est renvoyé pour être mémorisé : rejouer le même code dans sa
    /// fenêtre de 30 secondes doit échouer, sinon un code intercepté reste
    /// utilisable jusqu'à expiration.
    /// </summary>
    public static long? Verify(string? secretBase32, string? code, long? lastCounter = null)
    {
        if (string.IsNullOrWhiteSpace(secretBase32)) return null;

        var cleaned = new string((code ?? "").Where(char.IsAsciiDigit).ToArray());
        if (cleaned.Length != Digits) return null;

        byte[] key;
        try { key = Base32Decode(secretBase32); }
        catch (FormatException) { return null; }

        var current = DateTimeOffset.UtcNow.ToUnixTimeSeconds() / StepSeconds;
        for (var drift = -Window; drift <= Window; drift++)
        {
            var counter = current + drift;
            if (lastCounter is not null && counter <= lastCounter) continue;
            if (CryptographicOperations.FixedTimeEquals(
                    Encoding.ASCII.GetBytes(Compute(key, counter)),
                    Encoding.ASCII.GetBytes(cleaned)))
                return counter;
        }
        return null;
    }

    private static string Compute(byte[] key, long counter)
    {
        Span<byte> buffer = stackalloc byte[8];
        BinaryPrimitives.WriteInt64BigEndian(buffer, counter);

        var digest = HMACSHA1.HashData(key, buffer);
        var offset = digest[^1] & 0x0F;
        var truncated = (uint)(
            ((digest[offset] & 0x7F) << 24)
            | (digest[offset + 1] << 16)
            | (digest[offset + 2] << 8)
            | digest[offset + 3]);

        return (truncated % (uint)Math.Pow(10, Digits)).ToString().PadLeft(Digits, '0');
    }

    /// <summary>URI otpauth:// à encoder en QR pour l'enrôlement.</summary>
    public static string BuildUri(string secretBase32, string username)
    {
        var label = Uri.EscapeDataString($"{Issuer}:{username}");
        var query = string.Join('&',
        [
            $"secret={Uri.EscapeDataString(secretBase32)}",
            $"issuer={Uri.EscapeDataString(Issuer)}",
            "algorithm=SHA1",
            $"digits={Digits}",
            $"period={StepSeconds}",
        ]);
        return $"otpauth://totp/{label}?{query}";
    }

    /// <summary>QR au format SVG : net à toute taille, et aucune dépendance graphique.</summary>
    public static string BuildQrSvg(string uri)
    {
        using var generator = new QRCodeGenerator();
        using var data = generator.CreateQrCode(uri, QRCodeGenerator.ECCLevel.Q);
        using var svg = new SvgQRCode(data);
        return svg.GetGraphic(10, "#000000", "#ffffff", drawQuietZones: true);
    }

    /// <summary>Secret en groupes de 4 pour la saisie manuelle, quand le QR n'est
    /// pas scannable (poste sans caméra, application de bureau).</summary>
    public static string FormatForDisplay(string secretBase32) =>
        string.Join(' ', Chunk(secretBase32, 4));

    private static IEnumerable<string> Chunk(string value, int size)
    {
        for (var i = 0; i < value.Length; i += size)
            yield return value.Substring(i, Math.Min(size, value.Length - i));
    }

    private static string Base32Encode(ReadOnlySpan<byte> data)
    {
        var builder = new StringBuilder((data.Length * 8 + 4) / 5);
        int buffer = 0, bitsLeft = 0;

        foreach (var b in data)
        {
            buffer = (buffer << 8) | b;
            bitsLeft += 8;
            while (bitsLeft >= 5)
            {
                builder.Append(Base32Alphabet[(buffer >> (bitsLeft - 5)) & 31]);
                bitsLeft -= 5;
            }
        }
        if (bitsLeft > 0)
            builder.Append(Base32Alphabet[(buffer << (5 - bitsLeft)) & 31]);

        return builder.ToString();
    }

    private static byte[] Base32Decode(string encoded)
    {
        var output = new List<byte>(encoded.Length * 5 / 8 + 1);
        int buffer = 0, bitsLeft = 0;

        foreach (var raw in encoded)
        {
            if (raw is '=' or ' ' or '-') continue;
            var index = Base32Alphabet.IndexOf(char.ToUpperInvariant(raw));
            if (index < 0) throw new FormatException($"Caractère base32 invalide : « {raw} ».");

            buffer = (buffer << 5) | index;
            bitsLeft += 5;
            if (bitsLeft >= 8)
            {
                output.Add((byte)((buffer >> (bitsLeft - 8)) & 0xFF));
                bitsLeft -= 8;
            }
        }
        return [.. output];
    }
}
