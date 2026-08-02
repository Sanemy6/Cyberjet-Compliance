"""Référentiels de conformité pré-chargés.

Chaque contrôle porte un intitulé français et, en description, son intitulé
officiel anglais : les deux sont indexés, ce qui permet de rapprocher aussi
bien un questionnaire rédigé en français qu'en anglais.

Sources : EASA Part-IS (Règlement d'exécution (UE) 2023/203, Annexe II),
ISO/IEC 27001:2022 Annexe A, Directive NIS 2 (UE) 2022/2555 art. 21,
Règlement DORA (UE) 2022/2554, AICPA Trust Services Criteria 2017 (rév. 2022).
"""

from __future__ import annotations

# (ref, titre FR, thème, intitulé officiel EN)
Control = tuple[str, str, str, str]

PART_IS: list[Control] = [
    ("IS.I.OR.100", "Champ d'application", "Généralités", "Scope"),
    ("IS.I.OR.200", "Système de gestion de la sécurité de l'information (SGSI)", "SGSI",
     "Information security management system (ISMS)"),
    ("IS.I.OR.205", "Appréciation des risques de sécurité de l'information", "Risques",
     "Information security risk assessment"),
    ("IS.I.OR.210", "Traitement des risques de sécurité de l'information", "Risques",
     "Information security risk treatment"),
    ("IS.I.OR.215", "Dispositif de signalement interne", "Signalement",
     "Information security internal reporting scheme"),
    ("IS.I.OR.220", "Incidents : détection, réponse et rétablissement", "Incidents",
     "Information security incidents - detection, response and recovery"),
    ("IS.I.OR.225", "Réponse aux constats notifiés par l'autorité compétente", "Autorité",
     "Response to findings notified by the competent authority"),
    ("IS.I.OR.230", "Dispositif de signalement externe", "Signalement",
     "Information security external reporting scheme"),
    ("IS.I.OR.235", "Sous-traitance des activités de gestion de la sécurité", "Tiers",
     "Contracting of information security management activities"),
    ("IS.I.OR.240", "Exigences relatives au personnel", "Personnel",
     "Personnel requirements"),
    ("IS.I.OR.245", "Conservation des enregistrements", "Documentation",
     "Record-keeping"),
    ("IS.I.OR.250", "Manuel de gestion de la sécurité de l'information (ISMM)",
     "Documentation", "Information security management manual"),
    ("IS.I.OR.255", "Modifications du système de gestion de la sécurité", "SGSI",
     "Changes to the information security management system"),
    ("IS.I.OR.260", "Amélioration continue", "SGSI", "Continuous improvement"),
]

_ISO_A5 = [
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
]

_ISO_A6 = [
    "Sélection des candidats|Screening",
    "Conditions générales d'embauche|Terms and conditions of employment",
    "Sensibilisation, apprentissage et formation à la sécurité de l'information|Information security awareness, education and training",
    "Processus disciplinaire|Disciplinary process",
    "Responsabilités après la fin ou le changement d'un contrat de travail|Responsibilities after termination or change of employment",
    "Accords de confidentialité ou de non-divulgation|Confidentiality or non-disclosure agreements",
    "Travail à distance|Remote working",
    "Déclaration des événements de sécurité de l'information|Information security event reporting",
]

_ISO_A7 = [
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
]

_ISO_A8 = [
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
]


def _iso_controls() -> list[Control]:
    out: list[Control] = []
    blocks = [
        ("5", "Mesures organisationnelles", _ISO_A5),
        ("6", "Mesures liées aux personnes", _ISO_A6),
        ("7", "Mesures physiques", _ISO_A7),
        ("8", "Mesures technologiques", _ISO_A8),
    ]
    for clause, theme, items in blocks:
        for i, item in enumerate(items, start=1):
            fr, en = item.split("|", 1)
            out.append((f"A.{clause}.{i}", fr, theme, en))
    return out


