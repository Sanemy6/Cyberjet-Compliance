"""Jeu de données de démonstration.

    python -m app.seed_demo

Crée deux dossiers clients réalistes du secteur aérien, une base de réponses
génériques rattachées aux référentiels, les configurations techniques d'un
client, et un questionnaire Excel d'exemple dans exemples/.

Le script est rejouable : les clients de démonstration sont recréés à chaque
exécution, les réponses génériques ne sont insérées que si elles manquent.
"""

from __future__ import annotations

from pathlib import Path

from .db import BASE_DIR, get_db, init_db, now
from .frameworks import seed_frameworks

# --------------------------------------------------------------------------
# Réponses génériques : (question, réponse, catégorie, mots-clés, [refs])
# Les références sont au format "CODE_REFERENTIEL:REF_CONTROLE".
# --------------------------------------------------------------------------
GENERIC: list[tuple[str, str, str, str, list[str]]] = [
    (
        "Disposez-vous d'une politique de sécurité de l'information formalisée et approuvée par la direction ?",
        "Oui. Une politique de sécurité de l'information (PSSI) est formalisée, approuvée par la "
        "direction générale et revue au minimum une fois par an ou à chaque changement significatif. "
        "Elle est déclinée en politiques thématiques (contrôle d'accès, chiffrement, sauvegarde, "
        "développement sécurisé, télétravail, gestion des tiers) et diffusée à l'ensemble du "
        "personnel, qui en accuse réception à l'embauche puis à chaque révision majeure.",
        "Gouvernance & conformité", "politique, PSSI, gouvernance, direction, revue annuelle",
        ["ISO27001:A.5.1", "PART-IS:IS.I.OR.200", "NIS2:Art.21.2a", "SOC2:CC5.3"],
    ),
    (
        "Comment les rôles et responsabilités en matière de sécurité de l'information sont-ils définis ?",
        "Un responsable de la sécurité des systèmes d'information (RSSI) est nommé et rattaché à la "
        "direction générale, garantissant son indépendance vis-à-vis des équipes opérationnelles. "
        "Les rôles et responsabilités sont formalisés dans une matrice RACI couvrant la gestion des "
        "risques, la gestion des incidents, la conformité et la sécurité opérationnelle. La "
        "séparation des tâches est appliquée entre développement, exploitation et validation.",
        "Gouvernance & conformité", "RSSI, RACI, rôles, responsabilités, séparation des tâches",
        ["ISO27001:A.5.2", "ISO27001:A.5.3", "PART-IS:IS.I.OR.240", "SOC2:CC1.3"],
    ),
    (
        "Décrivez votre méthodologie d'appréciation et de traitement des risques de sécurité de l'information.",
        "L'appréciation des risques suit une méthodologie documentée alignée sur l'ISO/IEC 27005 et "
        "EBIOS Risk Manager. Elle couvre l'identification des actifs et de leurs dépendances, "
        "l'analyse des scénarios de menace, l'évaluation de la vraisemblance et de l'impact, puis la "
        "définition du traitement (réduction, transfert, évitement, acceptation). Les risques sont "
        "consignés dans un registre revu au minimum semestriellement et à chaque changement "
        "significatif. Les risques résiduels font l'objet d'une acceptation formelle par le "
        "propriétaire du risque.",
        "Gestion des risques", "analyse de risque, EBIOS, ISO 27005, registre, risque résiduel",
        # L'appréciation des risques relève du corps de l'ISO 27001 (§6.1.2),
        # pas de l'Annexe A : on ne rattache donc aucun contrôle A.x ici.
        ["PART-IS:IS.I.OR.205", "PART-IS:IS.I.OR.210", "NIS2:Art.21.2a",
         "DORA:Art.6", "SOC2:CC3.2"],
    ),
    (
        "Quel est votre processus de gestion des incidents de sécurité ?",
        "Une procédure de gestion des incidents de sécurité est formalisée et testée annuellement. "
        "Elle couvre la détection (SIEM, EDR, signalements internes), la qualification selon une "
        "échelle de gravité à quatre niveaux, l'endiguement, l'éradication, le rétablissement et le "
        "retour d'expérience. Une cellule de crise est mobilisable 24h/24 avec des rôles préassignés. "
        "Chaque incident majeur donne lieu à une analyse des causes profondes et à un plan d'action "
        "suivi jusqu'à clôture.",
        "Gestion des incidents", "incident, crise, SIEM, gravité, RETEX, cause racine",
        ["ISO27001:A.5.24", "ISO27001:A.5.26", "ISO27001:A.5.27", "PART-IS:IS.I.OR.220",
         "NIS2:Art.21.2b", "DORA:Art.17", "SOC2:CC7.4"],
    ),
    (
        "Dans quels délais notifiez-vous un incident de sécurité à vos clients et aux autorités ?",
        "Les clients concernés sont informés sans délai injustifié et au plus tard sous 24 heures "
        "après qualification d'un incident affectant leurs données ou leurs services, via le contact "
        "désigné au contrat. Les obligations réglementaires applicables sont respectées : alerte "
        "précoce sous 24 heures et notification sous 72 heures au titre de NIS 2, notification à "
        "l'autorité de contrôle sous 72 heures au titre du RGPD, et signalement à l'autorité "
        "compétente selon le dispositif de signalement externe exigé par le Part-IS.",
        "Gestion des incidents", "notification, 72 heures, autorité, NIS2, RGPD, signalement",
        ["PART-IS:IS.I.OR.230", "NIS2:Art.23", "DORA:Art.19"],
    ),
    (
        "Vos collaborateurs sont-ils sensibilisés et formés à la sécurité de l'information ?",
        "Tous les collaborateurs suivent une formation de sensibilisation à la sécurité à l'embauche "
        "puis une session de mise à jour annuelle obligatoire, avec évaluation des acquis et suivi du "
        "taux de complétion. Des campagnes de simulation d'hameçonnage sont menées au minimum "
        "trimestriellement, avec accompagnement renforcé des personnes en difficulté. Les populations "
        "exposées (administrateurs, développeurs, direction) bénéficient de modules spécifiques.",
        "Ressources humaines", "sensibilisation, formation, phishing, hameçonnage, campagne",
        ["ISO27001:A.6.3", "PART-IS:IS.I.OR.240", "NIS2:Art.21.2g", "SOC2:CC1.4"],
    ),
    (
        "Réalisez-vous des vérifications d'antécédents avant l'embauche ?",
        "Oui. Les candidats font l'objet d'une vérification proportionnée au niveau de sensibilité du "
        "poste, dans le respect du droit applicable : contrôle d'identité, vérification des diplômes "
        "et des références professionnelles, et vérification du casier judiciaire lorsque la "
        "réglementation le permet. Les postes donnant accès à des données sensibles ou à des "
        "environnements de production font l'objet d'une vérification renforcée. Tous les "
        "collaborateurs signent un accord de confidentialité et une charte informatique.",
        "Ressources humaines", "antécédents, screening, recrutement, NDA, confidentialité",
        ["ISO27001:A.6.1", "ISO27001:A.6.2", "ISO27001:A.6.6"],
    ),
    (
        "Comment les droits d'accès sont-ils attribués, revus et révoqués ?",
        "Les accès sont attribués selon les principes du moindre privilège et du besoin d'en "
        "connaître, sur la base de profils métier prédéfinis et après validation formelle du "
        "responsable hiérarchique et du propriétaire de la ressource. Le processus arrivée / mutation "
        "/ départ est outillé et déclenché automatiquement par le SIRH : les accès sont révoqués le "
        "jour même du départ. Une revue des habilitations est conduite trimestriellement pour les "
        "comptes à privilèges et semestriellement pour les autres, avec traçabilité des décisions.",
        "Identité & accès", "habilitation, revue des accès, moindre privilège, arrivée départ, JML",
        ["ISO27001:A.5.15", "ISO27001:A.5.18", "ISO27001:A.8.2", "NIS2:Art.21.2i", "SOC2:CC6.3"],
    ),
    (
        "L'authentification multifacteur est-elle déployée ?",
        "L'authentification multifacteur est obligatoire pour l'ensemble des accès distants, des "
        "accès aux applications exposées sur Internet, des consoles d'administration cloud et de tous "
        "les comptes à privilèges. Les facteurs résistants à l'hameçonnage (FIDO2 / WebAuthn) sont "
        "privilégiés ; l'authentification par SMS n'est pas utilisée pour les comptes sensibles. "
        "L'accès aux ressources internes s'appuie sur une authentification unique (SSO) couplée à des "
        "règles d'accès conditionnel évaluant la conformité du poste et le niveau de risque.",
        "Identité & accès", "MFA, 2FA, FIDO2, SSO, accès conditionnel, authentification forte",
        ["ISO27001:A.8.5", "NIS2:Art.21.2j", "SOC2:CC6.1"],
    ),
    (
        "Quelles mesures de chiffrement protègent les données au repos et en transit ?",
        "Les données sont chiffrées au repos comme en transit à l'aide d'algorithmes reconnus par "
        "l'état de l'art et conformes aux recommandations de l'ANSSI. Une politique de cryptographie "
        "encadre le choix des algorithmes, la longueur des clés, leur cycle de vie et leur rotation. "
        "Les clés sont conservées dans un coffre-fort dédié adossé à un module matériel de sécurité, "
        "avec séparation stricte entre les clés de production et celles des environnements de test. "
        "Les valeurs précises mises en œuvre sont détaillées dans les configurations techniques du "
        "dossier client.",
        "Chiffrement", "chiffrement, cryptographie, clés, HSM, ANSSI, au repos, en transit",
        ["ISO27001:A.8.24", "NIS2:Art.21.2h", "SOC2:CC6.7"],
    ),
    (
        "Quelle est votre politique de sauvegarde et testez-vous les restaurations ?",
        "Les sauvegardes suivent la règle 3-2-1 : trois copies, sur deux types de supports, dont une "
        "hors site. Les sauvegardes sont chiffrées et au moins une copie est immuable afin de "
        "résister à un rançongiciel. La fréquence, la durée de rétention et les objectifs de reprise "
        "sont définis par criticité de service. Des tests de restauration sont réalisés au minimum "
        "semestriellement sur un échantillon représentatif, et leurs résultats sont consignés.",
        "Continuité & sauvegarde", "sauvegarde, backup, 3-2-1, immuable, restauration, rétention",
        ["ISO27001:A.8.13", "NIS2:Art.21.2c", "DORA:Art.12", "SOC2:A1.2"],
    ),
    (
        "Disposez-vous d'un plan de continuité et de reprise d'activité, et est-il testé ?",
        "Un plan de continuité d'activité et un plan de reprise informatique sont formalisés à partir "
        "d'un bilan d'impact sur l'activité identifiant les processus critiques et leurs objectifs de "
        "reprise (RTO / RPO). Les dispositifs incluent la redondance des infrastructures, la "
        "réplication inter-régions et des procédures de bascule documentées. Un exercice de bascule "
        "est conduit au minimum une fois par an, complété par des exercices de gestion de crise ; "
        "chaque exercice donne lieu à un rapport et à un plan d'amélioration.",
        "Continuité & sauvegarde", "PCA, PRA, BIA, RTO, RPO, exercice, bascule, redondance",
        ["ISO27001:A.5.29", "ISO27001:A.5.30", "ISO27001:A.8.14", "NIS2:Art.21.2c",
         "DORA:Art.11", "SOC2:A1.3"],
    ),
    (
        "Comment les événements de sécurité sont-ils journalisés et surveillés ?",
        "Les événements de sécurité des systèmes critiques, des équipements réseau, des annuaires et "
        "des environnements cloud sont centralisés dans un SIEM. Les journaux sont horodatés sur une "
        "source de temps commune, protégés en intégrité et conservés au minimum douze mois. Des "
        "règles de corrélation et de détection comportementale génèrent des alertes qualifiées par un "
        "centre opérationnel de sécurité assurant une surveillance continue. Les actions des comptes "
        "à privilèges font l'objet d'une journalisation renforcée et d'une revue périodique.",
        "Journalisation & détection", "journalisation, logs, SIEM, SOC, corrélation, rétention",
        ["ISO27001:A.8.15", "ISO27001:A.8.16", "ISO27001:A.8.17", "DORA:Art.10", "SOC2:CC7.2"],
    ),
    (
        "Comment gérez-vous les vulnérabilités techniques et les correctifs de sécurité ?",
        "Une veille sur les vulnérabilités s'appuie sur les bulletins des éditeurs, les sources "
        "nationales (CERT-FR) et les flux de renseignement sur la menace. Des scans de vulnérabilité "
        "authentifiés sont exécutés au minimum mensuellement sur l'ensemble du parc, et en continu "
        "sur les actifs exposés sur Internet. Les délais de correction sont contractualisés par "
        "criticité : 48 heures pour une vulnérabilité critique activement exploitée, 15 jours pour "
        "une vulnérabilité critique, 30 jours pour une élevée, 90 jours pour les autres. Les "
        "dérogations sont formalisées, motivées, assorties de mesures compensatoires et revues.",
        "Vulnérabilités & tests", "vulnérabilité, CVE, scan, patch, correctif, délai, CERT-FR",
        ["ISO27001:A.8.8", "NIS2:Art.21.2e", "DORA:Art.9", "SOC2:CC7.1"],
    ),
    (
        "Réalisez-vous des tests d'intrusion et des audits de sécurité indépendants ?",
        "Un test d'intrusion est réalisé au minimum une fois par an par un prestataire externe "
        "indépendant, sur le périmètre exposé sur Internet et sur les applications métier critiques. "
        "Des tests complémentaires sont déclenchés à chaque évolution majeure d'architecture. Les "
        "vulnérabilités identifiées sont intégrées au plan d'action avec un suivi jusqu'à "
        "remédiation, puis un contre-test. Une synthèse du rapport peut être communiquée au client "
        "sous accord de confidentialité.",
        "Vulnérabilités & tests", "pentest, test d'intrusion, audit, contre-test, remédiation",
        ["ISO27001:A.8.29", "ISO27001:A.5.35", "DORA:Art.24", "SOC2:CC4.1"],
    ),
    (
        "Comment évaluez-vous et pilotez-vous la sécurité de vos sous-traitants et fournisseurs ?",
        "Les fournisseurs sont classés par criticité selon leur accès aux données et leur rôle dans "
        "la chaîne de service. Toute nouvelle relation critique est précédée d'une évaluation de "
        "sécurité (questionnaire, revue des certifications, analyse des rapports d'audit "
        "indépendants). Les exigences de sécurité sont contractualisées : engagements de "
        "confidentialité, notification d'incident, droit d'audit, réversibilité, localisation des "
        "données et encadrement de la sous-traitance ultérieure. Une revue annuelle est conduite pour "
        "les fournisseurs critiques.",
        "Tiers & sous-traitance", "fournisseur, sous-traitant, tiers, supply chain, contrat, audit",
        ["ISO27001:A.5.19", "ISO27001:A.5.20", "ISO27001:A.5.21", "ISO27001:A.5.22",
         "PART-IS:IS.I.OR.235", "NIS2:Art.21.2d", "DORA:Art.28", "SOC2:CC9.2"],
    ),
    (
        "Comment la sécurité est-elle intégrée au cycle de développement logiciel ?",
        "Le cycle de développement intègre la sécurité dès la conception : analyse de risque et "
        "modélisation des menaces sur les évolutions structurantes, exigences de sécurité formalisées "
        "dans les spécifications, règles de codage sécurisé alignées sur l'OWASP. La chaîne "
        "d'intégration continue exécute automatiquement une analyse statique du code, une analyse des "
        "dépendances tierces et une détection de secrets ; les vulnérabilités bloquantes empêchent la "
        "mise en production. Toute évolution fait l'objet d'une revue de code par un pair, et les "
        "environnements de développement, de test et de production sont strictement séparés.",
        "Développement", "SDLC, DevSecOps, OWASP, SAST, SCA, revue de code, environnements",
        ["ISO27001:A.8.25", "ISO27001:A.8.26", "ISO27001:A.8.28", "ISO27001:A.8.31",
         "NIS2:Art.21.2e"],
    ),
    (
        "Comment les changements sur les systèmes de production sont-ils maîtrisés ?",
        "Tout changement sur un système de production suit un processus formalisé : demande "
        "qualifiée, analyse d'impact incluant la dimension sécurité, validation par un comité "
        "consultatif des changements, test préalable en préproduction et plan de retour arrière "
        "documenté. Les changements urgents suivent une procédure accélérée avec régularisation a "
        "posteriori sous 48 heures. L'ensemble des changements est tracé et fait l'objet d'une revue "
        "périodique.",
        "Développement", "gestion des changements, CAB, rollback, préproduction, impact",
        ["ISO27001:A.8.32", "PART-IS:IS.I.OR.255", "SOC2:CC8.1"],
    ),
    (
        "Quelles mesures de sécurité physique protègent vos locaux et vos infrastructures ?",
        "Les locaux sont protégés par un périmètre de sécurité avec contrôle d'accès par badge "
        "nominatif, journalisation des entrées et vidéoprotection conservée conformément à la "
        "réglementation. Les zones sensibles (salles techniques, locaux de brassage) font l'objet "
        "d'une restriction d'accès renforcée et d'une revue trimestrielle des autorisations. Les "
        "visiteurs sont enregistrés et accompagnés. Les infrastructures hébergées le sont dans des "
        "centres de données certifiés disposant de dispositifs de détection et d'extinction "
        "d'incendie, d'alimentation secourue et de climatisation redondante.",
        "Sécurité physique", "sécurité physique, badge, vidéoprotection, datacenter, visiteurs",
        ["ISO27001:A.7.1", "ISO27001:A.7.2", "ISO27001:A.7.4", "SOC2:CC6.4"],
    ),
    (
        "Comment protégez-vous les données à caractère personnel et respectez-vous le RGPD ?",
        "Un délégué à la protection des données est désigné et un registre des traitements est tenu à "
        "jour. Les principes de minimisation, de limitation des finalités et de protection dès la "
        "conception sont appliqués. Les traitements à risque élevé font l'objet d'une analyse "
        "d'impact relative à la protection des données. Les durées de conservation sont définies par "
        "catégorie de données et leur purge est automatisée. Les transferts hors Union européenne "
        "s'appuient sur des clauses contractuelles types complétées d'une analyse d'impact des "
        "transferts. Une procédure de gestion des demandes d'exercice des droits garantit une réponse "
        "sous un mois.",
        "Données & vie privée", "RGPD, données personnelles, DPO, AIPD, registre, conservation",
        ["ISO27001:A.5.34", "ISO27001:A.5.33", "ISO27001:A.8.10"],
    ),
    (
        "Êtes-vous certifiés ISO/IEC 27001 ou disposez-vous d'attestations équivalentes ?",
        "Le système de management de la sécurité de l'information est aligné sur l'ISO/IEC 27001:2022. "
        "Le certificat en cours de validité, son périmètre et la déclaration d'applicabilité peuvent "
        "être communiqués sur demande. Des audits internes sont conduits selon un programme "
        "pluriannuel couvrant l'ensemble des exigences, et une revue de direction est tenue au moins "
        "annuellement. Les écarts identifiés font l'objet d'actions correctives suivies jusqu'à "
        "clôture.",
        "Gouvernance & conformité", "ISO 27001, certification, SoA, audit interne, revue de direction",
        ["ISO27001:A.5.35", "ISO27001:A.5.36", "PART-IS:IS.I.OR.260"],
    ),
    (
        "Comment répondez-vous aux exigences du règlement Part-IS en matière de gestion de la sécurité de l'information ?",
        "Un système de gestion de la sécurité de l'information conforme au Part-IS est en place. Il "
        "couvre l'appréciation des risques portant sur les systèmes d'information susceptibles "
        "d'affecter la sécurité de l'aviation, le traitement de ces risques, les dispositifs de "
        "signalement interne et externe, la détection et la réponse aux incidents, les exigences "
        "relatives au personnel, la conservation des enregistrements et l'amélioration continue. Le "
        "manuel de gestion de la sécurité de l'information décrit l'organisation, les processus et "
        "les interfaces avec le système de gestion existant. Les modifications du système sont gérées "
        "et, le cas échéant, soumises à l'approbation de l'autorité compétente.",
        "Gouvernance & conformité", "Part-IS, EASA, aviation, SGSI, ISMM, autorité compétente",
        ["PART-IS:IS.I.OR.200", "PART-IS:IS.I.OR.250", "PART-IS:IS.I.OR.255",
         "PART-IS:IS.I.OR.260", "PART-IS:IS.I.OR.245"],
    ),
    (
        "Comment les données sont-elles classifiées et les supports sensibles éliminés ?",
        "Un schéma de classification à quatre niveaux (public, interne, confidentiel, restreint) est "
        "défini ; chaque niveau détermine les règles de marquage, de stockage, d'échange et de "
        "conservation. Les propriétaires d'information sont identifiés et responsables de la "
        "classification. En fin de vie, les supports contenant des données confidentielles ou "
        "restreintes sont effacés de manière sécurisée ou détruits physiquement par un prestataire "
        "spécialisé délivrant un certificat de destruction.",
        "Données & vie privée", "classification, marquage, destruction, effacement, supports",
        ["ISO27001:A.5.12", "ISO27001:A.5.13", "ISO27001:A.7.10", "ISO27001:A.7.14",
         "ISO27001:A.8.10", "SOC2:C1.2"],
    ),
    (
        "Quelles protections sont déployées sur les postes de travail et les terminaux mobiles ?",
        "Le parc est administré via une solution de gestion unifiée des terminaux appliquant une "
        "configuration durcie de référence. Chaque poste dispose du chiffrement intégral du disque, "
        "d'une solution de détection et de réponse sur les terminaux, du verrouillage automatique de "
        "session et de la restriction des droits d'administration locale. Les mises à jour de sécurité "
        "sont déployées automatiquement, avec un contrôle de conformité conditionnant l'accès aux "
        "ressources de l'entreprise. Les terminaux mobiles font l'objet d'une séparation entre "
        "données professionnelles et personnelles et d'une capacité d'effacement à distance.",
        "Réseau & infrastructure", "poste de travail, MDM, EDR, durcissement, chiffrement de disque",
        ["ISO27001:A.8.1", "ISO27001:A.8.7", "ISO27001:A.8.9", "ISO27001:A.6.7"],
    ),
]

