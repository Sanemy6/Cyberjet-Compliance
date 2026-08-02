# Conformité — Réponse aux questionnaires sécurité

Application web locale pour la gouvernance et la mise en conformité cyber.
Elle mémorise les réponses de conformité propres à chaque client, puis les
réutilise automatiquement pour répondre aux questionnaires sécurité reçus.

**Tout est traité sur ce poste.** Aucun appel réseau, aucun service tiers,
aucune clé d'API. Les données ne quittent jamais la machine.

---

## Lancer l'application

Double-cliquez sur **`run.bat`**.

Au premier lancement, le script crée l'environnement Python et installe les
dépendances (environ une minute). Ensuite le navigateur s'ouvre seul sur
<http://127.0.0.1:8077>.

Pour arrêter : fermez la fenêtre noire, ou `Ctrl+C` dedans.

```bat
run.bat            :: lancer
run.bat --demo     :: recharger le jeu de démonstration, puis lancer
```

Depuis un terminal, l'équivalent manuel :

```bat
.venv\Scripts\python.exe -m uvicorn app.main:app --port 8077
```

---

## Première connexion

L'application est protégée par un compte administrateur. À la toute première
ouverture (sur ce poste ou sur un serveur), elle affiche un formulaire de
création de ce compte plutôt qu'un questionnaire. Ensuite, chaque personne se
connecte avec son propre identifiant — depuis **Comptes** (visible des
administrateurs uniquement), on ajoute ses collègues.

Toute personne connectée peut consulter et modifier les dossiers clients ;
seul le rôle administrateur gère qui a accès. La session dure 30 jours et se
prolonge à chaque usage : sur un poste personnel, on ne redemande quasiment
jamais de se reconnecter.

## Vérification en deux étapes

Chacun active le second facteur sur son propre compte depuis **Sécurité**
(barre latérale). Une pastille orange y attire l'attention tant que ce n'est
pas fait.

**Application d'authentification (TOTP).** Compatible Google Authenticator,
Microsoft Authenticator, Authy, 1Password, Bitwarden. On scanne un QR code —
ou on saisit la clé à la main si le poste n'a pas de caméra — puis on confirme
avec un premier code. Le calcul se fait hors ligne sur le téléphone : ni SMS,
ni réseau, ni service tiers.

**Codes de récupération.** Dix codes à usage unique sont remis à l'activation.
Ils ne sont affichés qu'une fois : seules leurs empreintes sont conservées,
personne ne peut les retrouver ensuite. À ranger dans un gestionnaire de mots
de passe ou à imprimer, hors de l'ordinateur. La page Sécurité alerte quand il
en reste deux ou moins.

**En cas de téléphone perdu.** Sans code de récupération, un administrateur
réinitialise le second facteur depuis **Comptes** (icône ↻ sur la ligne du
compte). Le compte redevient protégé par son seul mot de passe et devra être
reconfiguré ; l'opération est journalisée avec le nom de l'administrateur qui
l'a demandée.

Détails d'implémentation : TOTP conforme à la RFC 6238 (HMAC-SHA1, fenêtres de
30 s, tolérance d'une fenêtre pour la dérive d'horloge), anti-rejeu — un code
déjà consommé est refusé dans sa propre fenêtre. Désactiver le second facteur
ou régénérer les codes exige de resaisir son mot de passe : une session volée
ne doit pas suffire à retirer la protection qu'elle contourne. L'activation
révoque les autres sessions du compte, qui repassent alors par le second
facteur.

### Clés d'accès (passkeys, biométrie) — indisponible

Les navigateurs n'exposent l'API des clés d'accès que dans un **contexte
sécurisé** : HTTPS, ou `localhost`. Cette application est servie en HTTP sur
le réseau local, donc la fonction échouerait sur tous les postes distants —
c'est-à-dire précisément le cas d'usage visé. Mettre un certificat en place
(voir « Déploiement en réseau local ») est le préalable à cette méthode.

## Journal d'audit

Les administrateurs disposent d'un écran **Journal d'audit** : filtres par
famille d'événement, acteur, résultat et période, recherche libre, et export
CSV prêt pour Excel — utile comme pièce à joindre à un dossier d'audit.

Le périmètre suit les recommandations usuelles (OWASP Logging Cheat Sheet,
ISO/IEC 27001:2022 A.8.15, guide ANSSI sur la journalisation), ramenées au
strict nécessaire.

**Ce qui est tracé**

