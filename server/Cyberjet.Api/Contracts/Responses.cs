namespace Cyberjet.Api.Contracts;

// ==========================================================================
// Authentification et compte
// ==========================================================================

/// <summary>
/// État de la session, interrogé au chargement de l'application.
///
/// La fiche et les préférences voyagent avec le statut : le shell les applique
/// au premier rendu, sans second aller-retour qui ferait clignoter l'avatar et
/// le thème.
/// </summary>
public sealed record AuthStatusResponse(
    bool NeedsSetup,
    bool Authenticated,
    bool MfaPending,
    int? UserId,
    string? Username,
    bool IsAdmin,
    bool MfaEnabled,
    DateTime? MfaEnabledAt,
    int RecoveryCodesRemaining,
    string? Email,
    string? Phone,
    string? FullName,
    string? FirstName,
    string? LastName,
    string? JobTitle,
    DateTime? CreatedAt,
    DateTime? LastLoginAt,
    Dictionary<string, string> Preferences,
    /// <summary>Délai d'inactivité avant fermeture de session, en minutes ; 0 si
    /// le mécanisme est désactivé. Le front s'en sert pour prévenir avant
    /// l'échéance — la valeur reste posée côté serveur, seul juge en la matière.</summary>
    int IdleTimeoutMinutes,
    /// <summary>Faux tant que la visite guidée reste à proposer. Vrai dès
    /// qu'elle a été vue ou explicitement passée — les deux comptent, un
    /// compte ne doit pas la revoir malgré lui à la connexion suivante.</summary>
    bool Onboarded);

/// <summary>Réglages communs à toute l'organisation, avec les bornes que
/// l'interface doit faire respecter avant même d'appeler le serveur.</summary>
public sealed record SettingsResponse(
    int SessionIdleTimeoutMinutes,
    int MinIdleTimeoutMinutes,
    int MaxIdleTimeoutMinutes);

public sealed record LoginResponse(string Username, bool IsAdmin, bool MfaRequired);

public sealed record MfaVerifyResponse(string Username, bool IsAdmin, int RecoveryCodesRemaining);

public sealed record TotpEnrollmentResponse(string Secret, string Uri, string QrSvg);

public sealed record RecoveryCodesResponse(List<string> RecoveryCodes);

public sealed record SessionResponse(DateTime CreatedAt, DateTime ExpiresAt, bool Current);

public sealed record AccountResponse(
    int Id,
    string Username,
    string? FirstName,
    string? LastName,
    string? FullName,
    string? Email,
    string? Phone,
    string? JobTitle,
    bool IsAdmin,
    DateTime CreatedAt,
    DateTime? LastLoginAt,
    bool MfaEnabled,
    DateTime? MfaEnabledAt,
    int RecoveryCodesRemaining,
    Dictionary<string, string> Preferences,
    // Le jeton lui-même ne sort jamais : seul « est-ce celle d'ici » compte.
    List<SessionResponse> Sessions);

public sealed record PublicUserResponse(
    int Id,
    string Username,
    bool IsAdmin,
    bool Active,
    DateTime CreatedAt,
    DateTime? LastLoginAt,
    bool MfaEnabled,
    DateTime? MfaEnabledAt,
    string? Email,
    string? Phone,
    string? JobTitle,
    string? FirstName,
    string? LastName,
    string? FullName,
    /// <summary>Minutes restantes avant que le verrouillage anti-bruteforce ne
    /// se lève de lui-même ; <c>null</c> si le compte n'est pas bloqué. Permet
    /// à l'écran d'administration de montrer l'état sans que la personne
    /// concernée ait à le signaler.</summary>
    int? LockedForMinutes);

// ==========================================================================
// Référentiels
// ==========================================================================

public sealed record FrameworkResponse(
    int Id, string Code, string Name, string? Version, string? Authority,
    string? Description, string Accent, int SortOrder, int NControls);

public sealed record ControlResponse(
    int Id, int FrameworkId, string Ref, string Title, string? Theme,
    string? Description, int SortOrder, int NKb);

public sealed record ControlChipResponse(
    int Id, string Ref, string Title, string FrameworkCode, string Accent);

// ==========================================================================
// Clients
// ==========================================================================

public sealed record CoverageRow(
    string Code, string Name, string? Accent, int NControls, int NCovered);

public sealed record ClientResponse(
    int Id, string Name, string? Country, string? Contact, string? Description,
    string Status, DateTime CreatedAt, DateTime UpdatedAt,
    int NKb, int NConfigs, int NQuestionnaires);

public sealed record ClientDetailResponse(
    int Id, string Name, string? Country, string? Contact, string? Description,
    string Status, DateTime CreatedAt, DateTime UpdatedAt,
    int NKb, int NConfigs, int NQuestionnaires,
    List<CoverageRow> Coverage);

// ==========================================================================
// Base de connaissance et configurations
// ==========================================================================

public sealed record KbEntryResponse(
    int Id, int? ClientId, string? ClientName, string Question, string Answer,
    string Category, string Tags, string Status, string? Evidence, string? Source,
    int UsageCount, DateTime CreatedAt, DateTime UpdatedAt, DateTime? ReviewedAt,
    List<ControlChipResponse> Controls);

