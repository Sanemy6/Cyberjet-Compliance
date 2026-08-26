using Cyberjet.Api.Services.Auth;

namespace Cyberjet.Api.Tests.Services.Auth;

public sealed class LoginThrottleTests
{
    [Fact]
    public void Un_compte_neuf_n_est_pas_verrouille()
    {
        var throttle = new LoginThrottle();

        Assert.False(throttle.IsLockedOut("alice", "10.0.0.1"));
    }

    [Fact]
    public void Se_verrouille_au_seuil_de_tentatives()
    {
        var throttle = new LoginThrottle();

        for (var i = 0; i < LoginThrottle.Threshold - 1; i++)
            throttle.RegisterFailure("alice", "10.0.0.1");
        Assert.False(throttle.IsLockedOut("alice", "10.0.0.1"));

        throttle.RegisterFailure("alice", "10.0.0.1");
        Assert.True(throttle.IsLockedOut("alice", "10.0.0.1"));
    }

    [Fact]
    public void ClearFailures_leve_le_verrou()
    {
        var throttle = new LoginThrottle();
        for (var i = 0; i < LoginThrottle.Threshold; i++)
            throttle.RegisterFailure("alice", "10.0.0.1");
        Assert.True(throttle.IsLockedOut("alice", "10.0.0.1"));

        throttle.ClearFailures("alice", "10.0.0.1");

        Assert.False(throttle.IsLockedOut("alice", "10.0.0.1"));
    }

    [Fact]
    public void Le_verrou_est_isole_par_couple_identifiant_adresse_ip()
    {
        // Sur un réseau partagé, verrouiller par identifiant seul permettrait à
        // n'importe qui d'empêcher un collègue de se connecter en échouant
        // délibérément à sa place depuis un autre poste.
        var throttle = new LoginThrottle();
        for (var i = 0; i < LoginThrottle.Threshold; i++)
            throttle.RegisterFailure("alice", "10.0.0.1");

        Assert.True(throttle.IsLockedOut("alice", "10.0.0.1"));
        Assert.False(throttle.IsLockedOut("alice", "10.0.0.2"));
    }

    [Fact]
    public void Le_verrou_est_isole_par_identifiant_a_ip_egale()
    {
        var throttle = new LoginThrottle();
        for (var i = 0; i < LoginThrottle.Threshold; i++)
            throttle.RegisterFailure("alice", "10.0.0.1");

        Assert.True(throttle.IsLockedOut("alice", "10.0.0.1"));
        Assert.False(throttle.IsLockedOut("bob", "10.0.0.1"));
    }

    [Fact]
    public void L_identifiant_est_insensible_a_la_casse_et_aux_espaces()
    {
        var throttle = new LoginThrottle();
        for (var i = 0; i < LoginThrottle.Threshold; i++)
            throttle.RegisterFailure("Alice", "10.0.0.1");

        Assert.True(throttle.IsLockedOut("  alice  ", "10.0.0.1"));
    }

    [Fact]
    public void RetryAfter_est_nul_tant_que_le_seuil_n_est_pas_atteint()
    {
        var throttle = new LoginThrottle();

        Assert.Null(throttle.RetryAfter("alice", "10.0.0.1"));

        for (var i = 0; i < LoginThrottle.Threshold - 1; i++)
            throttle.RegisterFailure("alice", "10.0.0.1");

        Assert.Null(throttle.RetryAfter("alice", "10.0.0.1"));
    }

    [Fact]
    public void RetryAfter_annonce_un_delai_dans_la_fenetre()
    {
        var throttle = new LoginThrottle();
        for (var i = 0; i < LoginThrottle.Threshold; i++)
            throttle.RegisterFailure("alice", "10.0.0.1");

        var wait = throttle.RetryAfter("alice", "10.0.0.1");

        Assert.NotNull(wait);
        Assert.InRange(wait!.Value, TimeSpan.Zero, LoginThrottle.Window);
    }

