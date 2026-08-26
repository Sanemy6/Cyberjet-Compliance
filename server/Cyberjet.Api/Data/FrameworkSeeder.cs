using Microsoft.EntityFrameworkCore;

namespace Cyberjet.Api.Data;

/// <summary>
/// Référentiels de conformité pré-chargés.
///
/// Chaque contrôle porte un intitulé français et, en description, son intitulé
/// officiel anglais : les deux sont indexés par le moteur, ce qui permet de
/// rapprocher aussi bien un questionnaire rédigé en français qu'en anglais.
///
/// Sources : EASA Part-IS (Règlement d'exécution (UE) 2023/203, Annexe II),
/// ISO/IEC 27001:2022 Annexe A, Directive NIS 2 (UE) 2022/2555 art. 20-23,
/// Règlement DORA (UE) 2022/2554, AICPA Trust Services Criteria 2017 (rév. 2022).
/// </summary>
public static class FrameworkSeeder
{
    /// <param name="Ref">Référence normative, telle que citée dans les questionnaires.</param>
    /// <param name="Title">Intitulé français.</param>
    /// <param name="Theme">Regroupement d'affichage.</param>
    /// <param name="EnglishTitle">Intitulé officiel anglais, indexé lui aussi.</param>
    public readonly record struct ControlSeed(string Ref, string Title, string Theme, string EnglishTitle);

    public sealed record FrameworkSeed(
        string Code, string Name, string Version, string Authority,
        string Description, string Accent, IReadOnlyList<ControlSeed> Controls);

    private static readonly ControlSeed[] PartIs =
    [
        new("IS.I.OR.100", "Champ d'application", "Généralités", "Scope"),
        new("IS.I.OR.200", "Système de gestion de la sécurité de l'information (SGSI)", "SGSI",
            "Information security management system (ISMS)"),
        new("IS.I.OR.205", "Appréciation des risques de sécurité de l'information", "Risques",
            "Information security risk assessment"),
        new("IS.I.OR.210", "Traitement des risques de sécurité de l'information", "Risques",
            "Information security risk treatment"),
        new("IS.I.OR.215", "Dispositif de signalement interne", "Signalement",
            "Information security internal reporting scheme"),
        new("IS.I.OR.220", "Incidents : détection, réponse et rétablissement", "Incidents",
            "Information security incidents - detection, response and recovery"),
        new("IS.I.OR.225", "Réponse aux constats notifiés par l'autorité compétente", "Autorité",
            "Response to findings notified by the competent authority"),
        new("IS.I.OR.230", "Dispositif de signalement externe", "Signalement",
            "Information security external reporting scheme"),
        new("IS.I.OR.235", "Sous-traitance des activités de gestion de la sécurité", "Tiers",
            "Contracting of information security management activities"),
        new("IS.I.OR.240", "Exigences relatives au personnel", "Personnel",
            "Personnel requirements"),
        new("IS.I.OR.245", "Conservation des enregistrements", "Documentation",
            "Record-keeping"),
        new("IS.I.OR.250", "Manuel de gestion de la sécurité de l'information (ISMM)",
            "Documentation", "Information security management manual"),
        new("IS.I.OR.255", "Modifications du système de gestion de la sécurité", "SGSI",
            "Changes to the information security management system"),
        new("IS.I.OR.260", "Amélioration continue", "SGSI", "Continuous improvement"),
    ];