# --------------------------------------------------------------------------
# Clients de démonstration
# --------------------------------------------------------------------------
DEMO_CLIENTS = [
    {
        "name": "Nordic Wings Airlines",
        "country": "Suède",
        "contact": "Ingrid Lindqvist — Head of Information Security",
        "description": (
            "Compagnie aérienne régionale opérant 38 appareils depuis Stockholm-Arlanda. "
            "Certifiée AOC, soumise au Part-IS depuis octobre 2025 et engagée dans une "
            "certification ISO/IEC 27001:2022 sur le périmètre des systèmes opérationnels "
            "au sol. Entité importante au sens de NIS 2."
        ),
    },
    {
        "name": "AeroTech MRO Services",
        "country": "France",
        "contact": "Marc Delaunay — Directeur qualité et conformité",
        "description": (
            "Organisme de maintenance agréé Part-145 intervenant sur moteurs et équipements. "
            "Périmètre Part-IS en cours de déploiement ; nombreux questionnaires reçus des "
            "compagnies donneuses d'ordre."
        ),
    },
]

CLIENT_KB = [
    (
        "Où sont hébergées les données et dans quelles régions géographiques ?",
        "L'ensemble des données de production est hébergé chez Microsoft Azure, dans les régions "
        "West Europe (Amsterdam) en site principal et North Europe (Dublin) en site de secours. "
        "Aucune donnée de production n'est stockée ni traitée hors de l'Espace économique européen. "
        "Les prestataires d'infogérance interviennent exclusivement depuis l'Union européenne, via "
        "des accès nominatifs tracés au travers d'un bastion.",
        "Réseau & infrastructure", "hébergement, Azure, UE, région, localisation des données",
        ["ISO27001:A.5.23"],
    ),
    (
        "Quels sont vos objectifs de reprise (RTO et RPO) pour les services critiques ?",
        "Pour les systèmes classés critiques pour l'exploitation (planification des équipages, "
        "chargement et centrage, suivi de navigabilité) : RTO de 4 heures et RPO de 15 minutes, "
        "assurés par une réplication synchrone entre les deux régions Azure. Pour les systèmes "
        "support (gestion documentaire, outils bureautiques) : RTO de 24 heures et RPO de 4 heures. "
        "Ces objectifs sont issus du bilan d'impact sur l'activité revu annuellement et vérifiés lors "
        "de l'exercice de bascule annuel.",
        "Continuité & sauvegarde", "RTO, RPO, BIA, réplication, bascule, criticité",
        ["ISO27001:A.5.30", "DORA:Art.12"],
    ),
    (
        "Disposez-vous d'une assurance couvrant le risque cyber ?",
        "Oui. Une police d'assurance cyber est souscrite auprès d'un assureur de premier plan, avec "
        "une garantie de 10 millions d'euros par sinistre couvrant les frais de gestion de crise, "
        "l'expertise forensique, les pertes d'exploitation, la responsabilité civile vis-à-vis des "
        "tiers et les frais de notification. L'attestation d'assurance en cours de validité est "
        "communicable sur demande.",
        "Gouvernance & conformité", "assurance cyber, garantie, sinistre, attestation",
        [],
    ),
    (
        "Quels effectifs sont dédiés à la sécurité de l'information ?",
        "L'équipe sécurité compte 6 personnes à temps plein : une responsable de la sécurité des "
        "systèmes d'information rattachée à la direction générale, deux analystes sécurité "
        "opérationnelle, un architecte sécurité, un chargé de conformité et gestion des risques, et "
        "un correspondant Part-IS. La surveillance 24h/24 et 7j/7 est assurée par un centre "
        "opérationnel de sécurité externalisé auprès d'un prestataire qualifié PDIS.",
        "Gouvernance & conformité", "effectifs, équipe sécurité, RSSI, SOC, PDIS",
        ["PART-IS:IS.I.OR.240"],
    ),
]

