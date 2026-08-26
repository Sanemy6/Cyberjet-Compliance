namespace Cyberjet.Api.Services.Search;

/// <summary>
/// Thésaurus métier GRC / cybersécurité, bilingue FR-EN.
///
/// C'est la pièce qui remplace un modèle d'embeddings : plutôt que d'apprendre
/// la proximité sémantique, on la déclare. Dans un domaine aussi normé que la
/// conformité cyber, un thésaurus curé bat largement un modèle générique — et il
/// tourne hors ligne, instantanément, sans dépendance ni GPU.
///
/// Deux mécanismes :
///   * <see cref="Phrases"/>       — expressions multi-mots repliées en un jeton
///                                   unique (« au repos » → « atrest ») AVANT la
///                                   tokenisation ;
///   * <see cref="SynonymGroups"/> — familles de termes repliées sur un jeton
///                                   canonique (« cryptage », « encryption » →
///                                   « chiffrement »).
///
/// Ce fichier ne contient que des données, aucune logique : la compilation en
/// expressions régulières est faite dans <see cref="TextProcessor"/>. C'est le
/// levier le plus rentable pour améliorer le moteur — quand une question n'est
/// pas reconnue alors que la réponse existe, c'est presque toujours qu'un terme
/// du client manque ici.
/// </summary>
public static class Thesaurus
{
    /// <summary>
    /// Expressions multi-mots, appliquées sur le texte normalisé sans accents.
    /// L'ordre d'application est géré par <see cref="TextProcessor"/> : les
    /// expressions les plus longues d'abord, pour qu'une expression courte
    /// n'ampute pas une expression longue qui la contient.
    /// </summary>
    public static readonly IReadOnlyDictionary<string, string> Phrases = new Dictionary<string, string>
    {
        // Chiffrement
        ["au repos"] = "atrest",
        ["at rest"] = "atrest",
        ["en repos"] = "atrest",
        ["donnees stockees"] = "atrest",
        ["data at rest"] = "atrest",
        ["en transit"] = "intransit",
        ["in transit"] = "intransit",
        ["in flight"] = "intransit",
        ["en vol"] = "intransit",
        ["flux reseau"] = "intransit",
        ["bout en bout"] = "e2ee",
        ["end to end"] = "e2ee",
        ["gestion des cles"] = "keymanagement",
        ["key management"] = "keymanagement",
        ["coffre fort"] = "vault",
        ["hardware security module"] = "hsm",

        // Identité / accès
        ["authentification multifacteur"] = "mfa",
        ["authentification multi facteur"] = "mfa",
        ["authentification a deux facteurs"] = "mfa",
        ["authentification forte"] = "mfa",
        ["double authentification"] = "mfa",
        ["multi factor authentication"] = "mfa",
        ["two factor authentication"] = "mfa",
        ["second facteur"] = "mfa",
        ["moindre privilege"] = "leastprivilege",
        ["least privilege"] = "leastprivilege",
        ["besoin d en connaitre"] = "leastprivilege",
        ["need to know"] = "leastprivilege",
        ["comptes a privileges"] = "privaccess",
        ["comptes privilegies"] = "privaccess",
        ["acces privilegie"] = "privaccess",
        ["privileged access"] = "privaccess",
        ["privileged account"] = "privaccess",
        ["controle d acces"] = "accesscontrol",
        ["access control"] = "accesscontrol",
        ["gestion des identites"] = "iam",
        ["identity management"] = "iam",
        ["identity and access management"] = "iam",
        ["revue des acces"] = "accessreview",
        ["access review"] = "accessreview",
        ["recertification des acces"] = "accessreview",
        ["authentification unique"] = "sso",
        ["single sign on"] = "sso",
        ["zero trust"] = "zerotrust",
        ["arrivee depart mutation"] = "jml",
        ["joiner mover leaver"] = "jml",

        // Journalisation / détection
        ["journalisation"] = "logging",
        ["journaux d evenements"] = "logging",
        ["piste d audit"] = "auditlog",
        ["audit trail"] = "auditlog",
        ["security information and event management"] = "siem",
        ["centre operationnel de securite"] = "soc",
        ["security operations center"] = "soc",
        ["detection d intrusion"] = "ids",
        ["intrusion detection"] = "ids",
        ["endpoint detection and response"] = "edr",
        ["detection et reponse"] = "edr",

        // Incident / continuité
        ["gestion des incidents"] = "incident",
        ["incident management"] = "incident",
        ["incident response"] = "incident",
        ["reponse a incident"] = "incident",
        ["violation de donnees"] = "databreach",
        ["data breach"] = "databreach",
        ["fuite de donnees"] = "databreach",
        ["plan de continuite"] = "bcp",
        ["continuite d activite"] = "bcp",
        ["business continuity"] = "bcp",
        ["plan de reprise"] = "drp",
        ["reprise apres sinistre"] = "drp",
        ["disaster recovery"] = "drp",
        ["recovery time objective"] = "rto",
        ["recovery point objective"] = "rpo",
        ["retour arriere"] = "rollback",

        // Risque / gouvernance
        ["analyse de risque"] = "riskassessment",
        ["appreciation des risques"] = "riskassessment",
        ["evaluation des risques"] = "riskassessment",
        ["risk assessment"] = "riskassessment",
        ["traitement du risque"] = "risktreatment",
        ["risk treatment"] = "risktreatment",
        ["risque residuel"] = "residualrisk",
        ["residual risk"] = "residualrisk",
        ["systeme de management"] = "isms",
        ["management system"] = "isms",
        ["information security management system"] = "isms",
        ["politique de securite"] = "secpolicy",
        ["security policy"] = "secpolicy",
        ["declaration d applicabilite"] = "soa",
        ["statement of applicability"] = "soa",
        ["amelioration continue"] = "continuousimprovement",
        ["continuous improvement"] = "continuousimprovement",
        ["revue de direction"] = "mgmtreview",
        ["management review"] = "mgmtreview",

        // Tiers / chaîne d'approvisionnement
        ["chaine d approvisionnement"] = "supplychain",
        ["supply chain"] = "supplychain",
        ["gestion des tiers"] = "thirdparty",
        ["third party"] = "thirdparty",
        ["sous traitant"] = "thirdparty",
        ["sous traitance"] = "thirdparty",
        ["prestataire externe"] = "thirdparty",
        ["fournisseur critique"] = "thirdparty",
        ["accord de niveau de service"] = "sla",
        ["service level agreement"] = "sla",
        ["accord de confidentialite"] = "nda",
        ["non disclosure agreement"] = "nda",

        // Vulnérabilités / tests
        ["gestion des vulnerabilites"] = "vulnmgmt",
        ["vulnerability management"] = "vulnmgmt",
        ["test d intrusion"] = "pentest",
        ["tests d intrusion"] = "pentest",
        ["penetration test"] = "pentest",
        ["penetration testing"] = "pentest",
        ["scan de vulnerabilite"] = "vulnscan",
        ["vulnerability scan"] = "vulnscan",
        ["gestion des correctifs"] = "patching",
        ["patch management"] = "patching",
        ["mise a jour de securite"] = "patching",
        ["mises a jour"] = "patching",
        ["mise a jour"] = "patching",
        ["bug bounty"] = "bugbounty",

        // Données / conformité
        ["donnees personnelles"] = "pii",
        ["donnees a caractere personnel"] = "pii",
        ["personal data"] = "pii",
        ["personally identifiable information"] = "pii",
        ["classification des donnees"] = "dataclass",
        ["data classification"] = "dataclass",
        ["duree de conservation"] = "retention",
        ["data retention"] = "retention",
        ["suppression des donnees"] = "datadeletion",
        ["effacement securise"] = "datadeletion",
        ["localisation des donnees"] = "datalocation",
        ["data residency"] = "datalocation",
        ["transfert hors ue"] = "datatransfer",
        ["prevention des fuites"] = "dlp",
        ["data loss prevention"] = "dlp",

        // Réseau / infrastructure
        ["segmentation reseau"] = "netsegmentation",
        ["network segmentation"] = "netsegmentation",
        ["cloisonnement reseau"] = "netsegmentation",
        ["pare feu"] = "firewall",
        ["reseau prive virtuel"] = "vpn",
        ["acces distant"] = "remoteaccess",
        ["remote access"] = "remoteaccess",
        ["teletravail"] = "remotework",
        ["remote working"] = "remotework",
        ["poste de travail"] = "endpoint",
        ["terminal utilisateur"] = "endpoint",
        ["end user device"] = "endpoint",
        ["informatique en nuage"] = "cloud",
        ["cloud computing"] = "cloud",
        ["infrastructure as a service"] = "cloud",

        // Développement
        ["cycle de developpement"] = "sdlc",
        ["development lifecycle"] = "sdlc",
        ["developpement securise"] = "securedev",
        ["secure development"] = "securedev",
        ["secure coding"] = "securedev",
        ["revue de code"] = "codereview",
        ["code review"] = "codereview",
        ["gestion des changements"] = "changemgmt",
        ["change management"] = "changemgmt",
        ["gestion des configurations"] = "configmgmt",
        ["configuration management"] = "configmgmt",
        ["environnement de production"] = "prodenv",
        ["environnement de test"] = "testenv",

        // RH / sensibilisation
        ["sensibilisation a la securite"] = "awareness",
        ["security awareness"] = "awareness",
        ["formation securite"] = "awareness",
        ["verification des antecedents"] = "screening",
        ["background check"] = "screening",
        ["controle d integrite du personnel"] = "screening",

        // Physique
        ["securite physique"] = "physec",
        ["physical security"] = "physec",
        ["controle d acces physique"] = "physec",
        ["centre de donnees"] = "datacenter",
        ["data center"] = "datacenter",
        ["salle serveur"] = "datacenter",

        // Aviation / Part-IS
        ["part is"] = "partis",
        ["part-is"] = "partis",
        ["navigabilite"] = "airworthiness",
        ["autorite competente"] = "authority",
        ["competent authority"] = "authority",
        ["systeme d information"] = "informationsystem",
        ["information system"] = "informationsystem",
        ["notification a l autorite"] = "extreporting",
        ["external reporting"] = "extreporting",
        ["signalement interne"] = "intreporting",
        ["internal reporting"] = "intreporting",

        // Sauvegardes
        ["sauvegarde des donnees"] = "backup",
        ["copie de sauvegarde"] = "backup",
        ["test de restauration"] = "restoretest",
        ["restore test"] = "restoretest",

        // Audit / certification
        ["audit interne"] = "internalaudit",
        ["internal audit"] = "internalaudit",
        ["audit externe"] = "externalaudit",
        ["rapport d audit"] = "auditreport",
        ["plan d action"] = "actionplan",
        ["non conformite"] = "nonconformity",
        ["action corrective"] = "corrective",
    };