    // Annexe A d'ISO/IEC 27001:2022, quatre thèmes. Format « FR|EN », la
    // référence A.<clause>.<rang> étant dérivée de la position dans la liste.
    private static readonly string[] IsoA5 =
    [
        "Politiques de sécurité de l'information|Policies for information security",
        "Fonctions et responsabilités liées à la sécurité de l'information|Information security roles and responsibilities",
        "Séparation des tâches|Segregation of duties",
        "Responsabilités de la direction|Management responsibilities",
        "Relations avec les autorités|Contact with authorities",
        "Relations avec des groupes d'intérêt particulier|Contact with special interest groups",
        "Renseignement sur les menaces|Threat intelligence",
        "Sécurité de l'information dans la gestion de projet|Information security in project management",
        "Inventaire des informations et autres actifs associés|Inventory of information and other associated assets",
        "Utilisation correcte des informations et autres actifs associés|Acceptable use of information and other associated assets",
        "Restitution des actifs|Return of assets",
        "Classification des informations|Classification of information",
        "Marquage des informations|Labelling of information",
        "Transfert des informations|Information transfer",
        "Contrôle d'accès|Access control",
        "Gestion des identités|Identity management",
        "Informations d'authentification|Authentication information",
        "Droits d'accès|Access rights",
        "Sécurité de l'information dans les relations avec les fournisseurs|Information security in supplier relationships",
        "Sécurité de l'information dans les accords conclus avec les fournisseurs|Addressing information security within supplier agreements",
        "Gestion de la sécurité de l'information dans la chaîne d'approvisionnement TIC|Managing information security in the ICT supply chain",
        "Surveillance, revue et gestion des changements des services fournisseurs|Monitoring, review and change management of supplier services",
        "Sécurité de l'information dans l'utilisation de services en nuage|Information security for use of cloud services",
        "Planification et préparation de la gestion des incidents|Information security incident management planning and preparation",
        "Appréciation des événements de sécurité de l'information et prise de décision|Assessment and decision on information security events",
        "Réponse aux incidents de sécurité de l'information|Response to information security incidents",
        "Tirer des enseignements des incidents de sécurité de l'information|Learning from information security incidents",
        "Recueil de preuves|Collection of evidence",
        "Sécurité de l'information durant une perturbation|Information security during disruption",
        "Préparation des TIC pour la continuité d'activité|ICT readiness for business continuity",
        "Exigences légales, statutaires, réglementaires et contractuelles|Legal, statutory, regulatory and contractual requirements",
        "Droits de propriété intellectuelle|Intellectual property rights",
        "Protection des enregistrements|Protection of records",
        "Protection de la vie privée et des DCP|Privacy and protection of PII",
        "Revue indépendante de la sécurité de l'information|Independent review of information security",
        "Conformité aux politiques, règles et normes de sécurité|Compliance with policies, rules and standards for information security",
        "Procédures d'exploitation documentées|Documented operating procedures",
    ];

    private static readonly string[] IsoA6 =
    [
        "Sélection des candidats|Screening",
        "Conditions générales d'embauche|Terms and conditions of employment",
        "Sensibilisation, apprentissage et formation à la sécurité de l'information|Information security awareness, education and training",
        "Processus disciplinaire|Disciplinary process",
        "Responsabilités après la fin ou le changement d'un contrat de travail|Responsibilities after termination or change of employment",
        "Accords de confidentialité ou de non-divulgation|Confidentiality or non-disclosure agreements",
        "Travail à distance|Remote working",
        "Déclaration des événements de sécurité de l'information|Information security event reporting",
    ];

    private static readonly string[] IsoA7 =
    [
        "Périmètres de sécurité physique|Physical security perimeters",
        "Contrôle d'accès physique|Physical entry",
        "Sécurisation des bureaux, des salles et des équipements|Securing offices, rooms and facilities",
        "Surveillance de la sécurité physique|Physical security monitoring",
        "Protection contre les menaces physiques et environnementales|Protecting against physical and environmental threats",
        "Travail dans les zones sécurisées|Working in secure areas",
        "Bureau propre et écran vide|Clear desk and clear screen",
        "Emplacement et protection du matériel|Equipment siting and protection",
        "Sécurité des actifs hors des locaux|Security of assets off-premises",
        "Supports de stockage|Storage media",
        "Services généraux|Supporting utilities",
        "Sécurité du câblage|Cabling security",
        "Maintenance du matériel|Equipment maintenance",
        "Mise au rebut ou recyclage sécurisés du matériel|Secure disposal or re-use of equipment",
    ];

    private static readonly string[] IsoA8 =
    [
        "Terminaux finaux des utilisateurs|User endpoint devices",
        "Privilèges d'accès|Privileged access rights",
        "Restriction d'accès à l'information|Information access restriction",
        "Accès au code source|Access to source code",
        "Authentification sécurisée|Secure authentication",
        "Dimensionnement|Capacity management",
        "Protection contre les programmes malveillants|Protection against malware",
        "Gestion des vulnérabilités techniques|Management of technical vulnerabilities",
        "Gestion des configurations|Configuration management",
        "Suppression d'informations|Information deletion",
        "Masquage des données|Data masking",
        "Prévention de la fuite de données|Data leakage prevention",
        "Sauvegarde des informations|Information backup",
        "Redondance des moyens de traitement de l'information|Redundancy of information processing facilities",
        "Journalisation|Logging",
        "Activités de surveillance|Monitoring activities",
        "Synchronisation des horloges|Clock synchronization",
        "Utilisation de programmes utilitaires à privilèges|Use of privileged utility programs",
        "Installation de logiciels sur des systèmes en exploitation|Installation of software on operational systems",
        "Sécurité des réseaux|Networks security",
        "Sécurité des services réseau|Security of network services",
        "Cloisonnement des réseaux|Segregation of networks",
        "Filtrage web|Web filtering",
        "Utilisation de la cryptographie|Use of cryptography",
        "Cycle de vie de développement sécurisé|Secure development life cycle",
        "Exigences de sécurité des applications|Application security requirements",
        "Principes d'ingénierie et d'architecture sécurisée des systèmes|Secure system architecture and engineering principles",
        "Codage sécurisé|Secure coding",
        "Tests de sécurité dans le développement et l'acceptation|Security testing in development and acceptance",
        "Développement externalisé|Outsourced development",
        "Séparation des environnements de développement, de test et de production|Separation of development, test and production environments",
        "Gestion des changements|Change management",
        "Informations de test|Test information",
        "Protection des systèmes d'information pendant les tests d'audit|Protection of information systems during audit testing",
    ];