CLIENT_CONFIGS = [
    ("Chiffrement", "Chiffrement des données au repos", "AES-256-GCM",
     "Chiffrement transparent au niveau des volumes de stockage (Azure Storage Service Encryption) "
     "et des bases de données (Transparent Data Encryption). Clés gérées par le client (CMK).",
     "Ensemble des environnements de production Azure West Europe et North Europe"),
    ("Chiffrement", "Chiffrement des données en transit", "TLS 1.3 (TLS 1.2 minimum)",
     "Suites de chiffrement restreintes aux recommandations ANSSI. TLS 1.0, TLS 1.1 et les suites "
     "sans confidentialité persistante sont désactivés. HSTS activé avec préchargement. "
     "Authentification mutuelle (mTLS) sur les flux inter-services.",
     "Tous les flux externes et inter-services"),
    ("Chiffrement", "Chiffrement des sauvegardes", "AES-256",
     "Sauvegardes chiffrées avec un jeu de clés distinct de celui de la production. Une copie "
     "immuable est conservée en coffre verrouillé pendant 30 jours.",
     "Toutes les sauvegardes, y compris les copies hors site"),
    ("Chiffrement", "Gestion des clés cryptographiques", "Azure Key Vault Managed HSM (FIPS 140-2 niveau 3)",
     "Rotation annuelle automatique des clés de chiffrement de données, rotation tous les 90 jours "
     "des secrets applicatifs. Séparation stricte des clés entre production, préproduction et "
     "développement. Accès aux clés soumis à double validation.",
     "Ensemble du périmètre de production"),
    ("Chiffrement", "Chiffrement des postes de travail", "BitLocker AES-256 XTS",
     "Chiffrement intégral du disque activé sur 100 % du parc, clés de récupération séquestrées dans "
     "Entra ID. Conformité vérifiée en continu par Intune.",
     "412 postes de travail et 87 terminaux mobiles"),

    ("Identité & accès", "Authentification multifacteur", "Microsoft Entra ID — FIDO2 et Microsoft Authenticator",
     "Obligatoire pour 100 % des comptes. Clés de sécurité FIDO2 imposées aux administrateurs et aux "
     "populations sensibles. Authentification par SMS désactivée.",
     "Tous les utilisateurs, y compris les prestataires"),
    ("Identité & accès", "Authentification unique", "SAML 2.0 et OpenID Connect via Microsoft Entra ID",
     "Accès conditionnel évaluant la conformité du poste, la localisation et le niveau de risque de "
     "connexion. Sessions limitées à 8 heures, réauthentification exigée pour les actions sensibles.",
     "34 applications métier fédérées"),
    ("Identité & accès", "Gestion des comptes à privilèges", "CyberArk Privilege Cloud",
     "Coffre-fort de mots de passe avec rotation automatique, accès juste-à-temps limité à 4 heures, "
     "double validation pour les environnements critiques et enregistrement vidéo des sessions "
     "d'administration.",
     "Comptes d'administration des systèmes, du réseau et du cloud"),
    ("Identité & accès", "Revue des habilitations", "Trimestrielle (privilèges) / semestrielle (standard)",
     "Campagnes de recertification pilotées dans Entra ID Governance. Les accès non recertifiés dans "
     "les 15 jours sont automatiquement suspendus.",
     "Ensemble des applications et infrastructures"),
    ("Identité & accès", "Politique de mots de passe", "14 caractères minimum, sans expiration périodique",
     "Alignée sur les recommandations ANSSI et NIST SP 800-63B : contrôle contre les listes de mots "
     "de passe compromis, pas de rotation forcée en l'absence de suspicion, verrouillage progressif "
     "après échecs.",
     "Tous les comptes utilisateurs et de service"),

    ("Réseau & infrastructure", "Segmentation réseau", "VLAN et micro-segmentation Azure NSG / ASG",
     "Séparation stricte entre les zones bureautique, production, administration et systèmes "
     "opérationnels aéronautiques. Flux inter-zones autorisés en liste blanche uniquement.",
     "Ensemble des sites et des environnements cloud"),
    ("Réseau & infrastructure", "Pare-feu et filtrage", "Palo Alto Networks NGFW (PAN-OS 11)",
     "Inspection applicative, prévention d'intrusion, filtrage d'URL et sandboxing des fichiers. "
     "Règles revues trimestriellement, règles inutilisées supprimées.",
     "Périmètre des sites de Stockholm et Göteborg"),
    ("Réseau & infrastructure", "Accès distant", "VPN IPsec avec MFA et accès Zero Trust (Entra Private Access)",
     "Aucun accès direct depuis Internet aux ressources internes. Les prestataires passent par un "
     "bastion avec enregistrement de session.",
     "Télétravail, itinérance et interventions de tiers"),
    ("Réseau & infrastructure", "Hébergement", "Microsoft Azure — West Europe (principal) et North Europe (secours)",
     "Centres de données certifiés ISO 27001, ISO 27017, ISO 27018 et SOC 2 Type II. Aucune donnée "
     "de production hors Espace économique européen.",
     "Ensemble des systèmes de production"),

    ("Sauvegarde & continuité", "Politique de sauvegarde", "Règle 3-2-1, rétention 90 jours, copie immuable 30 jours",
     "Sauvegarde incrémentale toutes les heures et complète chaque nuit pour les systèmes critiques. "
     "Copie hors site répliquée dans la région de secours.",
     "Systèmes critiques et données métier"),
    ("Sauvegarde & continuité", "Objectifs de reprise", "RTO 4 h / RPO 15 min (systèmes critiques)",
     "RTO 24 h et RPO 4 h pour les systèmes support. Objectifs issus du bilan d'impact sur "
     "l'activité, vérifiés lors de l'exercice de bascule annuel.",
     "Planification équipages, chargement et centrage, suivi de navigabilité"),
    ("Sauvegarde & continuité", "Tests de restauration", "Semestriels, sur échantillon représentatif",
     "Dernier test réalisé avec succès : restauration complète d'un environnement critique en "
     "2 h 40, soit en deçà du RTO cible.",
     "Systèmes critiques"),

    ("Journalisation & supervision", "Centralisation des journaux", "Microsoft Sentinel — rétention 12 mois",
     "Journaux protégés en intégrité, horodatés via NTP interne synchronisé sur une source de temps "
     "fiable. Archivage froid pendant 24 mois supplémentaires.",
     "Serveurs, réseau, annuaire, environnements cloud et applications critiques"),
    ("Journalisation & supervision", "Surveillance opérationnelle", "SOC externalisé 24/7 (prestataire qualifié PDIS)",
     "Engagement de prise en charge : 15 minutes pour une alerte critique, 1 heure pour une alerte "
     "élevée. Rapport mensuel et revue trimestrielle de service.",
     "Ensemble du périmètre supervisé"),
    ("Journalisation & supervision", "Détection sur les terminaux", "CrowdStrike Falcon (EDR)",
     "Déployé sur 100 % des serveurs et des postes de travail, avec isolation réseau automatique en "
     "cas de détection critique.",
     "412 postes, 87 mobiles et 143 serveurs"),

    ("Poste de travail", "Gestion du parc", "Microsoft Intune — configuration durcie CIS Benchmark niveau 1",
     "Conformité évaluée en continu ; un poste non conforme perd l'accès aux ressources "
     "d'entreprise. Droits d'administration locale supprimés par défaut.",
     "Ensemble du parc bureautique et mobile"),

    ("Développement", "Chaîne d'intégration continue", "Azure DevOps avec contrôles de sécurité bloquants",
     "Analyse statique (SonarQube), analyse des dépendances (Dependabot), détection de secrets "
     "(Gitleaks) et signature des artefacts. Toute vulnérabilité critique bloque la mise en "
     "production.",
     "Applications développées en interne"),
]


