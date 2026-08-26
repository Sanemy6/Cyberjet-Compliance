# Cyberjet Compliance — Réponse aux questionnaires sécurité

Application web de gouvernance et de mise en conformité cyber. Elle mémorise les
réponses de conformité propres à chaque client, puis les réutilise
automatiquement pour répondre aux questionnaires sécurité reçus.

**Architecture** — React 18 (TypeScript, Vite) · ASP.NET Core 9 · SQL Server.

Le moteur de rapprochement reste entièrement hors ligne : aucun appel réseau
sortant, aucun service tiers, aucune clé d'API. Les seules dépendances externes
sont le serveur SQL et, en développement, le registre npm et NuGet.

---

## Prérequis

| Composant | Version | Vérifier |
|---|---|---|
| [.NET SDK](https://dotnet.microsoft.com/download) | 9.0 ou plus | `dotnet --version` |
| [Node.js](https://nodejs.org) | 20 LTS ou plus | `node --version` |
| SQL Server | 2019 ou plus, **ou** LocalDB, **ou** Express | voir ci-dessous |

Pour un poste de développement, **SQL Server Express** suffit :

```powershell
winget install --id Microsoft.SQLServer.2022.Express -e   # PowerShell administrateur
```

Il crée l'instance `.\SQLEXPRESS`, qui est la valeur par défaut de
`appsettings.json` :

```
Server=.\SQLEXPRESS;Database=CyberjetCompliance;Trusted_Connection=True;TrustServerCertificate=True
```

Si vous utilisez plutôt **LocalDB** (fourni avec Visual Studio, charge de travail
« Stockage et traitement des données »), remplacez le serveur par
`(localdb)\MSSQLLocalDB`. Pour un serveur, voir « Déploiement » plus bas.

**Alternative sans rien installer dans Windows : Docker.** Utile sur un poste
sans droits administrateur, ou simplement pour valider l'application sans
laisser de trace sur la machine :

```powershell
docker run -d --name cyberjet-sql --restart unless-stopped `
  -e "ACCEPT_EULA=Y" -e "MSSQL_SA_PASSWORD=<mot-de-passe-fort>" -e "MSSQL_PID=Developer" `
  -p 1433:1433 mcr.microsoft.com/mssql/server:2022-latest
```

puis remplacez la chaîne de connexion par :

```
Server=localhost,1433;Database=CyberjetCompliance;User Id=sa;Password=<mot-de-passe-fort>;TrustServerCertificate=True
```

Docker Desktop doit tourner ; le conteneur redémarre avec lui grâce à
`--restart unless-stopped`. Pour tout effacer : `docker rm -f cyberjet-sql` — rien
ne subsiste sur le poste.

La base elle-même n'est pas à créer : l'API s'en charge au premier démarrage,
schéma compris — y compris sur une base déjà partiellement installée : les
colonnes qui manquent sont ajoutées, jamais celles qui existent déjà touchées.

---

## Lancer l'application

### En développement

```bat
run-dev.bat
```

Deux fenêtres s'ouvrent : l'API sur `http://localhost:5080` et le serveur Vite
sur `http://localhost:5173`. **Travaillez sur 5173** — Vite relaie `/api` vers
l'API, ce qui fait voir au navigateur une origine unique. Ce n'est pas un
confort : la session vit dans un cookie `SameSite=Lax`, que le navigateur
refuserait d'envoyer entre deux origines distinctes.

Les deux côtés rechargent à chaud (`dotnet watch` et le HMR de Vite).

### En production locale

```bat
run.bat
```

L'interface est compilée dans `server/Cyberjet.Api/wwwroot`, puis l'API la sert
elle-même. Une seule adresse, un seul processus : `http://localhost:5080`.

### Manuellement

```bat
cd client && npm ci && npm run build && cd ..
dotnet run --project server\Cyberjet.Api --configuration Release --urls http://0.0.0.0:5080
```

La base est créée si elle n'existe pas, le schéma est appliqué et les
référentiels sont chargés — le tout au démarrage, sans commande préalable.

---

## Première connexion

L'application est protégée par un compte administrateur. À la toute première
ouverture, elle affiche un formulaire de création de ce compte plutôt qu'un
écran de connexion. Ensuite, chaque personne se connecte avec son propre
identifiant — depuis **Comptes** (visible des administrateurs uniquement), on
ajoute ses collègues.

Toute personne connectée peut consulter et modifier les dossiers clients ; seul
le rôle administrateur gère qui a accès. La session dure 30 jours et se prolonge
à chaque usage.

---

## Reprise des données existantes

L'ancienne version stockait tout dans `data/grc.db` (SQLite). Un outil de
reprise transfère ce contenu vers SQL Server :

```bat
REM 1. Lancer l'API une fois : elle crée la base, le schéma et les référentiels.
dotnet run --project server\Cyberjet.Api

REM 2. Reprendre les données (l'API peut être arrêtée à ce stade).
REM    Reprenez la chaîne de connexion utilisée ci-dessus — celle-ci correspond
REM    au défaut SQL Server Express.
dotnet run --project tools\Cyberjet.Migration -- data\grc.db ^
  "Server=.\SQLEXPRESS;Database=CyberjetCompliance;Trusted_Connection=True;TrustServerCertificate=True"
```

Ce qui est repris : clients, réponses de référence et leurs rattachements
normatifs, configurations techniques, questionnaires et leurs questions,
comptes, codes de récupération, journal d'audit. **Les identifiants sont
conservés**, donc les liens entre objets restent valides.

Trois points à connaître :

- **Les mots de passe fonctionnent tels quels.** Le format de hachage est
  identique (PBKDF2-HMAC-SHA256, 260 000 itérations, sel par compte), tout comme
  les secrets TOTP : personne n'a à reconfigurer son second facteur.
- **Les sessions ne sont pas reprises.** Un jeton émis par l'ancienne
  application n'a pas à ouvrir l'accès à la nouvelle ; chacun se reconnecte une
  fois.
- **Les candidats mis en cache sont vidés.** Leur sérialisation a changé de
  casse ; ils se reconstruisent au premier « Relancer ». Les réponses proposées
  et validées, elles, sont intégralement conservées.

La reprise est transactionnelle et refuse de s'exécuter sur une base déjà
peuplée : en cas d'échec, rien n'est écrit.

Les fichiers de `data/uploads/` sont référencés par **chemin absolu** dans la
base. Laissez-les où ils sont, ou déplacez-les et réimportez les questionnaires
concernés — les nouveaux imports iront, eux, dans
`server/Cyberjet.Api/App_Data/uploads/`.

L'ancienne pile (FastAPI/Python et front en JavaScript vanille) a été retirée du
dépôt une fois le nouveau socle validé — elle reste consultable dans
l'historique Git si besoin. Seule sa base de données subsiste, dans
`data/grc.db`, en tant que source pour cette reprise.

---

## Vérification en deux étapes

Chacun active le second facteur sur son propre compte depuis **Sécurité**. Une
pastille orange y attire l'attention tant que ce n'est pas fait.

**Application d'authentification (TOTP).** Compatible Google Authenticator,
Microsoft Authenticator, Authy, 1Password, Bitwarden. On scanne un QR code — ou
on saisit la clé à la main si le poste n'a pas de caméra — puis on confirme avec
un premier code. Le calcul se fait hors ligne sur le téléphone : ni SMS, ni
réseau, ni service tiers.

**Codes de récupération.** Dix codes à usage unique sont remis à l'activation.
Ils ne sont affichés qu'une fois : seules leurs empreintes sont conservées,
personne ne peut les retrouver ensuite. La page Sécurité alerte quand il en
reste deux ou moins.

**En cas de téléphone perdu.** Sans code de récupération, un administrateur
réinitialise le second facteur depuis **Comptes** (icône ↻). Le compte redevient
protégé par son seul mot de passe et devra être reconfiguré ; l'opération est
journalisée avec le nom de l'administrateur qui l'a demandée.

Détails d'implémentation : TOTP conforme à la RFC 6238 (HMAC-SHA1, fenêtres de
30 s, tolérance d'une fenêtre pour la dérive d'horloge), anti-rejeu — un code
déjà consommé est refusé dans sa propre fenêtre. Désactiver le second facteur ou
régénérer les codes exige de resaisir son mot de passe : une session volée ne
doit pas suffire à retirer la protection qu'elle contourne. L'activation révoque
les autres sessions du compte.

### Clés d'accès (passkeys, biométrie) — indisponible

Les navigateurs n'exposent l'API des clés d'accès que dans un **contexte
sécurisé** : HTTPS, ou `localhost`. Servie en HTTP sur un réseau interne, la
fonction échouerait sur tous les postes distants — c'est-à-dire précisément le
cas d'usage visé. Mettre un certificat en place est le préalable à cette
méthode.

---

## Journal d'audit

Les administrateurs disposent d'un écran **Journal d'audit** : filtres par
famille d'événement, acteur, résultat et période, recherche libre, et export CSV
prêt pour Excel.

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
résultat, l'acteur, son adresse IP, son navigateur, l'objet concerné et un court
détail factuel.

**Ce qui n'est délibérément pas tracé.** Aucun mot de passe, aucun jeton de
session, aucun secret TOTP, aucun code de récupération — même haché ou tronqué.
Aucun contenu métier complet non plus : le journal retient la question et l'objet
touché, jamais le texte des réponses de conformité de vos clients. Les simples
consultations ne sont pas journalisées : à cette échelle, elles noieraient les
événements qui engagent réellement sans rien prouver d'utile.

**Écriture hors transaction.** Chaque trace est écrite dans sa propre
transaction, validée aussitôt. C'est indispensable sur les chemins d'échec :
une trace écrite dans la transaction de la requête partirait avec son annulation,
or ce sont précisément les échecs qu'un journal doit conserver.

**Conservation.** 365 jours, purgés au démarrage de l'application. La purge se
journalise elle-même — un trou dans le journal doit toujours être explicable.

**Limite à connaître.** Le journal est en ajout seul du point de vue de
l'application : aucun écran ne permet d'en modifier ou d'en supprimer une ligne.
En revanche, tout compte disposant de droits d'écriture sur la base peut
techniquement l'altérer. Pour une valeur probante opposable, restreignez les
droits du compte applicatif à `INSERT` sur `dbo.AuditLogs` et exportez
périodiquement le journal vers un stockage distinct en écriture unique.

---

## Ce que fait l'application

### Dossiers clients cloisonnés

Chaque client a sa base de réponses et ses configurations techniques. **Une
réponse rattachée à un client n'est jamais proposée pour un autre.** Seules les
entrées marquées *génériques* sont partagées entre tous les dossiers. Le
cloisonnement est appliqué à trois endroits : au filtrage de l'index, à la
composition de la réponse, et à l'application manuelle d'un candidat.

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

Le chargement est idempotent : au démarrage, l'API insère ce qui manque et
rafraîchit les libellés, sans jamais toucher aux rattachements existants.

### Formats de questionnaires

| Format | Extraction | Réinjection dans le fichier d'origine |
|---|---|---|
| Excel `.xlsx` `.xlsm` `.xls` | détection automatique des colonnes | **oui** |
| Word `.docx` | tableaux + paragraphes numérotés | non — export rapport |
| PDF | colonnes détectées par gouttières + items numérotés | non — export rapport |
| CSV / copier-coller | oui | non — export rapport |

Pour Excel, l'application repère la ligne d'en-tête puis les colonnes
Question / Réponse / Référence / Section par mots-clés, avec repli sur la colonne
au texte le plus long. Les coordonnées exactes sont mémorisées : c'est ce qui
permet de rendre au client **son propre fichier, complété**.

Pour le PDF, un document ne porte aucune structure — seulement des mots posés à
des coordonnées. Les mots sont regroupés en lignes par leur ligne de base, puis
on cherche des *gouttières* : des positions horizontales où plusieurs lignes
présentent toutes un blanc. Une gouttière partagée par un tiers des lignes est
une frontière de colonne. À défaut, le texte est découpé en items numérotés.
C'est une heuristique — un PDF à la mise en page inhabituelle peut demander de
passer par « Coller les questions ».

### Qui est en ligne

Un indicateur dans la barre supérieure affiche combien de personnes sont
connectées et qui elles sont — nom et rôle, rien de plus. Un clic ouvre la
liste, avec soi-même repéré en premier.

Il n'y a pas d'infrastructure de push (pas de WebSocket) : la présence est
déduite de l'activité récente plutôt que poussée en temps réel. Chaque requête
authentifiée horodate sa session (`AppSessions.LastSeenAt`) ; une session vue
dans les deux dernières minutes est considérée en ligne. Le navigateur
interroge `/api/presence` toutes les 30 secondes — cet appel étant lui-même
authentifié, il rafraîchit au passage la présence de la personne qui regarde
l'écran, sans endpoint de battement dédié. L'écart perçu reste de l'ordre de
quelques secondes, invisible en usage normal.

Accessible à toute personne connectée, comme la liste des clients : contrairement
au journal d'audit, la présence ne dit rien de ce que chacun a fait — seulement
qu'une session est ouverte.

---

## Le moteur de rapprochement

Entièrement hors ligne, sans modèle d'apprentissage ni dépendance lourde. Trois
signaux combinés, puis des modulateurs métier.

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
3. **Similarité par trigrammes** de caractères, qui rattrape fautes de frappe et
   variantes de formulation.

**Les modulateurs** — correspondance exacte de référence normative (+0,25) ;
réponse propre au client privilégiée sur une réponse générique ; statut de
validation de l'entrée ; amortissement de spécificité, qui empêche une question
d'un seul mot d'atteindre la confiance haute.

**Les seuils** : haute ≥ 0,62 · à vérifier ≥ 0,38 · faible ≥ 0,28. En dessous,
aucune réponse n'est proposée — mieux vaut une case vide qu'une suggestion hors
sujet, qui coûte plus cher à corriger qu'à écrire.

**Performance** — l'index est un index inversé : seuls les documents partageant
au moins un terme avec la question sont scorés. Il est conservé en mémoire dans
un service *singleton*, immuable une fois construit, donc partagé entre requêtes
concurrentes sans verrou. Il est invalidé par une empreinte dérivée de la base
(nombre d'entrées, dernier identifiant, dernière modification), si bien qu'une
modification faite hors de l'application est également détectée.

### Faire évoluer le moteur

Le levier le plus rentable est **`server/Cyberjet.Api/Services/Search/Thesaurus.cs`**.
Quand une question n'est pas reconnue alors que la réponse existe, c'est presque
toujours qu'un terme du client manque au vocabulaire :

- une expression multi-mots → ajoutez-la à `Phrases` ;
- un synonyme, un sigle, un anglicisme → ajoutez-le à la famille correspondante
  dans `SynonymGroups`.

Le fichier ne contient que des données, aucune logique. Les seuils et les
pondérations se règlent en tête de `SearchIndex.cs`.

---

## Structure du projet

```
Cyberjet Compliance/
├── Cyberjet.sln
├── run.bat                     production locale (build + serve)
├── run-dev.bat                 développement (API + Vite)
│
├── database/
│   └── schema.sql              DDL SQL Server, idempotent, relisible par un DBA
│
├── server/Cyberjet.Api/
│   ├── Program.cs              composition, pipeline, démarrage
│   ├── Controllers/            13 contrôleurs, un par ressource
│   ├── Contracts/              DTO d'entrée et de sortie, ApiException, Mapper
│   ├── Data/                   entités, DbContext, initialisation, référentiels
│   ├── Middleware/             contrôle d'accès global
│   └── Services/
│       ├── Search/             thésaurus, normalisation, index BM25, composition
│       ├── Parsing/            extraction Excel / Word / PDF / CSV
│       ├── Export/             réinjection Excel et rapport de synthèse
│       ├── Auth/               mots de passe, sessions, TOTP, anti-bruteforce
│       ├── AuditService.cs     catalogue d'événements et journalisation
│       └── StoragePaths.cs     emplacements des fichiers hors base
│
├── client/                     React 18 + TypeScript + Vite
│   └── src/
│       ├── api/                client HTTP, types du contrat, requêtes partagées
│       ├── components/         primitives d'interface, formulaires, coquille
│       ├── pages/              13 écrans
│       ├── lib/                formats, préférences, session
│       └── styles/app.css      design system, repris tel quel
│
├── server/Cyberjet.Api.Tests/  PBKDF2, TOTP, anti-bruteforce, garde anti-zip-bomb
├── tools/Cyberjet.Migration/   reprise SQLite → SQL Server
├── data/                       base SQLite de l'ancienne version, pour la reprise ponctuelle
└── exemples/                   questionnaire Excel de démonstration
```

Les questionnaires reçus et les exports produits vont dans
`server/Cyberjet.Api/App_Data/` (réglable par `Storage:DataDirectory`).

> Le dossier **ne doit pas** s'appeler `data` : Windows ignore la casse, et il
> entrerait en collision avec le dossier source `Data/`. Les fichiers clients
> atterriraient au milieu du code, et une règle `.gitignore` visant l'un
> exclurait l'autre — donc quatre fichiers source du back-end.

**Ce qu'il faut sauvegarder** : la base SQL Server (plan de sauvegarde habituel)
**et** le dossier `App_Data/`, qui contient les questionnaires reçus et les
exports produits. Les deux, pas l'un ou l'autre.

### Sauvegarde quotidienne

`tools/backup.ps1` sauvegarde les deux d'un coup. Pour le planifier :

```powershell
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\chemin\vers\tools\backup.ps1"'
Register-ScheduledTask -TaskName 'Cyberjet Compliance - Sauvegarde quotidienne' `
    -Action $action -Trigger (New-ScheduledTaskTrigger -Daily -At '12:30') `
    -Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable)
```

Les archives vont dans `C:\Sauvegardes\Cyberjet` (paramètre `-Destination`),
réparties en `quotidiennes/` et `mensuelles/`. La rétention suit un schéma
grand-père / père / fils : **30 sauvegardes quotidiennes** et **12 mensuelles**
— on remonte ainsi à n'importe quel jour du mois écoulé et à la fin de chaque
mois sur l'année, sans conserver 365 copies. Chaque exécution ajoute une ligne
à `journal.log` : lancé par le planificateur, le script n'a pas de console où
se plaindre, et une sauvegarde qui échoue en silence pendant des semaines est
pire que pas de sauvegarde du tout.

Deux points valent d'être connus :

- **`BACKUP DATABASE` s'exécute sous le compte du service SQL Server**, pas sous
  celui qui lance le script. Le dossier de destination doit donc lui être ouvert
  en écriture ; le script s'en charge à la première exécution. Cela explique
  aussi pourquoi le dossier de sauvegarde de l'instance n'est, lui, pas lisible
  depuis une session ordinaire.
- **Une sauvegarde sur le même disque que l'application ne protège que de
  l'erreur humaine et de la corruption logique.** Ni d'une panne de disque, ni
  d'un vol du poste, ni d'un rançongiciel — qui chiffrerait les sauvegardes avec
  le reste. Passez `-Destination` vers un lecteur réseau ou un disque externe
  dès que possible.

### Restaurer

```powershell
# 1. Arrêter l'application (le service, ou la fenêtre run.bat).
# 2. Restaurer la base — REPLACE écrase la base existante.
sqlcmd -S .\SQLEXPRESS -E -C -Q "RESTORE DATABASE [CyberjetCompliance] FROM DISK = N'C:\Sauvegardes\Cyberjet\quotidiennes\CyberjetCompliance_2026-08-24_1230.bak' WITH REPLACE;"

# 3. Restaurer les fichiers, du même horodatage que la base.
Expand-Archive 'C:\Sauvegardes\Cyberjet\quotidiennes\App_Data_2026-08-24_1230.zip' `
               -DestinationPath 'C:\Apps\Cyberjet\App_Data' -Force
```

Prenez toujours **la base et l'archive du même horodatage** : un questionnaire
présent en base dont le fichier manque sur disque ne s'ouvre plus.

Une sauvegarde qu'on n'a jamais restaurée n'est qu'une hypothèse. Pour la
vérifier sans toucher à la production, restaurez sous un autre nom
(`RESTORE DATABASE [CyberjetTest] ... WITH MOVE`), comparez quelques
décomptes, puis supprimez la base de test.

### Tests

```powershell
dotnet test server\Cyberjet.Api.Tests
```

Couvre les composants où une régression silencieuse serait la plus coûteuse :
hachage des mots de passe (PBKDF2), second facteur (TOTP, y compris le
anti-rejeu), verrouillage anti-bruteforce, et la garde qui rejette une archive
Office anormalement compressible avant de la faire analyser par ClosedXML ou
OpenXml.

---

## Déploiement

### Chaîne de connexion

Ne modifiez pas `appsettings.json` sur le serveur. Utilisez plutôt une variable
d'environnement, qui prime sur le fichier et ne risque pas de partir dans un
commit :

```powershell
$env:ConnectionStrings__Default = "Server=SQL01;Database=CyberjetCompliance;User Id=cyberjet_app;Password=...;Encrypt=True"
```

Le compte applicatif n'a besoin que de `db_datareader`, `db_datawriter` et du
droit d'exécuter le DDL au premier démarrage. Une fois le schéma en place, le
droit DDL peut être retiré.

### Service Windows

Une fenêtre de terminal qu'un collègue peut fermer par erreur n'est pas fiable
pour un usage partagé. La solution simple sous Windows est
[NSSM](https://nssm.cc/) :

```powershell
# 1. Publier l'application
dotnet publish server\Cyberjet.Api -c Release -o C:\Apps\Cyberjet
#    (npm run build doit avoir été lancé avant : wwwroot part avec la publication)

# 2. Enregistrer le service
nssm install Cyberjet-Compliance "C:\Apps\Cyberjet\Cyberjet.Api.exe"
nssm set Cyberjet-Compliance AppDirectory "C:\Apps\Cyberjet"
nssm set Cyberjet-Compliance AppEnvironmentExtra ASPNETCORE_URLS=http://0.0.0.0:5080
nssm set Cyberjet-Compliance Start SERVICE_AUTO_START
nssm start Cyberjet-Compliance
```

Le service démarre avec Windows, redémarre si le processus s'arrête, et ne
dépend d'aucune session utilisateur ouverte.

### Pare-feu

```powershell
New-NetFirewallRule -DisplayName "Cyberjet Compliance" -Direction Inbound `
    -Protocol TCP -LocalPort 5080 -Action Allow
```

### Ce qu'il faut savoir avant d'ouvrir l'accès

- **Le trafic circule en clair (HTTP), y compris les mots de passe à la
  connexion.** Sur un réseau d'entreprise cloisonné, c'est souvent un compromis
  acceptable ; si ce n'est pas le cas chez vous, placez un reverse proxy TLS
  devant (IIS avec un certificat interne, ou Caddy) et posez
  `Security:RequireSecureCookies` à `true` (variable d'environnement
  `Security__RequireSecureCookies=true`) : le cookie de session sera alors
  marqué `Secure` de façon garantie, sans dépendre de ce que la requête
  entrante affirme sur son propre protocole — un en-tête `X-Forwarded-Proto` mal
  propagé par le proxy ne peut plus faire douter l'application.
- **Chiffrez le volume qui porte `App_Data/`.** Les questionnaires reçus et les
  exports produits contiennent des réponses de conformité (architecture,
  chiffrement, MFA du client) et sont stockés en clair sur le système de
  fichiers — ClosedXML, OpenXml et PdfPig exigent un chemin disque lisible, un
  chiffrement applicatif fichier par fichier n'est donc pas praticable sans
  repasser par un fichier temporaire déchiffré à chaque lecture. Le chiffrement
  au repos se fait donc au niveau du support : **BitLocker** sur le volume
  Windows qui héberge `App_Data/`, ou **LUKS/dm-crypt** sous Linux. Ni la base
  SQL Server ni le code applicatif n'ont besoin d'en savoir quoi que ce soit —
  seule l'infrastructure de déploiement porte cette exigence.
- **SQL Server change la donne sur la concurrence.** Contrairement à SQLite, il
  encaisse sans difficulté des dizaines d'utilisateurs simultanés en écriture.
  C'est le principal gain de la bascule côté exploitation.
- **Sauvegardez la base et `data/`.** Les questionnaires reçus ne sont pas en
  base : ils sont sur disque, et référencés par chemin. Une sauvegarde d'un
  volume déjà chiffré par BitLocker/LUKS reste chiffrée si elle est restaurée
  sur un volume équivalent ; vérifiez que votre outil de sauvegarde préserve
  bien cette propriété plutôt que d'écrire les fichiers en clair à côté.

---

## Notes techniques

- **Tableau de bord personnalisable.** Les neuf blocs (jauge de couverture,
  quatre chiffres clés, prochaine étape, questionnaires récents, répartition
  par domaine, réponses les plus réutilisées) sont chacun un widget identifié
  par une clé stable. Un administrateur choisit depuis **Personnaliser**
  (bouton du tableau de bord) lesquels afficher et dans quel ordre — liste
  glisser-déposer, pas une grille libre : la mise en page finale (jauge et
  chiffres côte à côte, colonnes de listes) reste calculée automatiquement
  selon le type de widget, pas au pixel près. Un seul agencement, commun à
  toute l'organisation — ce n'est pas une préférence de compte comme le thème,
  c'est ce que l'équipe a décidé de mettre en avant. Stocké dans
  `AppSettings` (clé `dashboard.layout`) au même titre que le délai de
  session ; sans agencement enregistré, ou si un widget venait à manquer
  d'une réponse serveur en retard, tout s'affiche plutôt que de faire
  disparaître une section sans explication.
- **Visite guidée à la première connexion.** Cinq bulles superposées à
  l'interface réelle — navigation, traitement d'un questionnaire, assistant,
  recherche rapide, menu de compte — ciblent leurs éléments via un attribut
  `data-tour="…"` posé sur le composant concerné, jamais un sélecteur de texte
  ou de position, qui casserait au premier changement de libellé. Se propose
  tant que `AppUsers.OnboardedAt` est nul ; vue jusqu'au bout ou passée
  comptent pareil pour ne plus jamais la reproposer. Le thème par défaut d'un
  compte neuf est **clair**, pas « automatique » : le thème système du premier
  poste où quelqu'un se connecte ne dit rien de sa préférence, et un tableau de
  bord sombre au tout premier écran surprend plus qu'il ne rassure — chacun
  peut toujours choisir Auto ou Sombre ensuite.
- **Authentification par session serveur.** Mots de passe hachés
  PBKDF2-HMAC-SHA256, 260 000 itérations, sel de 16 octets par compte,
  comparaison en temps constant. Les sessions sont stockées en base plutôt que
  dans un JWT : une session se révoque alors immédiatement — désactivation d'un
  compte, changement de mot de passe, déconnexion à distance — sans dépendre
  d'une expiration qu'on ne peut pas rattraper.
- **Verrouillage anti-bruteforce** par couple identifiant + adresse IP, en
  mémoire : **5 échecs** ferment la porte pendant une fenêtre glissante de
  **15 minutes**. Glissante, donc chaque tentative expire quinze minutes après
  avoir eu lieu, et le déblocage suit la plus ancienne des tentatives retenues
  — pas la dernière. Le message annonce le délai restant plutôt qu'un vague
  « réessayez plus tard », qui pousse à retenter au hasard. Réessayer pendant
  le blocage ne le prolonge pas : la requête s'arrête avant d'être comptée.
  L'écran **Comptes** montre l'état et le temps restant, et un administrateur
  peut lever le verrou sans attendre — le geste est journalisé, débloquer
  revenant à retirer ce qui ralentit une attaque par force brute. Réinitialiser
  le mot de passe de quelqu'un le libère aussi : le nouveau mot de passe ne
  servirait à rien si le compte restait dehors. Le compteur vivant en mémoire,
  un redémarrage de l'API le remet à zéro — c'est le dernier recours si le seul
  administrateur s'est verrouillé lui-même.
- **Fermeture de session pour inactivité.** Deux échéances coexistent : une
  échéance absolue de 30 jours, glissante, et un délai d'inactivité de
  30 minutes que les administrateurs règlent depuis l'écran **Comptes**, entre
  5 minutes et 12 heures (ou 0 pour le désactiver). Le changement prend effet
  immédiatement, sans redémarrage. `Security:SessionIdleTimeoutMinutes` dans
  `appsettings.json` ne fournit plus que la valeur initiale : dès qu'un
  réglage est posé depuis l'interface, il est stocké en base et prime — sans
  quoi il serait perdu au prochain déploiement. Le serveur est seul juge — il
  ferme la session dès qu'aucune
  requête authentifiée ne lui parvient pendant ce délai, et supprime le jeton
  plutôt que de simplement le refuser. L'interface prévient deux minutes avant
  l'échéance et propose de rester connecté ; ce bouton émet une vraie requête,
  sans quoi il ne ferait que remettre à zéro un compteur local pendant que la
  session expire côté serveur. Corollaire moins évident : le sondage de
  présence, authentifié lui aussi, s'interrompt après une minute sans geste de
  la personne — laissé libre, il repousserait l'échéance indéfiniment et aucun
  poste ne se fermerait jamais.
- **Contrôle d'accès en liste explicite.** Les quatre endpoints publics sont
  énumérés un par un dans `AuthGateMiddleware`. Un préfixe `/api/auth/*` aurait
  rendu public tout endpoint ajouté plus tard sous ce préfixe — l'enrôlement du
  second facteur, par exemple — sans que personne ne s'en aperçoive.
- **Schéma appliqué par script, pas par migration EF.** Le DDL de
  `database/schema.sql` est idempotent et exécuté au démarrage. Le schéma est
  petit et stable, il doit rester relisible par un DBA, et l'application doit
  pouvoir s'installer seule sur une base vide. Le script sait aussi évoluer une
  base déjà installée : une colonne ajoutée après coup (`AppSessions.LastSeenAt`,
  par exemple) est posée par un `ALTER TABLE` gardé par un test d'existence,
  sans jamais toucher aux tables déjà à niveau. Adopter les migrations EF plus
  tard reste possible : générer une migration initiale et la marquer comme déjà
  appliquée.
- **Documentation interactive de l'API** : `/swagger` en développement
  (nécessite d'être connecté).
- **Dépendances côté serveur** : EF Core (SQL Server), ClosedXML et
  DocumentFormat.OpenXml (Excel/Word), PdfPig (PDF), QRCoder (QR d'enrôlement en
  SVG), System.Text.Encoding.CodePages (lecture des CSV en Windows-1252),
  Swashbuckle. Le hachage, le TOTP et le moteur de rapprochement ne reposent que
  sur la bibliothèque standard.
- **Dépendances côté client** : React, React Router, TanStack Query. Aucune
  bibliothèque de composants ni d'icônes : la feuille de style et le jeu
  d'icônes sont ceux du produit.