NIS2: list[Control] = [
    ("Art.20", "Gouvernance : responsabilité et formation des organes de direction",
     "Gouvernance", "Governance - management bodies approval and training"),
    ("Art.21.1", "Mesures de gestion des risques adaptées et proportionnées",
     "Gouvernance", "Appropriate and proportionate risk-management measures"),
    ("Art.21.2a", "Politiques d'analyse des risques et de sécurité des SI", "Risques",
     "Policies on risk analysis and information system security"),
    ("Art.21.2b", "Gestion des incidents", "Incidents", "Incident handling"),
    ("Art.21.2c", "Continuité d'activité, sauvegardes, reprise et gestion de crise",
     "Continuité", "Business continuity, backup management, disaster recovery, crisis management"),
    ("Art.21.2d", "Sécurité de la chaîne d'approvisionnement", "Tiers",
     "Supply chain security"),
    ("Art.21.2e", "Sécurité de l'acquisition, du développement et de la maintenance des SI",
     "Développement",
     "Security in network and information systems acquisition, development and maintenance"),
    ("Art.21.2f", "Évaluation de l'efficacité des mesures de gestion des risques",
     "Gouvernance", "Policies to assess the effectiveness of cybersecurity risk-management measures"),
    ("Art.21.2g", "Hygiène cyber de base et formation à la cybersécurité", "Personnel",
     "Basic cyber hygiene practices and cybersecurity training"),
    ("Art.21.2h", "Politiques et procédures relatives à la cryptographie et au chiffrement",
     "Cryptographie", "Policies and procedures regarding the use of cryptography and encryption"),
    ("Art.21.2i", "Sécurité RH, politiques de contrôle d'accès et gestion des actifs",
     "Accès", "Human resources security, access control policies and asset management"),
    ("Art.21.2j", "Authentification multifacteur et communications sécurisées", "Accès",
     "Multi-factor authentication, secured voice/video/text and emergency communications"),
    ("Art.23", "Obligations de notification des incidents importants", "Signalement",
     "Reporting obligations for significant incidents"),
]

DORA: list[Control] = [
    ("Art.5", "Gouvernance et organisation du risque TIC", "Gouvernance",
     "Governance and organisation"),
    ("Art.6", "Cadre de gestion du risque lié aux TIC", "Risques",
     "ICT risk management framework"),
    ("Art.8", "Identification des fonctions, actifs et dépendances TIC", "Risques",
     "Identification"),
    ("Art.9", "Protection et prévention", "Protection", "Protection and prevention"),
    ("Art.10", "Détection des activités anormales", "Détection", "Detection"),
    ("Art.11", "Réponse et rétablissement", "Continuité", "Response and recovery"),
    ("Art.12", "Politiques de sauvegarde, restauration et rétablissement", "Continuité",
     "Backup policies and procedures, restoration and recovery"),
    ("Art.13", "Apprentissage et évolution", "Gouvernance", "Learning and evolving"),
    ("Art.14", "Communication de crise", "Communication", "Communication"),
    ("Art.17", "Processus de gestion des incidents liés aux TIC", "Incidents",
     "ICT-related incident management process"),
    ("Art.19", "Notification des incidents majeurs liés aux TIC", "Signalement",
     "Reporting of major ICT-related incidents"),
    ("Art.24", "Programme de tests de résilience opérationnelle numérique", "Tests",
     "Digital operational resilience testing"),
    ("Art.26", "Tests avancés fondés sur des menaces (TLPT)", "Tests",
     "Advanced testing based on TLPT"),
    ("Art.28", "Principes généraux de gestion du risque lié aux tiers TIC", "Tiers",
     "General principles - ICT third-party risk"),
    ("Art.30", "Dispositions contractuelles clés avec les prestataires TIC", "Tiers",
     "Key contractual provisions"),
]