def _control_index(conn) -> dict[str, int]:
    index: dict[str, int] = {}
    for row in conn.execute("""
        SELECT c.id, c.ref, f.code FROM control c JOIN framework f ON f.id = c.framework_id
    """):
        index[f"{row['code']}:{row['ref']}"] = row["id"]
    return index


def _insert_kb(conn, controls, client_id, question, answer, category, tags, refs) -> None:
    ts = now()
    cur = conn.execute(
        """INSERT INTO kb_entry (client_id, question, answer, category, tags, status,
                                 source, created_at, updated_at, reviewed_at)
           VALUES (?, ?, ?, ?, ?, 'validated', 'Jeu de démonstration', ?, ?, ?)""",
        (client_id, question, answer, category, tags, ts, ts, ts))
    for ref in refs:
        control_id = controls.get(ref)
        if control_id:
            conn.execute(
                "INSERT OR IGNORE INTO kb_control (kb_entry_id, control_id) VALUES (?, ?)",
                (cur.lastrowid, control_id))
        else:
            print(f"  ! contrôle inconnu, ignoré : {ref}")


def seed() -> None:
    init_db()
    with get_db() as conn:
        seed_frameworks(conn)
        controls = _control_index(conn)

        # Réponses génériques : insérées uniquement si absentes.
        added = 0
        for question, answer, category, tags, refs in GENERIC:
            exists = conn.execute(
                "SELECT 1 FROM kb_entry WHERE client_id IS NULL AND question = ?",
                (question,)).fetchone()
            if exists:
                continue
            _insert_kb(conn, controls, None, question, answer, category, tags, refs)
            added += 1
        print(f"Base générique : {added} réponse(s) ajoutée(s), {len(GENERIC) - added} déjà présente(s).")

        # Clients de démonstration : recréés à chaque exécution.
        for spec in DEMO_CLIENTS:
            conn.execute("DELETE FROM client WHERE name = ?", (spec["name"],))
            ts = now()
            cur = conn.execute(
                """INSERT INTO client (name, country, contact, description, status,
                                       created_at, updated_at)
                   VALUES (?, ?, ?, ?, 'actif', ?, ?)""",
                (spec["name"], spec["country"], spec["contact"],
                 spec["description"], ts, ts))
            spec["id"] = cur.lastrowid

        main_client = DEMO_CLIENTS[0]["id"]
        for question, answer, category, tags, refs in CLIENT_KB:
            _insert_kb(conn, controls, main_client, question, answer, category, tags, refs)
        print(f"Client « {DEMO_CLIENTS[0]['name']} » : {len(CLIENT_KB)} réponse(s) spécifique(s).")

        for category, label, value, details, scope in CLIENT_CONFIGS:
            conn.execute(
                """INSERT INTO config_item (client_id, category, label, value, details,
                                            scope, status, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, 'en place', ?)""",
                (main_client, category, label, value, details, scope, now()))
        print(f"Client « {DEMO_CLIENTS[0]['name']} » : {len(CLIENT_CONFIGS)} configuration(s).")

    build_sample_questionnaire()