| Famille | Événements |
|---|---|
| Authentification | connexions réussies et échouées, déconnexions, verrouillages |
| Second facteur | activation, désactivation, échecs, code de récupération utilisé, réinitialisation par un administrateur |
| Comptes | création, suppression, mot de passe modifié, droits d'administration, désactivation |
| Données | création, modification, suppression des clients, réponses, configurations et questionnaires |
| Exports | chaque génération de fichier — toute sortie de données hors de l'outil |

Chaque entrée porte l'horodatage UTC, le code et le libellé de l'événement, le
résultat, l'acteur, son adresse IP, son navigateur, l'objet concerné et un
court détail factuel.

**Ce qui n'est délibérément pas tracé.** Aucun mot de passe, aucun jeton de
session, aucun secret TOTP, aucun code de récupération — même haché ou tronqué.
Aucun contenu métier complet non plus : le journal retient la question et
l'objet touché, jamais le texte des réponses de conformité de vos clients.
Les simples consultations ne sont pas journalisées : à cette échelle, elles
noieraient les événements qui engagent réellement sans rien prouver d'utile.

**Conservation.** 365 jours, purgés au démarrage de l'application. La purge se
journalise elle-même — un trou dans le journal doit toujours être explicable.

**Limite à connaître.** Le journal est en ajout seul du point de vue de
l'application : aucun écran ne permet d'en modifier ou d'en supprimer une
ligne. En revanche, toute personne ayant accès au fichier `data/grc.db` sur le
serveur peut techniquement l'altérer. Pour une valeur probante opposable, il
faudrait exporter périodiquement le journal vers un stockage distinct en
écriture unique.

## Prise en main en 5 minutes

Le jeu de démonstration est déjà chargé : deux clients aériens, 28 réponses de
référence rattachées aux contrôles normatifs, et 22 configurations techniques
pour *Nordic Wings Airlines*.

1. **Assistant réponse** — posez une question comme un client la formulerait :
   *« Quel type de chiffrement est en place pour les données au repos ? »*.
   La réponse est composée à partir des configurations du client.
   Essayez aussi en anglais : *« What encryption is used for data in transit? »*.

2. **Questionnaires → Téléverser** — prenez
   `exemples/questionnaire_securite_exemple.xlsx`, choisissez *Nordic Wings
   Airlines*. Les 30 questions sont extraites, puis chacune reçoit une
   proposition avec un niveau de confiance.

3. **Revue** — validez en masse les propositions à haute confiance, ajustez les
   autres, puis **Exporter → le fichier du client, complété** : les réponses
   sont réécrites dans le classeur Excel d'origine, à leur emplacement exact.

4. **Boucle d'apprentissage** — quand vous rédigez une réponse manquante,
   cliquez sur *Verser dans la base*. Elle servira pour tous les questionnaires
   suivants.

---

## Ce que fait l'application

### Dossiers clients cloisonnés

Chaque client a sa base de réponses et ses configurations techniques. **Une
réponse rattachée à un client n'est jamais proposée pour un autre.** Seules les
entrées marquées *génériques* sont partagées entre tous les dossiers.

### Configurations techniques

Les faits précis du client — algorithme de chiffrement au repos, version TLS en
transit, solution de MFA, RTO/RPO, hébergeur — sont saisis une fois et injectés
directement dans les réponses. Quand une réponse générique de principe est
retenue, les configurations correspondantes y sont ajoutées en précisions.

### Référentiels pré-chargés

| Référentiel | Version | Contrôles |
|---|---|---|
| EASA Part-IS | Règl. (UE) 2023/203, Annexe II | 14 |
| ISO/IEC 27001 Annexe A | 2022 | 93 |
| Directive NIS 2 | (UE) 2022/2555, art. 20–23 | 13 |
| DORA | Règl. (UE) 2022/2554 | 15 |
| SOC 2 Trust Services Criteria | 2017 (rév. 2022) | 38 |

Rattacher une réponse à `IS.I.OR.205` ou `A.8.24` la fait remonter en priorité
dès qu'un questionnaire cite cette référence.

### Volumétrie

L'écran **Volumétrie** répond à deux questions : *combien ça pèse* et *que
reste-t-il à saisir*. Il affiche l'occupation disque détaillée, la croissance
mensuelle de la base, la couverture des référentiels, et surtout une liste
d'actions triée par urgence — par exemple les réponses rédigées à la main
pendant une revue mais jamais versées dans la base, qu'il faudra réécrire au
client suivant.

**Le stockage n'est pas un facteur limitant.** Mesures relevées avec des
réponses de longueur réaliste (75 mots) :