public sealed record KbCategoryCount(string Category, int N);

public sealed record ConfigResponse(
    int Id, int ClientId, string? ClientName, string Category, string Label,
    string Value, string? Details, string? Scope, string Status, DateTime UpdatedAt);

// ==========================================================================
// Moteur
// ==========================================================================

public sealed record CandidateResponse(
    string Kind, int Id, int? ClientId, string Title, string Body, string Category,
    string Status, List<string> Refs, double Confidence, string Band, bool RefHit,
    List<string> MatchedTerms, Dictionary<string, string?> Extra);

public sealed record AnswerResponse(
    string Answer, double Confidence, string Band, CandidateResponse? Best,
    List<CandidateResponse> Candidates, int IndexedDocuments);

// ==========================================================================
// Questionnaires
// ==========================================================================

public sealed record QuestionnaireListItem(
    int Id, int ClientId, string ClientName, string Name, string? OriginalFilename,
    string FileType, string Status, DateTime CreatedAt, DateTime UpdatedAt,
    int NQuestions, int NValidated, int NNa, int NAnswered);

public sealed record QuestionResponse(
    int Id, int QuestionnaireId, int Idx, string? Ref, string? Section, string Text,
    string? SuggestedAnswer, string? FinalAnswer, string Status, double Confidence,
    string Band, string? MatchedKind, int? MatchedId, int? PromotedKbEntryId,
    List<CandidateResponse> Candidates);

public sealed record QuestionnaireSummary(
    int Total, int Answered, int Validated, int Na, int Pending,
    int High, int Medium, bool CanExportOriginal);

public sealed record AutoAnswerRun(int Processed, Dictionary<string, int> ByBand, int IndexedDocuments);

public sealed record QuestionnaireDetailResponse(
    int Id, int ClientId, string ClientName, string Name, string? OriginalFilename,
    string FileType, string Status, string? Notes, DateTime CreatedAt, DateTime UpdatedAt,
    List<QuestionResponse> Questions, QuestionnaireSummary Summary,
    List<string> Warnings, AutoAnswerRun? Run, int? Validated);

// ==========================================================================
// Tableau de bord et volumétrie
// ==========================================================================

public sealed record RecentQuestionnaire(
    int Id, string Name, string Status, string FileType, DateTime UpdatedAt,
    string ClientName, int ClientId, int NQuestions, int NDone);

public sealed record TopKbEntry(int Id, string Question, string Category, int UsageCount);

public sealed record StatsResponse(
    int Clients, int KbTotal, int KbGeneric, int KbValidated, int Configs,
    int QuestionnairesOpen, int QuestionnairesTotal, int QuestionsTotal,
    int QuestionsAnswered, int QuestionsValidated, double Coverage,
    int Frameworks, int Controls,
    List<RecentQuestionnaire> RecentQuestionnaires,
    List<TopKbEntry> TopKb,
    List<KbCategoryCount> ByCategory);

public sealed record DirectoryUsage(int Count, long Bytes);

public sealed record DiskUsage(
    DirectoryUsage Database, DirectoryUsage Uploads, DirectoryUsage Exports,
    long Total, string Path);

public sealed record StorageCounts(
    int Clients, int Kb, int KbGeneric, int Configs, int Questionnaires,
    int Questions, int ControlLinks, int Indexed);

public sealed record GrowthPoint(string Month, int Kb, int Questionnaires);

public sealed record BacklogCounts(
    int Uncapitalised, int Corrected, int Drafts, int Stale, int ClientsWithoutConfig);

public sealed record PerClientRow(int Id, string Name, int NKb, int NConfigs, int NQuestions);

public sealed record StorageResponse(
    DiskUsage Disk, StorageCounts Counts, int AvgEntryChars,
    List<GrowthPoint> Growth, BacklogCounts Backlog,
    List<CoverageRow> Coverage, List<PerClientRow> PerClient);

public sealed record ThresholdSet(double High, double Medium, double Low);

public sealed record MetaResponse(
    List<string> Categories, List<string> ConfigCategories,
    List<string> ConfigStatuses, ThresholdSet Thresholds);

// ==========================================================================
// Journal d'audit
// ==========================================================================

public sealed record AuditEntryResponse(
    long Id, DateTime At, string Event, string EventLabel, string Outcome,
    int? ActorId, string? ActorName, string? Ip, string? UserAgent,
    string? TargetType, int? TargetId, string? TargetLabel, string? Detail);

public sealed record AuditSummary(
    int TotalEntries, int FailedLogins24h, int Lockouts24h, int MfaFailures24h,
    DateTime? Oldest);

public sealed record CodeLabel(string Code, string Label);

public sealed record AuditResponse(
    List<AuditEntryResponse> Entries, int Total, int Limit, int Offset,
    AuditSummary Summary, List<string> Actors,
    List<CodeLabel> Events, List<CodeLabel> Categories, int RetentionDays);

// ==========================================================================
// Présence — qui est actuellement en ligne
// ==========================================================================

public sealed record OnlineUserResponse(
    int UserId, string Username, string? FullName, bool IsAdmin, bool IsSelf);

public sealed record PresenceResponse(int Count, List<OnlineUserResponse> Users);
