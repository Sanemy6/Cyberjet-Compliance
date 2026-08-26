/* ---------------------------------------------------------------------------
   Requêtes d'exploration de la base CyberjetCompliance.
   Fichier de travail : rien ici n'est exécuté par l'application.

   Dans VS Code : Ctrl+Shift+E pour choisir la connexion, puis Ctrl+Shift+E
   à nouveau (ou clic droit → Execute Query) pour exécuter la requête sous
   le curseur. Connexion : serveur « .\SQLEXPRESS », authentification Windows.
   --------------------------------------------------------------------------- */

/* Vue d'ensemble : combien de lignes dans chaque table qui porte des données
   saisies, par opposition aux référentiels chargés au démarrage. */
SELECT 'Clients'                AS TableName, COUNT(*) AS Lignes FROM dbo.Clients
UNION ALL SELECT 'AppUsers',               COUNT(*) FROM dbo.AppUsers
UNION ALL SELECT 'Questionnaires',         COUNT(*) FROM dbo.Questionnaires
UNION ALL SELECT 'QuestionnaireQuestions', COUNT(*) FROM dbo.QuestionnaireQuestions
UNION ALL SELECT 'KbEntries',              COUNT(*) FROM dbo.KbEntries
UNION ALL SELECT 'ConfigItems',            COUNT(*) FROM dbo.ConfigItems
UNION ALL SELECT 'AuditLogs',              COUNT(*) FROM dbo.AuditLogs
ORDER BY TableName;


/* Les clients, du plus récemment modifié au plus ancien. */
SELECT Id, Name, Status, Country, Contact, CreatedAt, UpdatedAt
FROM dbo.Clients
ORDER BY UpdatedAt DESC;


/* Les comptes. PasswordHash, PasswordSalt et TotpSecret sont volontairement
   exclus : ils n'ont aucune raison de s'afficher à l'écran, même pour un
   administrateur de la base. */
SELECT Id, Username, IsAdmin, Active, TotpEnabled, Email, FirstName, LastName,
       CreatedAt, LastLoginAt
FROM dbo.AppUsers
ORDER BY Username;


/* Avancement des questionnaires : ce que l'écran d'accueil résume. */
SELECT q.Id,
       c.Name                                              AS Client,
       q.Name                                              AS Questionnaire,
       q.FileType,
       q.Status,
       COUNT(x.Id)                                         AS Questions,
       SUM(CASE WHEN x.Status = 'validated' THEN 1 ELSE 0 END) AS Validees,
       SUM(CASE WHEN x.Status = 'na'        THEN 1 ELSE 0 END) AS NonApplicables,
       q.UpdatedAt
FROM dbo.Questionnaires q
JOIN dbo.Clients c              ON c.Id = q.ClientId
LEFT JOIN dbo.QuestionnaireQuestions x ON x.QuestionnaireId = q.Id
GROUP BY q.Id, c.Name, q.Name, q.FileType, q.Status, q.UpdatedAt
ORDER BY q.UpdatedAt DESC;


/* Les questions d'un questionnaire donné, avec la réponse retenue.
   L'identifiant se lit dans la colonne Id de la requête précédente — les
   questionnaires ne sont pas numérotés à partir de 1, la reprise des données
   ayant conservé les identifiants d'origine. */
DECLARE @questionnaireId INT = 1003;

SELECT Idx, Ref, Section,
       LEFT(Text, 120)                                AS Question,
       Status,
       LEFT(COALESCE(FinalAnswer, SuggestedAnswer), 120) AS Reponse
FROM dbo.QuestionnaireQuestions
WHERE QuestionnaireId = @questionnaireId
ORDER BY Idx;


/* Journal d'audit — les 50 derniers événements. C'est ici que se lisent les
   connexions refusées, les accès refusés et les exports. */
SELECT TOP 50 Id, At, Event, Outcome, ActorName, Ip, TargetType, TargetLabel, Detail
FROM dbo.AuditLogs
ORDER BY At DESC, Id DESC;


/* Événements de sécurité des dernières 24 heures, par type. Une ligne qui
   grimpe sur access.denied ou auth.login.failure mérite un regard. */
SELECT Event, COUNT(*) AS Occurrences, MAX(At) AS Dernier
FROM dbo.AuditLogs
WHERE At >= DATEADD(DAY, -1, SYSUTCDATETIME())
  AND Outcome = 'failure'
GROUP BY Event
ORDER BY Occurrences DESC;


/* Sessions actives : qui est connecté en ce moment.
   Le jeton lui-même n'est pas affiché — c'est un secret d'authentification. */
SELECT u.Username, s.CreatedAt, s.LastSeenAt, s.ExpiresAt, s.MfaPending
FROM dbo.AppSessions s
JOIN dbo.AppUsers u ON u.Id = s.UserId
WHERE s.ExpiresAt > SYSUTCDATETIME()
ORDER BY s.LastSeenAt DESC;


/* Référentiels chargés et nombre de contrôles par référentiel. */
SELECT f.Code, f.Name, f.Version, f.Authority, COUNT(c.Id) AS Controles
FROM dbo.Frameworks f
LEFT JOIN dbo.Controls c ON c.FrameworkId = f.Id
GROUP BY f.Code, f.Name, f.Version, f.Authority
ORDER BY f.Code;


/* Réponses de référence et les contrôles auxquels elles sont rattachées. */
SELECT k.Id, LEFT(k.Question, 80) AS Question, k.Category,
       STRING_AGG(CONCAT(f.Code, ' ', ctl.Ref), ', ') AS Controles
FROM dbo.KbEntries k
LEFT JOIN dbo.KbEntryControls kc ON kc.KbEntryId = k.Id
LEFT JOIN dbo.Controls ctl       ON ctl.Id = kc.ControlId
LEFT JOIN dbo.Frameworks f       ON f.Id = ctl.FrameworkId
GROUP BY k.Id, k.Question, k.Category
ORDER BY k.Id;
