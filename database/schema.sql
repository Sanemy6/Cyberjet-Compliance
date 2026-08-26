/* ==========================================================================
   Cyberjet Compliance — schéma SQL Server

   Script idempotent : il crée ce qui manque et ne touche jamais à l'existant.
   Il est exécuté au démarrage de l'API (DatabaseInitializer), ce qui permet à
   l'application de s'installer seule sur une base vide, et il reste lisible
   par un DBA — ce qu'une migration EF générée n'est pas toujours.

   Conventions
     * Horodatages en DATETIME2(0) UTC. La base ne stocke aucune heure locale.
     * NVARCHAR partout : les référentiels et les réponses sont accentués.
     * Suppressions en cascade là où la donnée fille n'a pas de sens seule
       (réponses d'un client, questions d'un questionnaire).
   ========================================================================== */

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* -------------------------------------------------------------------------
   Clients
   ------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.Clients', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Clients (
        Id          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Clients PRIMARY KEY,
        Name        NVARCHAR(200)  NOT NULL,
        Country     NVARCHAR(120)  NULL,
        Contact     NVARCHAR(300)  NULL,
        Description NVARCHAR(MAX)  NULL,
        -- prospect = dossier ouvert avant signature du contrat.
        Status      NVARCHAR(20)   NOT NULL CONSTRAINT DF_Clients_Status DEFAULT N'actif',
        CreatedAt   DATETIME2(0)   NOT NULL,
        UpdatedAt   DATETIME2(0)   NOT NULL,
        CONSTRAINT UQ_Clients_Name UNIQUE (Name)
    );
END
GO