    /// <summary>
    /// Familles de synonymes. Le premier terme de chaque famille est la forme
    /// canonique sur laquelle tous les autres se replient.
    /// </summary>
    public static readonly string[][] SynonymGroups =
    [
        ["chiffrement", "chiffre", "chiffrer", "chiffrees", "cryptage", "crypte", "crypter",
         "encryption", "encrypt", "encrypted", "encrypting", "cipher", "cryptographie",
         "cryptographic", "cryptography", "cryptographique"],
        ["algorithme", "algorithm", "suite", "ciphersuite", "protocole"],
        ["aes", "aes256", "aes128"],
        ["tls", "ssl", "https", "mtls", "starttls"],
        ["atrest", "stockage", "storage", "stocke", "stockees", "disque", "volume"],
        ["intransit", "transport", "transit", "communications", "flux"],
        ["mfa", "2fa", "multifacteur", "multifactor", "otp", "totp", "fido", "webauthn"],
        ["motdepasse", "mot", "passe", "password", "passphrase", "credentials", "identifiants"],
        ["accesscontrol", "acces", "access", "accede", "acceder", "habilitation",
         "habilitations", "autorisation", "autorisations", "permission", "permissions",
         "droit", "droits", "rights", "rbac"],
        // « data » et « information » désignent la même chose dans ce domaine :
        // les unifier permet à un questionnaire anglais de trouver une réponse
        // française.
        ["data", "donnee", "donnees", "datas", "information", "informations", "info"],
        ["iam", "identite", "identites", "identity", "identities", "annuaire", "directory",
         "ldap", "activedirectory"],
        ["privaccess", "administrateur", "administrateurs", "admin", "admins", "pam", "root",
         "superutilisateur"],
        ["logging", "journal", "journaux", "log", "logs", "tracabilite", "traceability",
         "traces", "auditlog", "enregistrement"],
        ["monitoring", "surveillance", "supervision", "monitor", "detection", "detecter"],
        ["siem", "soc", "sok"],
        ["incident", "incidents", "crise", "alerte", "alertes", "evenement", "event", "events"],
        ["backup", "sauvegarde", "sauvegardes", "restauration", "restore", "backups"],
        ["bcp", "drp", "continuite", "continuity", "resilience", "reprise", "recovery"],
        ["riskassessment", "risque", "risques", "risk", "risks", "menace", "menaces",
         "threat", "threats", "vulnerabilite", "vulnerabilites"],
        ["vulnmgmt", "vulnscan", "cve", "faille", "failles", "remediation", "remediations"],
        // « mise » et « jour » sont des mots vides : l'expression « mise à jour »
        // est repliée en amont par Phrases.
        ["patching", "correctif", "correctifs", "patch", "patchs", "patches", "maj",
         "update", "updates", "upgrade"],
        ["pentest", "pentests", "redteam", "intrusion"],
        ["antivirus", "malware", "malwares", "maliciel", "ransomware", "rancongiciel",
         "edr", "xdr", "antimalware"],
        ["firewall", "pare", "feu", "waf", "ips", "ids", "filtrage"],
        ["netsegmentation", "vlan", "dmz", "cloisonnement", "segmentation", "microsegmentation"],
        ["vpn", "remoteaccess", "bastion", "jumphost"],
        ["cloud", "saas", "paas", "iaas", "aws", "azure", "gcp", "hebergeur", "hosting"],
        ["datacenter", "hebergement", "infrastructure", "serveur", "serveurs", "server"],
        ["pii", "rgpd", "gdpr", "confidentialite", "privacy", "anonymisation",
         "pseudonymisation"],
        ["dataclass", "classification", "sensibilite", "sensible", "confidentiel"],
        ["retention", "conservation", "archivage", "archive", "purge"],
        ["datadeletion", "suppression", "effacement", "destruction", "sanitisation", "wipe"],
        ["thirdparty", "supplychain", "fournisseur", "fournisseurs", "supplier", "suppliers",
         "vendor", "vendors", "partenaire", "partenaires", "prestataire", "prestataires"],
        ["contrat", "contrats", "contract", "contracts", "contractuel", "clause", "clauses",
         "engagement", "engagements"],
        ["awareness", "formation", "formations", "training", "sensibilisation", "education"],
        ["screening", "recrutement", "embauche", "embaucher", "personnel", "collaborateur",
         "collaborateurs", "employe", "employes", "employee", "employees", "salarie",
         "salaries", "staff", "hiring", "hire", "onboarding", "antecedent", "antecedents"],
        ["physec", "physique", "physical", "badge", "badges", "videosurveillance", "cctv",
         "intrusion_physique"],
        ["isms", "smsi", "gouvernance", "governance", "pilotage"],
        ["secpolicy", "politique", "politiques", "policy", "policies", "procedure",
         "procedures", "charte", "chartes", "standard", "standards", "directive"],
        ["documentation", "documente", "documentee", "documented", "document", "documents",
         "manuel", "manual", "formalise", "formalisee", "formalized"],
        ["certification", "certifie", "certifiee", "certified", "accreditation", "attestation",
         "conformite", "compliance", "compliant", "conforme"],
        ["internalaudit", "externalaudit", "audit", "audits", "auditer", "controle",
         "controles", "control", "controls", "verification", "verifications"],
        ["nonconformity", "corrective", "actionplan", "ecart", "ecarts", "finding",
         "findings", "constat", "constats"],
        ["changemgmt", "changement", "changements", "change", "changes", "evolution",
         "evolutions"],
        ["configmgmt", "configuration", "configurations", "durcissement", "hardening",
         "baseline", "referentiel_technique"],
        ["sdlc", "securedev", "developpement", "development", "devsecops", "cicd", "pipeline"],
        ["codereview", "sast", "dast", "sca", "analyse_statique"],
        ["endpoint", "poste", "postes", "workstation", "workstations", "laptop", "mobile",
         "mobiles", "byod", "mdm"],
        ["reseau", "reseaux", "network", "networks", "wifi", "lan", "wan"],
        ["disponibilite", "availability", "sla", "uptime", "redondance", "redundancy",
         "haute_disponibilite"],
        ["integrite", "integrity", "hachage", "hash", "signature", "signatures"],
        ["responsabilite", "responsabilites", "responsibility", "responsibilities", "role",
         "roles", "rasci", "raci"],
        ["dirigeant", "direction", "management", "comite", "comites", "board", "gouvernance_org"],
        ["rssi", "ciso", "dpo", "responsable_securite", "security_officer"],
        ["partis", "easa", "aesa", "aviation", "aerien", "aeronautique", "airline",
         "compagnie", "operateur"],
        ["nis2", "nis", "dora", "iso27001", "iso27002", "iso", "soc2", "nist", "pci",
         "pcidss", "tisax"],
        ["inventaire", "inventory", "actif", "actifs", "asset", "assets", "cartographie",
         "cmdb"],
        ["test", "tests", "tester", "testing", "exercice", "exercices", "simulation",
         "phishing", "hameconnage"],
        ["frequence", "frequency", "periodicite", "periodique", "annuel", "annuelle",
         "annually", "trimestriel", "mensuel", "regulierement", "regular"],
        ["responsable", "owner", "proprietaire", "referent", "pilote"],
        ["mesure", "mesures", "measure", "measures", "mecanisme", "mecanismes", "dispositif",
         "dispositifs", "moyen", "moyens", "solution", "solutions", "safeguard", "safeguards"],
        ["independant", "independante", "independent", "independance", "independence",
         "impartial", "externe", "external"],
    ];

