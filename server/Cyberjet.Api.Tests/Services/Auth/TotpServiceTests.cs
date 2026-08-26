using System.Buffers.Binary;
using System.Security.Cryptography;
using Cyberjet.Api.Services.Auth;

namespace Cyberjet.Api.Tests.Services.Auth;

public sealed class TotpServiceTests
{
    [Fact]
    public void Verify_avec_le_code_courant_reussit()
    {
        var secret = TotpService.GenerateSecret();

        Assert.NotNull(TotpService.Verify(secret, ComputeCode(secret)));
    }

    [Fact]
    public void Verify_avec_un_code_incorrect_echoue()
    {
        var secret = TotpService.GenerateSecret();

        Assert.Null(TotpService.Verify(secret, "000000"));
    }

    [Fact]
    public void Verify_rejette_un_code_deja_consomme_a_ce_compteur()
    {
        // Anti-replay : un code intercepté ne doit pas rester utilisable une
        // deuxième fois dans sa fenêtre de 30 secondes.
        var secret = TotpService.GenerateSecret();
        var code = ComputeCode(secret);

        var counter = TotpService.Verify(secret, code);
        Assert.NotNull(counter);
        Assert.Null(TotpService.Verify(secret, code, lastCounter: counter));
    }

    [Fact]
    public void Verify_avec_un_secret_vide_echoue_sans_lever()
    {
        Assert.Null(TotpService.Verify(null, "123456"));
        Assert.Null(TotpService.Verify("", "123456"));
    }

    [Theory]
    [InlineData("12345")]
    [InlineData("1234567")]
    public void Verify_avec_un_code_de_longueur_incorrecte_echoue(string code)
    {
        var secret = TotpService.GenerateSecret();

        Assert.Null(TotpService.Verify(secret, code));
    }

    [Fact]
    public void BuildUri_reprend_le_secret_et_l_emetteur()
    {
        var secret = TotpService.GenerateSecret();

        var uri = TotpService.BuildUri(secret, "alice");

        Assert.Contains("secret=", uri);
        Assert.Contains(Uri.EscapeDataString(TotpService.Issuer), uri);
    }

    /// <summary>Recalcule, par la même formule RFC 6238 que le service, le code
    /// qu'une application d'authentification afficherait à l'instant présent.
    /// TotpService ne l'expose pas lui-même : un service d'auth n'a aucune
    /// raison de fournir de calculer un code hors de son propre flux de
    /// vérification.</summary>
    private static string ComputeCode(string secretBase32)
    {
        var key = Base32Decode(secretBase32);
        var counter = DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 30;

        Span<byte> buffer = stackalloc byte[8];
        BinaryPrimitives.WriteInt64BigEndian(buffer, counter);

        var digest = HMACSHA1.HashData(key, buffer);
        var offset = digest[^1] & 0x0F;
        var truncated = (uint)(
            ((digest[offset] & 0x7F) << 24)
            | (digest[offset + 1] << 16)
            | (digest[offset + 2] << 8)
            | digest[offset + 3]);

        return (truncated % 1_000_000).ToString().PadLeft(6, '0');
    }

    private const string Base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

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