/* -------------------------------------------------------------------------
   Référentiels et contrôles
   ------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.Frameworks', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Frameworks (
        Id          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Frameworks PRIMARY KEY,
        Code        NVARCHAR(40)   NOT NULL,
        Name        NVARCHAR(200)  NOT NULL,
        Version     NVARCHAR(200)  NULL,
        Authority   NVARCHAR(120)  NULL,
        Description NVARCHAR(MAX)  NULL,
        Accent      NVARCHAR(20)   NOT NULL CONSTRAINT DF_Frameworks_Accent DEFAULT N'slate',
        SortOrder   INT            NOT NULL CONSTRAINT DF_Frameworks_SortOrder DEFAULT 0,
        CONSTRAINT UQ_Frameworks_Code UNIQUE (Code)
    );
END
GO

IF OBJECT_ID(N'dbo.Controls', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Controls (
        Id          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Controls PRIMARY KEY,
        FrameworkId INT            NOT NULL,
        Ref         NVARCHAR(60)   NOT NULL,
        Title       NVARCHAR(400)  NOT NULL,
        Theme       NVARCHAR(120)  NULL,
        Description NVARCHAR(MAX)  NULL,
        SortOrder   INT            NOT NULL CONSTRAINT DF_Controls_SortOrder DEFAULT 0,
        CONSTRAINT FK_Controls_Frameworks FOREIGN KEY (FrameworkId)
            REFERENCES dbo.Frameworks(Id) ON DELETE CASCADE,
        CONSTRAINT UQ_Controls_Framework_Ref UNIQUE (FrameworkId, Ref)
    );
    CREATE INDEX IX_Controls_FrameworkId ON dbo.Controls(FrameworkId);
END
GO

/* -------------------------------------------------------------------------
   Base de connaissance
   Une entrée = une question récurrente + sa réponse validée.
   ClientId NULL => réponse générique, réutilisable pour tous les dossiers.
   ------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.KbEntries', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.KbEntries (
        Id         INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_KbEntries PRIMARY KEY,
        ClientId   INT            NULL,
        Question   NVARCHAR(MAX)  NOT NULL,
        Answer     NVARCHAR(MAX)  NOT NULL,
        Category   NVARCHAR(120)  NOT NULL CONSTRAINT DF_KbEntries_Category DEFAULT N'Général',
        Tags       NVARCHAR(500)  NOT NULL CONSTRAINT DF_KbEntries_Tags DEFAULT N'',
        Status     NVARCHAR(20)   NOT NULL CONSTRAINT DF_KbEntries_Status DEFAULT N'validated',
        Evidence   NVARCHAR(500)  NULL,
        Source     NVARCHAR(300)  NULL,
        UsageCount INT            NOT NULL CONSTRAINT DF_KbEntries_UsageCount DEFAULT 0,
        CreatedAt  DATETIME2(0)   NOT NULL,
        UpdatedAt  DATETIME2(0)   NOT NULL,
        ReviewedAt DATETIME2(0)   NULL,
        CONSTRAINT FK_KbEntries_Clients FOREIGN KEY (ClientId)
            REFERENCES dbo.Clients(Id) ON DELETE CASCADE
    );
    CREATE INDEX IX_KbEntries_ClientId ON dbo.KbEntries(ClientId);
    CREATE INDEX IX_KbEntries_Status   ON dbo.KbEntries(Status);
END
GO

IF OBJECT_ID(N'dbo.KbEntryControls', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.KbEntryControls (
        KbEntryId INT NOT NULL,
        ControlId INT NOT NULL,
        CONSTRAINT PK_KbEntryControls PRIMARY KEY (KbEntryId, ControlId),
        CONSTRAINT FK_KbEntryControls_KbEntries FOREIGN KEY (KbEntryId)
            REFERENCES dbo.KbEntries(Id) ON DELETE CASCADE,
        CONSTRAINT FK_KbEntryControls_Controls FOREIGN KEY (ControlId)
            REFERENCES dbo.Controls(Id) ON DELETE CASCADE
    );
    CREATE INDEX IX_KbEntryControls_ControlId ON dbo.KbEntryControls(ControlId);
END
GO

/* -------------------------------------------------------------------------
   Configurations techniques du client
   Indexées comme la base de connaissance : elles répondent directement aux
   questions factuelles (« quel algorithme de chiffrement au repos ? »).
   ------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.ConfigItems', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ConfigItems (
        Id        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ConfigItems PRIMARY KEY,
        ClientId  INT            NOT NULL,
        Category  NVARCHAR(120)  NOT NULL CONSTRAINT DF_ConfigItems_Category DEFAULT N'Chiffrement',
        Label     NVARCHAR(300)  NOT NULL,
        Value     NVARCHAR(MAX)  NOT NULL,
        Details   NVARCHAR(MAX)  NULL,
        Scope     NVARCHAR(500)  NULL,
        Status    NVARCHAR(30)   NOT NULL CONSTRAINT DF_ConfigItems_Status DEFAULT N'en place',
        UpdatedAt DATETIME2(0)   NOT NULL,
        CONSTRAINT FK_ConfigItems_Clients FOREIGN KEY (ClientId)
            REFERENCES dbo.Clients(Id) ON DELETE CASCADE
    );
    CREATE INDEX IX_ConfigItems_ClientId ON dbo.ConfigItems(ClientId);
END
GO

/* -------------------------------------------------------------------------
   Questionnaires reçus des clients
   ------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.Questionnaires', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Questionnaires (
        Id               INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Questionnaires PRIMARY KEY,
        ClientId         INT            NOT NULL,
        Name             NVARCHAR(300)  NOT NULL,
        OriginalFilename NVARCHAR(400)  NULL,
        StoredPath       NVARCHAR(1000) NULL,
        FileType         NVARCHAR(20)   NOT NULL CONSTRAINT DF_Questionnaires_FileType DEFAULT N'xlsx',
        Status           NVARCHAR(30)   NOT NULL CONSTRAINT DF_Questionnaires_Status DEFAULT N'en cours',
        Notes            NVARCHAR(MAX)  NULL,
        CreatedAt        DATETIME2(0)   NOT NULL,
        UpdatedAt        DATETIME2(0)   NOT NULL,
        CONSTRAINT FK_Questionnaires_Clients FOREIGN KEY (ClientId)
            REFERENCES dbo.Clients(Id) ON DELETE CASCADE
    );
    CREATE INDEX IX_Questionnaires_ClientId ON dbo.Questionnaires(ClientId);
END
GO

IF OBJECT_ID(N'dbo.QuestionnaireQuestions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.QuestionnaireQuestions (
        Id               INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_QuestionnaireQuestions PRIMARY KEY,
        QuestionnaireId  INT            NOT NULL,
        Idx              INT            NOT NULL,
        Ref              NVARCHAR(120)  NULL,
        Section          NVARCHAR(300)  NULL,
        Text             NVARCHAR(MAX)  NOT NULL,
        SuggestedAnswer  NVARCHAR(MAX)  NULL,
        FinalAnswer      NVARCHAR(MAX)  NULL,
        Status           NVARCHAR(20)   NOT NULL CONSTRAINT DF_QQ_Status DEFAULT N'pending',
        Confidence       FLOAT          NOT NULL CONSTRAINT DF_QQ_Confidence DEFAULT 0,
        MatchedKind      NVARCHAR(20)   NULL,
        MatchedId        INT            NULL,
        CandidatesJson   NVARCHAR(MAX)  NULL,
        LocatorJson      NVARCHAR(MAX)  NULL,
        -- Réponse versée dans la base depuis cette question. Distinct de
        -- MatchedId, qui désigne l'entrée d'où vient la proposition : ici c'est
        -- l'entrée que cette question a créée.
        --
        -- Délibérément SANS clé étrangère. Une contrainte vers KbEntries créerait
        -- un second chemin de suppression vers cette table :
        --     Clients → Questionnaires → QuestionnaireQuestions   (CASCADE)
        --     Clients → KbEntries       → QuestionnaireQuestions   (SET NULL)
        -- ce que SQL Server refuse ("may cause cycles or multiple cascade paths").
        --
        -- L'intégrité est donc tenue par l'application, comme dans la version
        -- précédente : la lecture d'un questionnaire joint KbEntries en LEFT JOIN
        -- et ne présente « versée dans la base » que si l'entrée existe encore.
        -- Une liaison devenue orpheline s'efface donc à l'affichage, ce qui est
        -- exactement le comportement voulu — le bouton revient à son état initial.
        PromotedKbEntryId INT           NULL,
        CONSTRAINT FK_QQ_Questionnaires FOREIGN KEY (QuestionnaireId)
            REFERENCES dbo.Questionnaires(Id) ON DELETE CASCADE
    );
    CREATE INDEX IX_QQ_QuestionnaireId  ON dbo.QuestionnaireQuestions(QuestionnaireId);
    -- Sans clé étrangère, pas d'index automatique : celui-ci porte la jointure
    -- de lecture qui filtre les liaisons orphelines.
    CREATE INDEX IX_QQ_PromotedKbEntryId ON dbo.QuestionnaireQuestions(PromotedKbEntryId);
END
GO

/* -------------------------------------------------------------------------
   Comptes, sessions, second facteur
   ------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.AppUsers', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AppUsers (
        Id                INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AppUsers PRIMARY KEY,
        Username          NVARCHAR(60)   NOT NULL,
        PasswordHash      NVARCHAR(200)  NOT NULL,
        PasswordSalt      NVARCHAR(100)  NOT NULL,
        IsAdmin           BIT            NOT NULL CONSTRAINT DF_AppUsers_IsAdmin DEFAULT 0,
        Active            BIT            NOT NULL CONSTRAINT DF_AppUsers_Active  DEFAULT 1,
        CreatedAt         DATETIME2(0)   NOT NULL,
        LastLoginAt       DATETIME2(0)   NULL,
        TotpSecret        NVARCHAR(100)  NULL,
        TotpPendingSecret NVARCHAR(100)  NULL,
        TotpEnabled       BIT            NOT NULL CONSTRAINT DF_AppUsers_TotpEnabled DEFAULT 0,
        TotpLastCounter   BIGINT         NULL,
        MfaEnabledAt      DATETIME2(0)   NULL,
        -- Fiche du compte, tenue par la personne elle-même. Ni l'adresse ni le
        -- téléphone ne servent à se connecter : ils disent qui contacter.
        -- Aucun courriel, aucun SMS n'est émis par l'application.
        FirstName         NVARCHAR(80)   NULL,
        LastName          NVARCHAR(80)   NULL,
        Email             NVARCHAR(200)  NULL,
        Phone             NVARCHAR(40)   NULL,
        JobTitle          NVARCHAR(120)  NULL,
        -- Préférences d'interface sérialisées en JSON : suivre la personne d'un
        -- poste à l'autre demande le serveur, un localStorage ne franchit pas
        -- la frontière du navigateur.
        Preferences       NVARCHAR(1000) NULL,
        -- Vue ou explicitement passée, l'une comme l'autre valent « faite » :
        -- nul tant que la visite guidée reste à proposer à la connexion.
        OnboardedAt       DATETIME2(0)   NULL,
        CONSTRAINT UQ_AppUsers_Username UNIQUE (Username)
    );
END
GO

-- Colonne ajoutée après la première mise en service (visite guidée). Sur une
-- base déjà installée, les comptes existants restent NULL : ils verront la
-- visite à leur prochaine connexion, ce qui est le comportement voulu pour
-- une fonctionnalité qui n'existait pas avant eux — personne ne « rate » un
-- pas qu'il n'a jamais eu l'occasion de faire.
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.AppUsers') AND name = 'OnboardedAt'
)
BEGIN
    ALTER TABLE dbo.AppUsers ADD OnboardedAt DATETIME2(0) NULL;
END
GO

IF OBJECT_ID(N'dbo.AppSessions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AppSessions (
        Token      NVARCHAR(88)  NOT NULL CONSTRAINT PK_AppSessions PRIMARY KEY,
        UserId     INT           NOT NULL,
        CreatedAt  DATETIME2(0)  NOT NULL,
        ExpiresAt  DATETIME2(0)  NOT NULL,
        -- Rafraîchi à chaque requête authentifiée (voir SessionService) : c'est
        -- ce qui distingue une session « ouverte » d'une session « active à
        -- l'instant », et donc ce qui permet de savoir qui est en ligne.
        LastSeenAt DATETIME2(0)  NOT NULL CONSTRAINT DF_AppSessions_LastSeenAt DEFAULT SYSUTCDATETIME(),
        -- Session créée après le mot de passe mais avant le second facteur :
        -- elle n'autorise que la vérification MFA, rien d'autre.
        MfaPending BIT           NOT NULL CONSTRAINT DF_AppSessions_MfaPending DEFAULT 0,
        CONSTRAINT FK_AppSessions_AppUsers FOREIGN KEY (UserId)
            REFERENCES dbo.AppUsers(Id) ON DELETE CASCADE
    );
    CREATE INDEX IX_AppSessions_UserId     ON dbo.AppSessions(UserId);
    CREATE INDEX IX_AppSessions_ExpiresAt  ON dbo.AppSessions(ExpiresAt);
    CREATE INDEX IX_AppSessions_LastSeenAt ON dbo.AppSessions(LastSeenAt);
END
GO

-- Colonne ajoutée après la première mise en service (présence en ligne). Le
-- bloc ci-dessus ne s'exécute que sur une table neuve ; sur une base déjà
-- installée, c'est cette instruction qui la met à niveau. Le DEFAULT recule
-- SYSUTCDATETIME() : les sessions déjà ouvertes redeviennent visibles comme
-- « en ligne » à la prochaine requête, plutôt que de disparaître de la liste
-- jusqu'à leur prochaine reconnexion.
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.AppSessions') AND name = 'LastSeenAt'
)
BEGIN
    ALTER TABLE dbo.AppSessions
        ADD LastSeenAt DATETIME2(0) NOT NULL
            CONSTRAINT DF_AppSessions_LastSeenAt DEFAULT SYSUTCDATETIME();
    CREATE INDEX IX_AppSessions_LastSeenAt ON dbo.AppSessions(LastSeenAt);
END
GO

/* Codes de récupération à usage unique, seule porte de sortie si le second
   facteur est perdu. Stockés hachés : ils ne sont affichés qu'une seule fois,
   à la génération. */