    /// <summary>
    /// Mots vides FR + EN.
    ///
    /// Point important, appris à la calibration : les mots interrogatifs et les
    /// verbes de formulation (« quel », « décrivez », « mis en place », « do you
    /// perform ») doivent être écartés. Une question les contient toujours, une
    /// réponse jamais — les garder fait chuter le taux de couverture des bonnes
    /// correspondances sans jamais rien discriminer.
    ///
    /// Comparés à la forme de surface, avant désuffixation : les variantes
    /// conjuguées et les pluriels sont donc listés explicitement.
    /// </summary>
    public static readonly HashSet<string> StopWords = new(StringComparer.Ordinal)
    {
        "a", "au", "aux", "avec", "ce", "ces", "cet", "cette", "dans", "de", "des", "du",
        "elle", "en", "et", "eux", "il", "ils", "je", "la", "le", "les", "leur", "lui", "ma",
        "mais", "me", "meme", "mes", "moi", "mon", "ne", "nos", "notre", "nous", "on", "ou",
        "par", "pas", "pour", "qu", "que", "sa", "se", "ses", "son", "sur", "ta", "te", "tes",
        "toi", "ton", "tu", "un", "une", "vos", "votre", "vous", "y", "d", "l", "n", "s", "c",
        "j", "m", "t", "si", "aussi", "tout", "tous", "toute", "toutes", "autre", "autres",
        "etre", "avoir", "fait", "faire", "plus", "moins", "tres", "bien", "cela", "celui",
        "celle", "ceux", "dont", "donc", "alors", "ainsi", "afin", "lors", "lorsque", "apres",
        "avant", "entre", "chez", "sans", "sous", "vers", "maniere", "facon", "cadre", "sein",
        "egalement", "notamment", "exemple", "exemples", "cas", "concerne", "concernant",
        "relatif", "relative", "propre", "propres", "eventuellement", "elles", "durant",
        "pendant", "depuis", "jusqu",
        "before", "after", "during", "between", "since", "until", "while", "whether",

        "quel", "quelle", "quels", "quelles", "comment", "combien", "pourquoi", "quand",
        "qui", "quoi", "lequel", "laquelle", "lesquels", "lesquelles",

        "est", "sont", "etait", "etaient", "sera", "seront", "soit", "ete", "suis", "es",
        "sommes", "etes", "ai", "as", "ont", "avons", "avez", "peut", "peuvent", "pouvez",
        "doit", "doivent", "devez", "va", "vont",

        "mis", "mise", "mises", "place", "placee", "places", "oeuvre", "existe", "existent",
        "dispose", "disposez", "disposer", "possede", "possedez", "posseder", "utilise",
        "utilisez", "utiliser", "utilisee", "utilisees", "met", "mettez", "mettre",
        "effectue", "effectuez", "effectuer", "realise", "realisez", "realiser", "realisee",
        "realisees", "assure", "assurez", "assurer", "applique", "appliquez", "appliquer",
        "appliquee", "appliquees", "decrivez", "decrire", "decrit", "decrite", "precisez",
        "preciser", "precise", "indiquez", "indiquer", "indique", "expliquez", "expliquer",
        "listez", "lister", "fournissez", "fournir", "fourni", "confirmez", "confirmer",
        "detaillez", "detailler", "joignez", "transmettez", "communiquez", "veuillez",
        "merci", "svp", "type", "types", "sorte", "sortes", "nature",

        "the", "an", "and", "or", "of", "to", "in", "on", "for", "with", "at", "by", "from",
        "as", "is", "are", "was", "were", "be", "been", "being", "this", "that", "these",
        "those", "it", "its", "their", "there", "here", "which", "what", "when", "where",
        "who", "whom", "whose", "how", "why", "many", "much", "do", "does", "did", "done",
        "doing", "have", "has", "had", "having", "can", "could", "should", "would", "may",
        "might", "will", "shall", "must", "not", "no", "yes", "any", "all", "some", "each",
        "other", "your", "our", "my", "his", "her", "they", "them", "we", "us", "you", "i",
        "me", "if", "then", "than", "so", "such", "others",
        "please", "kindly", "describe", "explain", "specify", "indicate", "list", "provide",
        "provided", "confirm", "detail", "outline", "state", "states", "stated", "perform",
        "performs", "performed", "conduct", "conducted", "carry", "carried", "ensure",
        "ensures", "ensured", "use", "uses", "used", "using", "utilize", "utilized", "apply",
        "applies", "applied", "placed", "following", "below", "above", "within", "regarding",
        "related", "about",
        "nb", "ex", "etc", "cf", "via", "ie", "eg",
    };