SOC2: list[Control] = [
    ("CC1.1", "Intégrité et valeurs éthiques", "Environnement de contrôle",
     "Commitment to integrity and ethical values"),
    ("CC1.2", "Indépendance et supervision du conseil", "Environnement de contrôle",
     "Board independence and oversight"),
    ("CC1.3", "Structures, lignes hiérarchiques et responsabilités", "Environnement de contrôle",
     "Structures, reporting lines, authorities and responsibilities"),
    ("CC1.4", "Compétence des personnes", "Environnement de contrôle",
     "Commitment to competence"),
    ("CC1.5", "Responsabilisation individuelle", "Environnement de contrôle",
     "Individual accountability"),
    ("CC2.1", "Information pertinente et de qualité", "Information et communication",
     "Relevant, quality information"),
    ("CC2.2", "Communication interne", "Information et communication",
     "Internal communication"),
    ("CC2.3", "Communication externe", "Information et communication",
     "External communication"),
    ("CC3.1", "Objectifs et identification des risques", "Appréciation des risques",
     "Objectives and risk identification"),
    ("CC3.2", "Analyse des risques", "Appréciation des risques", "Risk analysis"),
    ("CC3.3", "Prise en compte du risque de fraude", "Appréciation des risques",
     "Fraud risk consideration"),
    ("CC3.4", "Identification des changements significatifs", "Appréciation des risques",
     "Identification of significant change"),
    ("CC4.1", "Évaluations continues et ponctuelles", "Surveillance",
     "Ongoing and separate evaluations"),
    ("CC4.2", "Communication des déficiences", "Surveillance",
     "Evaluation and communication of deficiencies"),
    ("CC5.1", "Sélection et développement des activités de contrôle", "Activités de contrôle",
     "Selection and development of control activities"),
    ("CC5.2", "Contrôles généraux sur la technologie", "Activités de contrôle",
     "General controls over technology"),
    ("CC5.3", "Déploiement via politiques et procédures", "Activités de contrôle",
     "Deployment through policies and procedures"),
    ("CC6.1", "Sécurité logique : contrôles d'accès aux actifs", "Accès logique et physique",
     "Logical access security software and infrastructure"),
    ("CC6.2", "Enregistrement et autorisation des utilisateurs", "Accès logique et physique",
     "User registration and authorization"),
    ("CC6.3", "Gestion des droits d'accès sur le cycle de vie", "Accès logique et physique",
     "Access rights over the identity lifecycle"),
    ("CC6.4", "Accès physique aux installations", "Accès logique et physique",
     "Physical access to facilities"),
    ("CC6.5", "Mise au rebut sécurisée des actifs", "Accès logique et physique",
     "Disposal of physical assets"),
    ("CC6.6", "Protection contre les menaces externes", "Accès logique et physique",
     "Protection against threats from outside system boundaries"),
    ("CC6.7", "Transmission, déplacement et suppression sécurisés de l'information",
     "Accès logique et physique", "Restricted transmission, movement and removal of information"),
    ("CC6.8", "Prévention et détection des logiciels non autorisés",
     "Accès logique et physique", "Prevention and detection of unauthorized software"),
    ("CC7.1", "Détection des changements de configuration", "Exploitation",
     "Detection of configuration changes"),
    ("CC7.2", "Surveillance des anomalies", "Exploitation",
     "Monitoring for anomalies"),
    ("CC7.3", "Évaluation des événements de sécurité", "Exploitation",
     "Evaluation of security events"),
    ("CC7.4", "Réponse aux incidents de sécurité", "Exploitation",
     "Response to identified security incidents"),
    ("CC7.5", "Rétablissement après incident", "Exploitation",
     "Recovery from identified security incidents"),
    ("CC8.1", "Gestion des changements", "Gestion des changements", "Change management"),
    ("CC9.1", "Atténuation des risques d'interruption d'activité", "Atténuation",
     "Business disruption risk mitigation"),
    ("CC9.2", "Gestion du risque fournisseurs et partenaires", "Atténuation",
     "Vendor and business partner risk management"),
    ("A1.1", "Capacité et dimensionnement", "Disponibilité", "Capacity management"),
    ("A1.2", "Sauvegardes, reprise et infrastructure de secours", "Disponibilité",
     "Backup, recovery and environmental protections"),
    ("A1.3", "Tests des plans de reprise", "Disponibilité", "Recovery plan testing"),
    ("C1.1", "Identification et protection des informations confidentielles",
     "Confidentialité", "Identification and protection of confidential information"),
    ("C1.2", "Suppression des informations confidentielles", "Confidentialité",
     "Disposal of confidential information"),
]