# --------------------------------------------------------------------------
# Questionnaire Excel d'exemple
# --------------------------------------------------------------------------
SAMPLE_ROWS = [
    ("Gouvernance", "1.1", "Disposez-vous d'une politique de sécurité de l'information approuvée par la direction et revue annuellement ?"),
    ("Gouvernance", "1.2", "Un responsable de la sécurité des systèmes d'information est-il formellement désigné ?"),
    ("Gouvernance", "1.3", "Êtes-vous certifié ISO/IEC 27001 ? Si oui, précisez le périmètre du certificat."),
    ("Gouvernance", "1.4", "Comment répondez-vous aux exigences IS.I.OR.200 du règlement Part-IS ?"),
    ("Gestion des risques", "2.1", "Décrivez la méthodologie utilisée pour l'appréciation des risques de sécurité de l'information."),
    ("Gestion des risques", "2.2", "À quelle fréquence le registre des risques est-il revu ?"),
    ("Cryptographie", "3.1", "Quel type de chiffrement est mis en place pour les données au repos ?"),
    ("Cryptographie", "3.2", "Quel protocole et quelle version protègent les données en transit ?"),
    ("Cryptographie", "3.3", "Comment les clés de chiffrement sont-elles générées, stockées et renouvelées ?"),
    ("Contrôle d'accès", "4.1", "L'authentification multifacteur est-elle imposée pour les accès distants et les comptes à privilèges ?"),
    ("Contrôle d'accès", "4.2", "Décrivez le processus d'attribution, de revue et de révocation des droits d'accès."),
    ("Contrôle d'accès", "4.3", "Comment les comptes à privilèges sont-ils protégés et tracés ?"),
    ("Exploitation", "5.1", "Do you centralise security event logs, and for how long are they retained?"),
    ("Exploitation", "5.2", "Quels sont vos délais contractuels de correction des vulnérabilités critiques ?"),
    ("Exploitation", "5.3", "Réalisez-vous des tests d'intrusion par un tiers indépendant ?"),
    ("Continuité", "6.1", "Décrivez votre politique de sauvegarde et la fréquence des tests de restauration."),
    ("Continuité", "6.2", "Quels sont vos objectifs de reprise RTO et RPO pour les services critiques ?"),
    ("Continuité", "6.3", "Un plan de continuité d'activité est-il documenté et testé annuellement ?"),
    ("Incidents", "7.1", "Décrivez votre processus de gestion des incidents de sécurité."),
    ("Incidents", "7.2", "Dans quel délai notifiez-vous vos clients en cas d'incident affectant leurs données ?"),
    ("Tiers", "8.1", "Comment évaluez-vous la sécurité de vos sous-traitants critiques ?"),
    ("Tiers", "8.2", "Les exigences de sécurité sont-elles contractualisées avec vos fournisseurs ?"),
    ("Données", "9.1", "Où sont hébergées les données ? Précisez les pays et régions concernés."),
    ("Données", "9.2", "Comment garantissez-vous la conformité au RGPD des traitements de données personnelles ?"),
    ("Données", "9.3", "Quelles sont vos règles de conservation et d'effacement sécurisé des données ?"),
    ("Ressources humaines", "10.1", "Vos collaborateurs suivent-ils une formation annuelle de sensibilisation à la sécurité ?"),
    ("Ressources humaines", "10.2", "Des vérifications d'antécédents sont-elles réalisées avant l'embauche ?"),
    ("Sécurité physique", "11.1", "Quelles mesures protègent l'accès physique à vos locaux et salles techniques ?"),
    ("Développement", "12.1", "La sécurité est-elle intégrée à votre cycle de développement logiciel ?"),
    ("Développement", "12.2", "Les environnements de développement, de test et de production sont-ils séparés ?"),
]