    private static List<ControlSeed> IsoControls()
    {
        var blocks = new (string Clause, string Theme, string[] Items)[]
        {
            ("5", "Mesures organisationnelles", IsoA5),
            ("6", "Mesures liées aux personnes", IsoA6),
            ("7", "Mesures physiques", IsoA7),
            ("8", "Mesures technologiques", IsoA8),
        };

        var output = new List<ControlSeed>();
        foreach (var (clause, theme, items) in blocks)
        {
            for (var i = 0; i < items.Length; i++)
            {
                var parts = items[i].Split('|', 2);
                output.Add(new ControlSeed($"A.{clause}.{i + 1}", parts[0], theme, parts[1]));
            }
        }
        return output;
    }

    private static readonly ControlSeed[] Nis2 =
    [
        new("Art.20", "Gouvernance : responsabilité et formation des organes de direction",
            "Gouvernance", "Governance - management bodies approval and training"),
        new("Art.21.1", "Mesures de gestion des risques adaptées et proportionnées",
            "Gouvernance", "Appropriate and proportionate risk-management measures"),
        new("Art.21.2a", "Politiques d'analyse des risques et de sécurité des SI", "Risques",
            "Policies on risk analysis and information system security"),
        new("Art.21.2b", "Gestion des incidents", "Incidents", "Incident handling"),
        new("Art.21.2c", "Continuité d'activité, sauvegardes, reprise et gestion de crise",
            "Continuité", "Business continuity, backup management, disaster recovery, crisis management"),
        new("Art.21.2d", "Sécurité de la chaîne d'approvisionnement", "Tiers",
            "Supply chain security"),
        new("Art.21.2e", "Sécurité de l'acquisition, du développement et de la maintenance des SI",
            "Développement",
            "Security in network and information systems acquisition, development and maintenance"),
        new("Art.21.2f", "Évaluation de l'efficacité des mesures de gestion des risques",
            "Gouvernance", "Policies to assess the effectiveness of cybersecurity risk-management measures"),
        new("Art.21.2g", "Hygiène cyber de base et formation à la cybersécurité", "Personnel",
            "Basic cyber hygiene practices and cybersecurity training"),
        new("Art.21.2h", "Politiques et procédures relatives à la cryptographie et au chiffrement",
            "Cryptographie", "Policies and procedures regarding the use of cryptography and encryption"),
        new("Art.21.2i", "Sécurité RH, politiques de contrôle d'accès et gestion des actifs",
            "Accès", "Human resources security, access control policies and asset management"),
        new("Art.21.2j", "Authentification multifacteur et communications sécurisées", "Accès",
            "Multi-factor authentication, secured voice/video/text and emergency communications"),
        new("Art.23", "Obligations de notification des incidents importants", "Signalement",
            "Reporting obligations for significant incidents"),
    ];

    private static readonly ControlSeed[] Dora =
    [
        new("Art.5", "Gouvernance et organisation du risque TIC", "Gouvernance",
            "Governance and organisation"),
        new("Art.6", "Cadre de gestion du risque lié aux TIC", "Risques",
            "ICT risk management framework"),
        new("Art.8", "Identification des fonctions, actifs et dépendances TIC", "Risques",
            "Identification"),
        new("Art.9", "Protection et prévention", "Protection", "Protection and prevention"),
        new("Art.10", "Détection des activités anormales", "Détection", "Detection"),
        new("Art.11", "Réponse et rétablissement", "Continuité", "Response and recovery"),
        new("Art.12", "Politiques de sauvegarde, restauration et rétablissement", "Continuité",
            "Backup policies and procedures, restoration and recovery"),
        new("Art.13", "Apprentissage et évolution", "Gouvernance", "Learning and evolving"),
        new("Art.14", "Communication de crise", "Communication", "Communication"),
        new("Art.17", "Processus de gestion des incidents liés aux TIC", "Incidents",
            "ICT-related incident management process"),
        new("Art.19", "Notification des incidents majeurs liés aux TIC", "Signalement",
            "Reporting of major ICT-related incidents"),
        new("Art.24", "Programme de tests de résilience opérationnelle numérique", "Tests",
            "Digital operational resilience testing"),
        new("Art.26", "Tests avancés fondés sur des menaces (TLPT)", "Tests",
            "Advanced testing based on TLPT"),
        new("Art.28", "Principes généraux de gestion du risque lié aux tiers TIC", "Tiers",
            "General principles - ICT third-party risk"),
        new("Art.30", "Dispositions contractuelles clés avec les prestataires TIC", "Tiers",
            "Key contractual provisions"),
    ];