    /// <summary>
    /// Mots de liaison ignorés lors du repli des expressions : c'est ce qui
    /// permet à « vérifications d'antécédents » de correspondre à « vérification
    /// des antécédents ».
    /// </summary>
    public static readonly HashSet<string> Connectors = new(StringComparer.Ordinal)
    {
        "de", "des", "du", "d", "la", "le", "les", "l", "au", "aux", "a", "en", "et",
        "of", "the", "for", "to", "at", "in", "on", "within",
    };

    /// <summary>Catégories métier proposées au classement des entrées de la base.</summary>
    public static readonly string[] Categories =
    [
        "Chiffrement",
        "Identité & accès",
        "Journalisation & détection",
        "Gestion des incidents",
        "Continuité & sauvegarde",
        "Gestion des risques",
        "Gouvernance & conformité",
        "Tiers & sous-traitance",
        "Vulnérabilités & tests",
        "Réseau & infrastructure",
        "Développement",
        "Données & vie privée",
        "Ressources humaines",
        "Sécurité physique",
    ];

    /// <summary>Terme de surface → forme canonique de sa famille.</summary>
    public static readonly IReadOnlyDictionary<string, string> Canonical = BuildCanonical();

    private static Dictionary<string, string> BuildCanonical()
    {
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var group in SynonymGroups)
        {
            var canonical = group[0];
            foreach (var term in group)
                map.TryAdd(term, canonical);
        }
        return map;
    }
}