def build_sample_questionnaire() -> Path:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill

    target_dir = BASE_DIR / "exemples"
    target_dir.mkdir(exist_ok=True)
    target = target_dir / "questionnaire_securite_exemple.xlsx"

    wb = Workbook()
    ws = wb.active
    ws.title = "Questionnaire sécurité"

    ws["A1"] = "Questionnaire d'évaluation sécurité fournisseur — 2026"
    ws["A1"].font = Font(bold=True, size=14)
    ws["A2"] = "À compléter par le prestataire et à retourner sous 15 jours."
    ws["A2"].font = Font(italic=True, color="666666")

    headers = ["N°", "Domaine", "Question", "Réponse", "Commentaire"]
    for c, title in enumerate(headers, start=1):
        cell = ws.cell(row=4, column=c, value=title)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="0F2740")
        cell.alignment = Alignment(wrap_text=True, vertical="center")

    for r, (domain, ref, question) in enumerate(SAMPLE_ROWS, start=5):
        ws.cell(row=r, column=1, value=ref)
        ws.cell(row=r, column=2, value=domain)
        cell = ws.cell(row=r, column=3, value=question)
        cell.alignment = Alignment(wrap_text=True, vertical="top")

    for column, width in zip("ABCDE", (8, 22, 78, 60, 30)):
        ws.column_dimensions[column].width = width
    ws.freeze_panes = "A5"

    wb.save(target)
    print(f"Questionnaire d'exemple : {target}")
    return target


if __name__ == "__main__":
    seed()
    print("\nJeu de démonstration prêt. Lancez l'application avec run.bat.")
