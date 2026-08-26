/**
 * Contrat de l'API, transcrit des DTO C# de `server/Cyberjet.Api/Contracts`.
 *
 * Écrit à la main plutôt que généré : le fichier est court, il se relit, et il
 * documente au passage les valeurs admises — ce qu'un schéma généré depuis
 * OpenAPI perd en route pour les `string` contraintes.
 */

// --------------------------------------------------------------------------
// Vocabulaire
// --------------------------------------------------------------------------
export type ClientStatus = 'prospect' | 'actif' | 'archivé';
export type KbStatus = 'validated' | 'draft' | 'obsolete';
export type QuestionStatus = 'pending' | 'auto' | 'validated' | 'na';
export type Band = 'haute' | 'moyenne' | 'faible' | 'aucune';
export type SourceKind = 'kb' | 'config';
export type FileType = 'xlsx' | 'docx' | 'pdf' | 'csv' | 'manuel';

export type ThemePref = 'auto' | 'light' | 'dark';
export type AccentPref = 'azur' | 'indigo' | 'emeraude' | 'ardoise' | 'cuivre';
export type DensityPref = 'confort' | 'compact';
export type SidebarPref = 'expanded' | 'collapsed';
export type MotionPref = 'full' | 'reduced';

export interface Preferences {
  theme: ThemePref;
  accent: AccentPref;
  density: DensityPref;
  sidebar: SidebarPref;
  motion: MotionPref;
}

// --------------------------------------------------------------------------
// Authentification et compte
// --------------------------------------------------------------------------
export interface AuthStatus {
  needsSetup: boolean;
  authenticated: boolean;
  mfaPending: boolean;
  userId: number | null;
  username: string | null;
  isAdmin: boolean;
  mfaEnabled: boolean;
  mfaEnabledAt: string | null;
  recoveryCodesRemaining: number;
  email: string | null;
  phone: string | null;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  createdAt: string | null;
  lastLoginAt: string | null;
  preferences: Preferences;
  /** Minutes d'inactivité avant fermeture de session ; 0 si désactivé. */
  idleTimeoutMinutes: number;
  /** Faux tant que la visite guidée reste à proposer. */
  onboarded: boolean;
}

/** Identifiants stables des widgets du tableau de bord — doivent correspondre
 *  au catalogue tenu côté serveur (AppSettingsService.DashboardWidgetKeys). */
export type DashboardWidgetKey =
  | 'coverage' | 'kpi-clients' | 'kpi-kb' | 'kpi-questionnaires' | 'kpi-frameworks'
  | 'next-step' | 'recent-questionnaires' | 'by-category' | 'top-kb';

/** Largeurs disponibles sur la grille à 12 colonnes — doivent correspondre à
 *  AppSettingsService.DashboardWidgetSizes côté serveur. */
export type DashboardWidgetSize = 'sm' | 'md' | 'lg' | 'full';

export interface DashboardWidgetSetting {
  key: DashboardWidgetKey;
  visible: boolean;
  /** Absent = taille par défaut du widget. */
  size?: DashboardWidgetSize | null;
}

/** Réglages communs à toute l'organisation. */
export interface Settings {
  /** Minutes d'inactivité avant fermeture de session ; 0 si désactivé. */
  sessionIdleTimeoutMinutes: number;
  minIdleTimeoutMinutes: number;
  maxIdleTimeoutMinutes: number;
}

export interface LoginResult {
  username: string;
  isAdmin: boolean;
  mfaRequired: boolean;
}

export interface MfaVerifyResult {
  username: string;
  isAdmin: boolean;
  recoveryCodesRemaining: number;
}

export interface TotpEnrollment {
  secret: string;
  uri: string;
  qrSvg: string;
}