| Réponses en base | Base sur disque | Questionnaire de 60 questions |
|---:|---:|---:|
| 250 | 0,3 Mo | 0,4 s |
| 1 000 | 0,9 Mo | 1,4 s |
| 2 500 | 2,1 Mo | 3,7 s |
| 5 000 | 4,1 Mo | 7,4 s |
| 10 000 | 8,0 Mo | 15,0 s |

Soit environ **840 octets par réponse**. C'est le temps de traitement qui
croît, linéairement, et il reste confortable bien au-delà des volumes
réalistes. La dernière colonne mesure un démarrage à froid : l'index est
ensuite gardé en mémoire, et n'est reconstruit que si le contenu change.

### Formats de questionnaires

| Format | Extraction | Réinjection dans le fichier d'origine |
|---|---|---|
| Excel `.xlsx` `.xlsm` `.xls` | détection automatique des colonnes | **oui** |
| Word `.docx` | tableaux + paragraphes numérotés | non — export rapport |
| PDF | tableaux + items numérotés | non — export rapport |
| CSV / copier-coller | oui | non — export rapport |

Pour Excel, l'application repère la ligne d'en-tête puis les colonnes
Question / Réponse / Référence / Section par mots-clés, avec repli sur la
colonne au texte le plus long. Les coordonnées exactes sont mémorisées : c'est
ce qui permet de rendre au client **son propre fichier, complété**.

---

## Le moteur de rapprochement

Entièrement hors ligne, sans modèle d'apprentissage ni dépendance lourde.
Trois signaux combinés, puis des modulateurs métier.

**Normalisation bilingue FR/EN** — repli des accents, ~180 expressions
multi-mots ramenées à un jeton unique (« au repos » → `atrest`,
« authentification multifacteur » → `mfa`), tolérante aux pluriels et aux
élisions ; thésaurus cybersécurité de ~60 familles de synonymes qui unifie
français et anglais (`cryptage` = `encryption` = `chiffrement`) ; retrait des
mots vides, y compris les tournures interrogatives — une question contient
toujours « quel » ou « décrivez », une réponse jamais.

**Les trois signaux**

1. **BM25** sur des fréquences de termes pondérées par champ : la question pèse
   trois fois plus que le corps de la réponse.
2. **Couverture pondérée par l'IDF** — retrouver « chiffrement au repos » vaut
   bien plus que retrouver « données ».
3. **Similarité par trigrammes** de caractères, qui rattrape fautes de frappe
   et variantes de formulation.

**Les modulateurs** — correspondance exacte de référence normative (+0,25) ;
réponse propre au client privilégiée sur une réponse générique ; statut de
validation de l'entrée ; amortissement de spécificité, qui empêche une question
d'un seul mot d'atteindre la confiance haute.

**Les seuils** : haute ≥ 0,62 · à vérifier ≥ 0,38 · faible ≥ 0,28. En dessous,
aucune réponse n'est proposée — mieux vaut une case vide qu'une suggestion hors
sujet, qui coûte plus cher à corriger qu'à écrire.

**Performance** — l'index est un index inversé : seuls les documents partageant
au moins un terme avec la question sont scorés. Il est conservé en mémoire et
invalidé par une empreinte dérivée de la base (nombre d'entrées, dernier
identifiant, dernière modification), si bien qu'une modification faite hors de
l'application est également détectée.

---

## Déploiement en réseau local, à plusieurs

Par défaut (`run.bat`), le serveur écoute sur toutes les interfaces
(`0.0.0.0:8077`) : il est donc déjà joignable depuis le réseau local, à
l'adresse IP du poste qui l'exécute — `run.bat` l'affiche au démarrage
(« Depuis le réseau : http://... »). Ce qui reste à faire dépend de l'usage
visé.

### Pare-feu Windows

Le port doit être explicitement autorisé en entrée, sinon seul le poste local
y accède :

```powershell
New-NetFirewallRule -DisplayName "GRC App" -Direction Inbound -Protocol TCP `
    -LocalPort 8077 -Action Allow
```

### Faire tourner l'application en continu (serveur dédié)

Une fenêtre de terminal qu'un collègue peut fermer par erreur n'est pas fiable
pour un usage partagé. La solution simple sous Windows est
[NSSM](https://nssm.cc/) (Non-Sucking Service Manager), qui transforme la
commande en véritable service Windows :

```powershell
# 1. Copier le dossier GRC entier sur le serveur, ex. C:\Apps\GRC
# 2. Lancer run.bat une fois manuellement pour créer .venv et installer les dépendances
# 3. Télécharger NSSM (nssm.cc), puis :
nssm install GRC-App "C:\Apps\GRC\.venv\Scripts\python.exe" `
    "-m uvicorn app.main:app --host 0.0.0.0 --port 8077"
nssm set GRC-App AppDirectory "C:\Apps\GRC"
nssm set GRC-App Start SERVICE_AUTO_START
nssm start GRC-App
```

Le service démarre alors avec Windows, redémarre si le processus s'arrête, et
ne dépend d'aucune session utilisateur ouverte.

### Ce qu'il faut savoir avant d'ouvrir l'accès

- **Le trafic circule en clair (HTTP), pas chiffré**, y compris les mots de
  passe à la connexion. Sur un réseau local d'entreprise cloisonné, c'est
  souvent un compromis acceptable ; si ce n'est pas le cas chez vous, placez
  un reverse proxy TLS devant (IIS avec un certificat interne, ou Caddy) —
  cela ne change rien à l'application elle-même, seulement à ce qui l'expose.
- **SQLite gère bien un petit nombre d'utilisateurs simultanés** (mode WAL,
  déjà activé) : quelques personnes qui consultent et modifient en même temps
  ne posent pas de problème. Ce n'est pas le choix technique pour des dizaines
  d'utilisateurs concurrents en écriture intensive.
