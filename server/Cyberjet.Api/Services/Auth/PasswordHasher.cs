using System.Security.Cryptography;
using System.Text;

namespace Cyberjet.Api.Services.Auth;

/// <summary>
/// Hachage des mots de passe : PBKDF2-HMAC-SHA256, 260 000 itérations, sel de
/// 16 octets tiré au hasard par compte.
///
/// PBKDF2 plutôt qu'Argon2 ou bcrypt : il est fourni par la bibliothèque
/// standard .NET, donc rien à installer ni à maintenir, et le paramétrage retenu
/// reste conforme aux recommandations OWASP pour cette famille. La comparaison
/// est faite en temps constant.
///
/// Le format de stockage (sel et empreinte en hexadécimal, deux colonnes
/// distinctes) est identique à celui de la version précédente de l'application :
/// c'est ce qui permet de migrer les comptes existants sans forcer personne à
/// changer de mot de passe.
/// </summary>
public static class PasswordHasher
{
    private const int Iterations = 260_000;
    private const int SaltBytes = 16;
    private const int KeyBytes = 32;

    public readonly record struct HashedPassword(string Salt, string Hash);

    public static HashedPassword Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltBytes);
        return new HashedPassword(Convert.ToHexString(salt).ToLowerInvariant(),
                                  Convert.ToHexString(Derive(password, salt)).ToLowerInvariant());
    }

    public static bool Verify(string password, string saltHex, string hashHex)
    {
        byte[] salt;
        byte[] expected;
        try
        {
            salt = Convert.FromHexString(saltHex);
            expected = Convert.FromHexString(hashHex);
        }
        catch (FormatException)
        {
            // Empreinte illisible : le compte ne peut pas s'authentifier, mais
            // l'API ne doit pas rendre 500 pour autant.
            return false;
        }

        var actual = Derive(password, salt);
        return CryptographicOperations.FixedTimeEquals(actual, expected);
    }

    private static byte[] Derive(string password, byte[] salt) =>
        Rfc2898DeriveBytes.Pbkdf2(
            Encoding.UTF8.GetBytes(password), salt, Iterations, HashAlgorithmName.SHA256, KeyBytes);
}