export interface SessionRow {
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

export interface Account {
  id: number;
  username: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  isAdmin: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  mfaEnabled: boolean;
  mfaEnabledAt: string | null;
  recoveryCodesRemaining: number;
  preferences: Preferences;
  sessions: SessionRow[];
}

export interface PublicUser {
  id: number;
  username: string;
  isAdmin: boolean;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  mfaEnabled: boolean;
  mfaEnabledAt: string | null;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  /** Minutes restant au verrouillage anti-bruteforce ; null si non bloqué. */
  lockedForMinutes: number | null;
}

// --------------------------------------------------------------------------
// Référentiels
// --------------------------------------------------------------------------
export interface Framework {
  id: number;
  code: string;
  name: string;
  version: string | null;
  authority: string | null;
  description: string | null;
  accent: string;
  sortOrder: number;
  nControls: number;
}

export interface Control {
  id: number;
  frameworkId: number;
  ref: string;
  title: string;
  theme: string | null;
  description: string | null;
  sortOrder: number;
  nKb: number;
}

export interface ControlChip {
  id: number;
  ref: string;
  title: string;
  frameworkCode: string;
  accent: string;
}

export interface CoverageRow {
  code: string;
  name: string;
  accent: string | null;
  nControls: number;
  nCovered: number;
}

// --------------------------------------------------------------------------
// Clients
// --------------------------------------------------------------------------
export interface ClientRow {
  id: number;
  name: string;
  country: string | null;
  contact: string | null;
  description: string | null;
  status: ClientStatus;
  createdAt: string;
  updatedAt: string;
  nKb: number;
  nConfigs: number;
  nQuestionnaires: number;
}

export interface ClientDetail extends ClientRow {
  coverage: CoverageRow[];
}

// --------------------------------------------------------------------------
// Base de connaissance et configurations
// --------------------------------------------------------------------------
export interface KbEntry {
  id: number;
  clientId: number | null;
  clientName: string | null;
  question: string;
  answer: string;
  category: string;
  tags: string;
  status: KbStatus;
  evidence: string | null;
  source: string | null;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  controls: ControlChip[];
}

export interface ConfigItem {
  id: number;
  clientId: number;
  clientName: string | null;
  category: string;
  label: string;
  value: string;
  details: string | null;
  scope: string | null;
  status: string;
  updatedAt: string;
}

// --------------------------------------------------------------------------
// Moteur
// --------------------------------------------------------------------------
export interface Candidate {
  kind: SourceKind;
  id: number;
  clientId: number | null;
  title: string;
  body: string;
  category: string;
  status: string;
  refs: string[];
  confidence: number;
  band: Band;
  refHit: boolean;
  matchedTerms: string[];
  extra: Record<string, string | null>;
}

export interface AnswerResult {
  answer: string;
  confidence: number;
  band: Band;
  best: Candidate | null;
  candidates: Candidate[];
  indexedDocuments: number;
}

// --------------------------------------------------------------------------
// Questionnaires
// --------------------------------------------------------------------------
export interface QuestionnaireRow {
  id: number;
  clientId: number;
  clientName: string;
  name: string;
  originalFilename: string | null;
  fileType: FileType;
  status: string;
  createdAt: string;
  updatedAt: string;
  nQuestions: number;
  nValidated: number;
  nNa: number;
  nAnswered: number;
}

export interface Question {
  id: number;
  questionnaireId: number;
  idx: number;
  ref: string | null;
  section: string | null;
  text: string;
  suggestedAnswer: string | null;
  finalAnswer: string | null;
  status: QuestionStatus;
  confidence: number;
  band: Band;
  matchedKind: SourceKind | null;
  matchedId: number | null;
  promotedKbEntryId: number | null;
  candidates: Candidate[];
}

export interface QuestionnaireSummary {
  total: number;
  answered: number;
  validated: number;
  na: number;
  pending: number;
  high: number;
  medium: number;
  canExportOriginal: boolean;
}

export interface QuestionnaireDetail {
  id: number;
  clientId: number;
  clientName: string;
  name: string;
  originalFilename: string | null;
  fileType: FileType;
  status: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  questions: Question[];
  summary: QuestionnaireSummary;
  warnings: string[];
  run: { processed: number; byBand: Record<string, number>; indexedDocuments: number } | null;
  validated: number | null;
}

// --------------------------------------------------------------------------
// Tableau de bord et volumétrie
// --------------------------------------------------------------------------
export interface RecentQuestionnaire {
  id: number;
  name: string;
  status: string;
  fileType: FileType;
  updatedAt: string;
  clientName: string;
  clientId: number;
  nQuestions: number;
  nDone: number;
}

export interface CategoryCount {
  category: string;
  n: number;
}

export interface Stats {
  clients: number;
  kbTotal: number;
  kbGeneric: number;
  kbValidated: number;
  configs: number;
  questionnairesOpen: number;
  questionnairesTotal: number;
  questionsTotal: number;
  questionsAnswered: number;
  questionsValidated: number;
  coverage: number;
  frameworks: number;
  controls: number;
  recentQuestionnaires: RecentQuestionnaire[];
  topKb: { id: number; question: string; category: string; usageCount: number }[];
  byCategory: CategoryCount[];
}

export interface StorageReport {
  disk: {
    database: { count: number; bytes: number };
    uploads: { count: number; bytes: number };
    exports: { count: number; bytes: number };
    total: number;
    path: string;
  };
  counts: {
    clients: number;
    kb: number;
    kbGeneric: number;
    configs: number;
    questionnaires: number;
    questions: number;
    controlLinks: number;
    indexed: number;
  };
  avgEntryChars: number;
  growth: { month: string; kb: number; questionnaires: number }[];
  backlog: {
    uncapitalised: number;
    corrected: number;
    drafts: number;
    stale: number;
    clientsWithoutConfig: number;
  };
  coverage: CoverageRow[];
  perClient: { id: number; name: string; nKb: number; nConfigs: number; nQuestions: number }[];
}

export interface Meta {
  categories: string[];
  configCategories: string[];
  configStatuses: string[];
  thresholds: { high: number; medium: number; low: number };
}

// --------------------------------------------------------------------------
// Journal d'audit
// --------------------------------------------------------------------------
export interface AuditEntry {
  id: number;
  at: string;
  event: string;
  eventLabel: string;
  outcome: 'success' | 'failure';
  actorId: number | null;
  actorName: string | null;
  ip: string | null;
  userAgent: string | null;
  targetType: string | null;
  targetId: number | null;
  targetLabel: string | null;
  detail: string | null;
}

export interface AuditPage {
  entries: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
  summary: {
    totalEntries: number;
    failedLogins24h: number;
    lockouts24h: number;
    mfaFailures24h: number;
    oldest: string | null;
  };
  actors: string[];
  events: { code: string; label: string }[];
  categories: { code: string; label: string }[];
  retentionDays: number;
}

// --------------------------------------------------------------------------
// Présence
// --------------------------------------------------------------------------
export interface OnlineUser {
  userId: number;
  username: string;
  fullName: string | null;
  isAdmin: boolean;
  isSelf: boolean;
}

export interface Presence {
  count: number;
  users: OnlineUser[];
}