    [Fact]
    public void RetryAfter_compte_depuis_la_plus_ancienne_tentative_retenue()
    {
        // Le déblocage suit la tentative qui, en expirant, ramène le décompte
        // sous le seuil — pas la dernière. Cinq échecs à la suite libèrent donc
        // au bout de quinze minutes à partir du premier, et non du cinquième.
        var throttle = new LoginThrottle();
        for (var i = 0; i < LoginThrottle.Threshold * 2; i++)
            throttle.RegisterFailure("alice", "10.0.0.1");

        var wait = throttle.RetryAfter("alice", "10.0.0.1");

        // Dix tentatives quasi simultanées : c'est la sixième qui libère, elle
        // vient d'avoir lieu, donc l'attente reste proche de la fenêtre pleine.
        Assert.NotNull(wait);
        Assert.InRange(wait!.Value,
                       LoginThrottle.Window - TimeSpan.FromSeconds(5),
                       LoginThrottle.Window);
    }

    [Fact]
    public void ClearFailures_annule_aussi_le_delai_annonce()
    {
        var throttle = new LoginThrottle();
        for (var i = 0; i < LoginThrottle.Threshold; i++)
            throttle.RegisterFailure("alice", "10.0.0.1");
        Assert.NotNull(throttle.RetryAfter("alice", "10.0.0.1"));

        throttle.ClearFailures("alice", "10.0.0.1");

        Assert.Null(throttle.RetryAfter("alice", "10.0.0.1"));
    }

    // ----------------------------------------------------------------------
    // Vue et déblocage d'administration : le verrou porte sur un couple
    // (identifiant, adresse), mais un administrateur raisonne par compte.
    // ----------------------------------------------------------------------

    [Fact]
    public void RetryAfterAnywhere_voit_un_blocage_venu_de_n_importe_quelle_adresse()
    {
        var throttle = new LoginThrottle();
        for (var i = 0; i < LoginThrottle.Threshold; i++)
            throttle.RegisterFailure("alice", "10.0.0.7");

        // L'administrateur ne connaît pas l'adresse d'où venaient les échecs.
        Assert.NotNull(throttle.RetryAfterAnywhere("alice"));
        Assert.Null(throttle.RetryAfterAnywhere("bob"));
    }

    [Fact]
    public void RetryAfterAnywhere_ignore_les_adresses_sous_le_seuil()
    {
        var throttle = new LoginThrottle();
        for (var i = 0; i < LoginThrottle.Threshold - 1; i++)
            throttle.RegisterFailure("alice", "10.0.0.1");
        for (var i = 0; i < LoginThrottle.Threshold - 1; i++)
            throttle.RegisterFailure("alice", "10.0.0.2");

        // Deux postes à quatre échecs ne font pas un compte bloqué : le seuil
        // s'apprécie par adresse, additionner les deux verrouillerait à tort.
        Assert.Null(throttle.RetryAfterAnywhere("alice"));
    }

    [Fact]
    public void ClearAll_libere_toutes_les_adresses_du_compte()
    {
        var throttle = new LoginThrottle();
        foreach (var ip in new[] { "10.0.0.1", "10.0.0.2" })
            for (var i = 0; i < LoginThrottle.Threshold; i++)
                throttle.RegisterFailure("alice", ip);

        var cleared = throttle.ClearAll("alice");

        Assert.Equal(2, cleared);
        Assert.Null(throttle.RetryAfterAnywhere("alice"));
        Assert.False(throttle.IsLockedOut("alice", "10.0.0.1"));
        Assert.False(throttle.IsLockedOut("alice", "10.0.0.2"));
    }

    [Fact]
    public void ClearAll_ne_touche_pas_aux_autres_comptes()
    {
        var throttle = new LoginThrottle();
        for (var i = 0; i < LoginThrottle.Threshold; i++)
        {
            throttle.RegisterFailure("alice", "10.0.0.1");
            throttle.RegisterFailure("bob", "10.0.0.1");
        }

        throttle.ClearAll("alice");

        Assert.Null(throttle.RetryAfterAnywhere("alice"));
        Assert.NotNull(throttle.RetryAfterAnywhere("bob"));
    }

    [Fact]
    public void ClearAll_sur_un_compte_libre_ne_libere_rien()
    {
        var throttle = new LoginThrottle();

        // Zéro distingue « rien à faire » d'un déblocage réel : l'appelant s'en
        // sert pour ne pas journaliser une action sans effet.
        Assert.Equal(0, throttle.ClearAll("alice"));
    }
}