    private static readonly ControlSeed[] Soc2 =
    [
        new("CC1.1", "Intégrité et valeurs éthiques", "Environnement de contrôle",
            "Commitment to integrity and ethical values"),
        new("CC1.2", "Indépendance et supervision du conseil", "Environnement de contrôle",
            "Board independence and oversight"),
        new("CC1.3", "Structures, lignes hiérarchiques et responsabilités", "Environnement de contrôle",
            "Structures, reporting lines, authorities and responsibilities"),
        new("CC1.4", "Compétence des personnes", "Environnement de contrôle",
            "Commitment to competence"),
        new("CC1.5", "Responsabilisation individuelle", "Environnement de contrôle",
            "Individual accountability"),
        new("CC2.1", "Information pertinente et de qualité", "Information et communication",
            "Relevant, quality information"),
        new("CC2.2", "Communication interne", "Information et communication",
            "Internal communication"),
        new("CC2.3", "Communication externe", "Information et communication",
            "External communication"),
        new("CC3.1", "Objectifs et identification des risques", "Appréciation des risques",
            "Objectives and risk identification"),
        new("CC3.2", "Analyse des risques", "Appréciation des risques", "Risk analysis"),
        new("CC3.3", "Prise en compte du risque de fraude", "Appréciation des risques",
            "Fraud risk consideration"),
        new("CC3.4", "Identification des changements significatifs", "Appréciation des risques",
            "Identification of significant change"),
        new("CC4.1", "Évaluations continues et ponctuelles", "Surveillance",
            "Ongoing and separate evaluations"),
        new("CC4.2", "Communication des déficiences", "Surveillance",
            "Evaluation and communication of deficiencies"),
        new("CC5.1", "Sélection et développement des activités de contrôle", "Activités de contrôle",
            "Selection and development of control activities"),
        new("CC5.2", "Contrôles généraux sur la technologie", "Activités de contrôle",
            "General controls over technology"),
        new("CC5.3", "Déploiement via politiques et procédures", "Activités de contrôle",
            "Deployment through policies and procedures"),
        new("CC6.1", "Sécurité logique : contrôles d'accès aux actifs", "Accès logique et physique",
            "Logical access security software and infrastructure"),
        new("CC6.2", "Enregistrement et autorisation des utilisateurs", "Accès logique et physique",
            "User registration and authorization"),
        new("CC6.3", "Gestion des droits d'accès sur le cycle de vie", "Accès logique et physique",
            "Access rights over the identity lifecycle"),
        new("CC6.4", "Accès physique aux installations", "Accès logique et physique",
            "Physical access to facilities"),
        new("CC6.5", "Mise au rebut sécurisée des actifs", "Accès logique et physique",
            "Disposal of physical assets"),
        new("CC6.6", "Protection contre les menaces externes", "Accès logique et physique",
            "Protection against threats from outside system boundaries"),
        new("CC6.7", "Transmission, déplacement et suppression sécurisés de l'information",
            "Accès logique et physique", "Restricted transmission, movement and removal of information"),
        new("CC6.8", "Prévention et détection des logiciels non autorisés",
            "Accès logique et physique", "Prevention and detection of unauthorized software"),
        new("CC7.1", "Détection des changements de configuration", "Exploitation",
            "Detection of configuration changes"),
        new("CC7.2", "Surveillance des anomalies", "Exploitation", "Monitoring for anomalies"),
        new("CC7.3", "Évaluation des événements de sécurité", "Exploitation",
            "Evaluation of security events"),
        new("CC7.4", "Réponse aux incidents de sécurité", "Exploitation",
            "Response to identified security incidents"),
        new("CC7.5", "Rétablissement après incident", "Exploitation",
            "Recovery from identified security incidents"),
        new("CC8.1", "Gestion des changements", "Gestion des changements", "Change management"),
        new("CC9.1", "Atténuation des risques d'interruption d'activité", "Atténuation",
            "Business disruption risk mitigation"),
        new("CC9.2", "Gestion du risque fournisseurs et partenaires", "Atténuation",
            "Vendor and business partner risk management"),
        new("A1.1", "Capacité et dimensionnement", "Disponibilité", "Capacity management"),
        new("A1.2", "Sauvegardes, reprise et infrastructure de secours", "Disponibilité",
            "Backup, recovery and environmental protections"),
        new("A1.3", "Tests des plans de reprise", "Disponibilité", "Recovery plan testing"),
        new("C1.1", "Identification et protection des informations confidentielles",
            "Confidentialité", "Identification and protection of confidential information"),
        new("C1.2", "Suppression des informations confidentielles", "Confidentialité",
            "Disposal of confidential information"),
    ];

