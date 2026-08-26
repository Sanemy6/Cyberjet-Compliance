namespace Cyberjet.Api.Middleware;

/// <summary>Section « Security » de la configuration.</summary>
public sealed class SecurityOptions
{
    public const string SectionName = "Security";

    /// <summary>À true derrière un reverse proxy TLS ; laissé à false par défaut
    /// pour ne pas casser une installation sur réseau interne servie en HTTP
    /// simple, où un cookie Secure serait ignoré par le navigateur.</summary>
    public bool RequireSecureCookies { get; set; }

    /// <summary>
    /// Délai d'inactivité au bout duquel une session est fermée, en minutes.
    /// Zéro ou négatif désactive le mécanisme — la session ne tient alors qu'à
    /// son échéance absolue.
    ///
    /// Distinct de cette échéance absolue : celle-ci borne la durée totale d'une
    /// session, celui-là ferme un poste laissé sans surveillance. Les deux sont
    /// attendus par les référentiels usuels (ISO/IEC 27001:2022 A.8.1, guides
    /// ANSSI sur les postes de travail).
    /// </summary>
    public int SessionIdleTimeoutMinutes { get; set; } = 30;
}