FRAMEWORKS: list[dict] = [
    {
        "code": "PART-IS",
        "name": "EASA Part-IS",
        "version": "Règl. (UE) 2023/203 — Annexe II (IS.I.OR)",
        "authority": "AESA / EASA",
        "description": "Exigences de gestion de la sécurité de l'information pour les "
                       "organismes de l'aviation civile. Le Règlement délégué (UE) "
                       "2022/1645 reprend la même structure sous la référence IS.D.OR.",
        "accent": "sky",
        "controls": PART_IS,
    },
    {
        "code": "ISO27001",
        "name": "ISO/IEC 27001 — Annexe A",
        "version": "2022",
        "authority": "ISO/IEC",
        "description": "93 mesures de sécurité réparties en 4 thèmes : organisationnel, "
                       "personnes, physique, technologique.",
        "accent": "indigo",
        "controls": _iso_controls(),
    },
    {
        "code": "NIS2",
        "name": "Directive NIS 2",
        "version": "Directive (UE) 2022/2555",
        "authority": "Union européenne",
        "description": "Mesures de gestion des risques de cybersécurité et obligations "
                       "de notification pour les entités essentielles et importantes.",
        "accent": "emerald",
        "controls": NIS2,
    },
    {
        "code": "DORA",
        "name": "DORA",
        "version": "Règlement (UE) 2022/2554",
        "authority": "Union européenne",
        "description": "Résilience opérationnelle numérique du secteur financier : "
                       "risque TIC, incidents, tests, prestataires tiers.",
        "accent": "amber",
        "controls": DORA,
    },
    {
        "code": "SOC2",
        "name": "SOC 2 — Trust Services Criteria",
        "version": "TSC 2017 (rév. 2022)",
        "authority": "AICPA",
        "description": "Critères Sécurité (CC), Disponibilité (A) et Confidentialité (C) "
                       "utilisés dans les questionnaires fournisseurs anglo-saxons.",
        "accent": "rose",
        "controls": SOC2,
    },
]


def seed_frameworks(conn) -> None:
    """Insère les référentiels absents. Idempotent : ne réécrit jamais l'existant."""
    for order, fw in enumerate(FRAMEWORKS):
        conn.execute(
            """INSERT INTO framework (code, name, version, authority, description,
                                      accent, sort_order)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(code) DO UPDATE SET
                   name=excluded.name, version=excluded.version,
                   authority=excluded.authority, description=excluded.description,
                   accent=excluded.accent, sort_order=excluded.sort_order""",
            (fw["code"], fw["name"], fw["version"], fw["authority"],
             fw["description"], fw["accent"], order),
        )
        fw_id = conn.execute(
            "SELECT id FROM framework WHERE code = ?", (fw["code"],)
        ).fetchone()[0]
        for i, (ref, title, theme, en_title) in enumerate(fw["controls"]):
            conn.execute(
                """INSERT INTO control (framework_id, ref, title, theme, description,
                                        sort_order)
                   VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT(framework_id, ref) DO UPDATE SET
                       title=excluded.title, theme=excluded.theme,
                       description=excluded.description, sort_order=excluded.sort_order""",
                (fw_id, ref, title, theme, en_title, i),
            )
