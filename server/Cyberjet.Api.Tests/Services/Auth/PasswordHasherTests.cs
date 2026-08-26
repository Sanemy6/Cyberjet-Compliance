using Cyberjet.Api.Services.Auth;

namespace Cyberjet.Api.Tests.Services.Auth;

public sealed class PasswordHasherTests
{
    [Fact]
    public void Verify_avec_le_bon_mot_de_passe_reussit()
    {
        var hashed = PasswordHasher.Hash("un-mot-de-passe-correct");

        Assert.True(PasswordHasher.Verify("un-mot-de-passe-correct", hashed.Salt, hashed.Hash));
    }

    [Fact]
    public void Verify_avec_un_mauvais_mot_de_passe_echoue()
    {
        var hashed = PasswordHasher.Hash("un-mot-de-passe-correct");

        Assert.False(PasswordHasher.Verify("un-autre-mot-de-passe", hashed.Salt, hashed.Hash));
    }

    [Fact]
    public void Deux_hachages_du_meme_mot_de_passe_different()
    {
        // Le sel est tiré au hasard à chaque appel : deux comptes avec le même
        // mot de passe ne doivent jamais porter la même empreinte, sinon une
        // table arc-en-ciel construite sur l'un profite à l'autre.
        var first = PasswordHasher.Hash("mot-de-passe-partage");
        var second = PasswordHasher.Hash("mot-de-passe-partage");

        Assert.NotEqual(first.Salt, second.Salt);
        Assert.NotEqual(first.Hash, second.Hash);
    }

    [Fact]
    public void Verify_avec_un_sel_ou_une_empreinte_illisible_echoue_sans_lever()
    {
        // Un compte migré ou corrompu ne doit jamais faire tomber l'API en 500
        // au moment de la connexion.
        Assert.False(PasswordHasher.Verify("peu importe", "pas-de-l-hexadecimal", "non-plus"));
    }
}