- **Sauvegardez `data/`** régulièrement — c'est le seul dossier qui contient
  des données, désormais partagées entre plusieurs personnes, donc plus
  coûteuses à perdre.

## Structure du projet

```
GRC/
├── run.bat                  lanceur Windows
├── requirements.txt
├── app/
│   ├── main.py              API FastAPI + service de la SPA
│   ├── db.py                schéma SQLite, migrations et accès
│   ├── auth.py              mots de passe, sessions, TOTP, codes de récupération
│   ├── audit.py             catalogue d'événements et journalisation
│   ├── search.py            moteur de rapprochement
│   ├── textproc.py          normalisation, désuffixation, références
│   ├── thesaurus.py         vocabulaire métier GRC (données pures)
│   ├── frameworks.py        référentiels et contrôles
│   ├── parsers.py           extraction Excel / Word / PDF / CSV
│   ├── export.py            réinjection Excel et rapport de synthèse
│   └── seed_demo.py         jeu de démonstration
├── web/                     interface (HTML + CSS + JS, sans build)
├── exemples/                questionnaire Excel de démonstration
└── data/                    base SQLite, fichiers reçus, exports
```

**Vos données vivent dans `data/`** : `grc.db` (tout le contenu métier),
`uploads/` (questionnaires reçus), `exports/` (fichiers produits). Sauvegardez
ce dossier — c'est le seul à sauvegarder.

L'interface est écrite en JavaScript standard sans étape de compilation :
modifier un fichier de `web/` et recharger la page suffit.

---

## Faire évoluer le moteur

Le levier le plus rentable est **`app/thesaurus.py`**. Quand une question n'est
pas reconnue alors que la réponse existe, c'est presque toujours qu'un terme du
client manque au vocabulaire :

- une expression multi-mots → ajoutez-la à `PHRASES` ;
- un synonyme, un sigle, un anglicisme → ajoutez-le à la famille correspondante
  dans `SYNONYM_GROUPS`.

Le fichier ne contient que des données, aucune logique. Relancez l'application
pour prendre en compte les ajouts.

Les seuils et les pondérations se règlent en tête de `app/search.py`.

---

## Notes techniques

- Python 3.11+ (validé sur 3.14). Aucun autre prérequis : ni Node.js, ni base
  de données à installer, ni connexion Internet à l'usage.
- Le serveur écoute sur toutes les interfaces (`0.0.0.0:8077`) : accessible
  depuis le réseau local dès le lancement, protégé par le compte créé à la
  première ouverture. Voir « Déploiement en réseau local » ci-dessus.
- Authentification par session (mots de passe hachés PBKDF2-HMAC-SHA256,
  260 000 itérations ; sessions stockées côté serveur, donc révocables
  immédiatement ; verrouillage anti-bruteforce par identifiant + adresse IP).
  Second facteur TOTP optionnel par compte, avec codes de récupération.
  Tout utilisateur connecté peut consulter et modifier les dossiers clients ;
  seul le rôle administrateur gère les comptes et consulte le journal d'audit.
- Aucune dépendance cryptographique supplémentaire : TOTP et hachage reposent
  sur la bibliothèque standard. Seul `qrcode` est ajouté, en Python pur, pour
  produire le QR d'enrôlement en SVG.
- Documentation interactive de l'API : <http://127.0.0.1:8077/docs> (nécessite
  d'être connecté).