IF OBJECT_ID(N'dbo.RecoveryCodes', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.RecoveryCodes (
        Id        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_RecoveryCodes PRIMARY KEY,
        UserId    INT           NOT NULL,
        CodeHash  NVARCHAR(80)  NOT NULL,
        CreatedAt DATETIME2(0)  NOT NULL,
        UsedAt    DATETIME2(0)  NULL,
        CONSTRAINT FK_RecoveryCodes_AppUsers FOREIGN KEY (UserId)
            REFERENCES dbo.AppUsers(Id) ON DELETE CASCADE
    );
    CREATE INDEX IX_RecoveryCodes_UserId ON dbo.RecoveryCodes(UserId);
END
GO

/* -------------------------------------------------------------------------
   Journal d'audit

   Table en ajout seul du point de vue de l'application : aucun endpoint ne
   permet de modifier ou supprimer une ligne individuelle, seule la purge de
   rétention efface (et elle est elle-même journalisée). Le nom de l'acteur est
   dénormalisé afin que la trace survive à la suppression du compte — un
   journal qui perd ses acteurs ne prouve rien. Pas de clé étrangère sur
   ActorId, pour la même raison.
   ------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.AuditLogs', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AuditLogs (
        Id          BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AuditLogs PRIMARY KEY,
        At          DATETIME2(0)   NOT NULL,
        Event       NVARCHAR(60)   NOT NULL,
        Outcome     NVARCHAR(20)   NOT NULL CONSTRAINT DF_AuditLogs_Outcome DEFAULT N'success',
        ActorId     INT            NULL,
        ActorName   NVARCHAR(60)   NULL,
        Ip          NVARCHAR(64)   NULL,
        UserAgent   NVARCHAR(200)  NULL,
        TargetType  NVARCHAR(40)   NULL,
        TargetId    INT            NULL,
        TargetLabel NVARCHAR(200)  NULL,
        Detail      NVARCHAR(500)  NULL
    );
    CREATE INDEX IX_AuditLogs_At      ON dbo.AuditLogs(At DESC);
    CREATE INDEX IX_AuditLogs_Event   ON dbo.AuditLogs(Event);
    CREATE INDEX IX_AuditLogs_ActorId ON dbo.AuditLogs(ActorId);
END
GO

/* -------------------------------------------------------------------------
   Réglages d'application

   Table clé/valeur : les paramètres qu'un administrateur peut changer depuis
   l'interface, sans accès au serveur ni redémarrage. Volontairement distincte
   d'appsettings.json, qui reste la valeur initiale — un réglage posé ici prime,
   sans quoi toute modification serait perdue au prochain déploiement.

   Le nom de qui a changé quoi n'est pas conservé ici : c'est le journal
   d'audit qui porte cette trace, et lui seul.
   ------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.AppSettings', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AppSettings (
        [Key]     NVARCHAR(80)   NOT NULL CONSTRAINT PK_AppSettings PRIMARY KEY,
        -- 2000 plutôt que la borne stricte des premiers réglages (un entier) :
        -- l'agencement du tableau de bord y sérialise une liste de widgets, et
        -- une valeur trop juste casserait au premier widget ajouté.
        Value     NVARCHAR(2000) NOT NULL,
        UpdatedAt DATETIME2(0)   NOT NULL
    );
END
GO

-- Colonne élargie après la première mise en service (délai de session
-- seulement, à l'origine). Sur une base déjà installée, ALTER COLUMN
-- n'écrase aucune donnée existante — un entier tient dans les deux largeurs.
IF EXISTS (
    SELECT 1 FROM sys.columns c
    JOIN sys.types t ON c.user_type_id = t.user_type_id
    WHERE c.object_id = OBJECT_ID(N'dbo.AppSettings') AND c.name = 'Value' AND c.max_length < 4000
)
BEGIN
    ALTER TABLE dbo.AppSettings ALTER COLUMN Value NVARCHAR(2000) NOT NULL;
END
GO