    public static IReadOnlyList<FrameworkSeed> All { get; } =
    [
        new("PART-IS", "EASA Part-IS", "Règl. (UE) 2023/203 — Annexe II (IS.I.OR)", "AESA / EASA",
            "Exigences de gestion de la sécurité de l'information pour les organismes de "
            + "l'aviation civile. Le Règlement délégué (UE) 2022/1645 reprend la même "
            + "structure sous la référence IS.D.OR.",
            "sky", PartIs),

        new("ISO27001", "ISO/IEC 27001 — Annexe A", "2022", "ISO/IEC",
            "93 mesures de sécurité réparties en 4 thèmes : organisationnel, personnes, "
            + "physique, technologique.",
            "indigo", IsoControls()),

        new("NIS2", "Directive NIS 2", "Directive (UE) 2022/2555", "Union européenne",
            "Mesures de gestion des risques de cybersécurité et obligations de notification "
            + "pour les entités essentielles et importantes.",
            "emerald", Nis2),

        new("DORA", "DORA", "Règlement (UE) 2022/2554", "Union européenne",
            "Résilience opérationnelle numérique du secteur financier : risque TIC, "
            + "incidents, tests, prestataires tiers.",
            "amber", Dora),

        new("SOC2", "SOC 2 — Trust Services Criteria", "TSC 2017 (rév. 2022)", "AICPA",
            "Critères Sécurité (CC), Disponibilité (A) et Confidentialité (C) utilisés "
            + "dans les questionnaires fournisseurs anglo-saxons.",
            "rose", Soc2),
    ];

    /// <summary>
    /// Insère les référentiels absents et rafraîchit les libellés des existants.
    /// Idempotent : les rattachements aux réponses de la base ne sont jamais touchés.
    /// </summary>
    public static async Task SeedAsync(AppDbContext db, CancellationToken ct = default)
    {
        var existingFrameworks = await db.Frameworks.ToDictionaryAsync(f => f.Code, ct);

        for (var order = 0; order < All.Count; order++)
        {
            var seed = All[order];
            if (!existingFrameworks.TryGetValue(seed.Code, out var framework))
            {
                framework = new Framework { Code = seed.Code };
                db.Frameworks.Add(framework);
            }
            framework.Name = seed.Name;
            framework.Version = seed.Version;
            framework.Authority = seed.Authority;
            framework.Description = seed.Description;
            framework.Accent = seed.Accent;
            framework.SortOrder = order;
        }

        // Les contrôles référencent l'identifiant du référentiel : il faut donc
        // que les référentiels neufs aient reçu le leur avant d'y toucher.
        await db.SaveChangesAsync(ct);

        var frameworksByCode = await db.Frameworks.ToDictionaryAsync(f => f.Code, ct);
        var frameworkIds = frameworksByCode.Values.Select(f => f.Id).ToList();
        var existingControls = await db.Controls
            .Where(c => frameworkIds.Contains(c.FrameworkId))
            .ToDictionaryAsync(c => (c.FrameworkId, c.Ref), ct);

        foreach (var seed in All)
        {
            var framework = frameworksByCode[seed.Code];
            for (var i = 0; i < seed.Controls.Count; i++)
            {
                var controlSeed = seed.Controls[i];
                if (!existingControls.TryGetValue((framework.Id, controlSeed.Ref), out var control))
                {
                    control = new Control { FrameworkId = framework.Id, Ref = controlSeed.Ref };
                    db.Controls.Add(control);
                }
                control.Title = controlSeed.Title;
                control.Theme = controlSeed.Theme;
                control.Description = controlSeed.EnglishTitle;
                control.SortOrder = i;
            }
        }

        await db.SaveChangesAsync(ct);
    }
}
