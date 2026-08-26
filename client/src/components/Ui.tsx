import { useState, type CSSProperties, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import type { Band, ClientStatus, ControlChip, KbStatus, QuestionStatus } from '@/api/types';

// --------------------------------------------------------------------------
// États vides et chargement
// --------------------------------------------------------------------------

export function Loader() {
  return <div className="loader"><span className="spinner" /></div>;
}

interface EmptyStateProps {
  icon?: IconName;
  title: string;
  text?: string;
  action?: ReactNode;
}

export function EmptyState({ icon = 'inbox', title, text, action }: EmptyStateProps) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

/**
 * Écran d'erreur d'un chargement.
 *
 * Indispensable partout où une page attend des données : sans lui, une requête
 * en échec laisse le composant sur son indicateur de chargement, et l'écran
 * tourne indéfiniment sans jamais dire ce qui ne va pas.
 */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : String(error ?? 'Erreur inconnue');
  return (
    <div className="card">
      <EmptyState icon="xCircle" title="Chargement impossible" text={message}
                  action={onRetry
                    ? <button className="btn primary" onClick={onRetry}>
                        <Icon name="refresh" />Réessayer
                      </button>
                    : undefined} />
    </div>
  );
}

// --------------------------------------------------------------------------
// Badges de confiance et de statut
// --------------------------------------------------------------------------

const BAND_STYLE: Record<Band, { cls: string; label: string }> = {
  haute: { cls: 'ok', label: 'Confiance haute' },
  moyenne: { cls: 'warn', label: 'À vérifier' },
  faible: { cls: 'danger', label: 'Confiance faible' },
  aucune: { cls: '', label: 'Sans correspondance' },
};

export function BandBadge({ band, confidence }: { band: Band; confidence: number }) {
  const style = BAND_STYLE[band] ?? BAND_STYLE.aucune;
  return (
    <span className={`badge ${style.cls}`}>
      <span className={`dot ${style.cls}`} />
      {style.label}
      {confidence > 0 && ` · ${Math.round(confidence * 100)} %`}
    </span>
  );
}

const QUESTION_STATUS: Record<QuestionStatus, { cls: string; label: string }> = {
  validated: { cls: 'ok', label: 'Validée' },
  auto: { cls: 'accent', label: 'Proposée' },
  pending: { cls: '', label: 'À traiter' },
  na: { cls: 'outline', label: 'Sans objet' },
};

export function StatusBadge({ status }: { status: QuestionStatus }) {
  const style = QUESTION_STATUS[status] ?? QUESTION_STATUS.pending;
  return <span className={`badge ${style.cls}`}>{style.label}</span>;
}

const KB_STATUS: Record<KbStatus, { cls: string; label: string }> = {
  validated: { cls: 'ok', label: 'Validée' },
  draft: { cls: 'warn', label: 'Brouillon' },
  obsolete: { cls: 'danger', label: 'Obsolète' },
};

export function KbStatusBadge({ status }: { status: KbStatus }) {
  const style = KB_STATUS[status] ?? KB_STATUS.draft;
  return <span className={`badge ${style.cls}`}>{style.label}</span>;
}

/** Cycle de vie d'un dossier client : avant signature, sous contrat, clos. */
export const CLIENT_STATUSES: ClientStatus[] = ['prospect', 'actif', 'archivé'];

const CLIENT_STATUS: Partial<Record<ClientStatus, { cls: string; label: string; tip: string }>> = {
  prospect: { cls: 'warn', label: 'Prospect', tip: 'Contrat non signé' },
  'archivé': { cls: 'outline', label: 'Archivé', tip: 'Dossier clos' },
};

/** Aucun badge pour « actif » : c'est l'état nominal, il n'apporte rien. */
export function ClientStatusBadge({ status }: { status: ClientStatus }) {
  if (status === 'actif') return null;
  const style = CLIENT_STATUS[status] ?? { cls: 'outline', label: status, tip: '' };
  return <span className={`badge ${style.cls} nowrap`} title={style.tip}>{style.label}</span>;
}

export function ControlChips({ controls, limit = 4 }: { controls: ControlChip[]; limit?: number }) {
  if (!controls.length) return null;
  const shown = controls.slice(0, limit);
  return (
    <span className="chips">
      {shown.map(control => (
        <span className="badge ref" key={control.id} title={control.title}>
          <b>{control.frameworkCode}</b> {control.ref}
        </span>
      ))}
      {controls.length > limit && (
        <span className="badge ref">+{controls.length - limit}</span>
      )}
    </span>
  );
}

// --------------------------------------------------------------------------
// Sélecteur segmenté
// --------------------------------------------------------------------------

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  hint?: string;
}

/** Trois à cinq choix exclusifs, tous visibles : plus lisible qu'un menu
 *  déroulant qui cache l'éventail derrière un clic. */
export function Segmented<T extends string>(
  { options, value, onChange }:
  { options: SegmentedOption<T>[]; value: T; onChange: (value: T) => void },
) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map(option => (
        <button type="button" role="radio" key={option.value}
                className={`seg${option.value === value ? ' active' : ''}`}
                aria-checked={option.value === value}
                title={option.hint}
                onClick={() => onChange(option.value)}>
          {option.icon && <Icon name={option.icon} />}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

// --------------------------------------------------------------------------
// Bouton occupé
// --------------------------------------------------------------------------

interface BusyButtonProps {
  className?: string;
  disabled?: boolean;
  title?: string;
  style?: CSSProperties;
  children: ReactNode;
  onClick: () => void | Promise<void>;
}

/**
 * Bouton qui se met en attente pendant son action. Sans cela, un double clic
 * sur « Importer » lance deux imports — et l'utilisateur ne sait pas si son
 * premier clic a été pris en compte.
 */
export function BusyButton({
  className = 'btn', disabled, title, style, children, onClick,
}: BusyButtonProps) {
  const [busy, setBusy] = useState(false);

  return (
    <button type="button" className={className} title={title} style={style}
            disabled={busy || disabled}
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              try { await onClick(); } finally { setBusy(false); }
            }}>
      {busy
        ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
        : children}
    </button>
  );
}

// --------------------------------------------------------------------------
// Divers
// --------------------------------------------------------------------------

export function CoverageList({ coverage }: {
  coverage: { name: string; nControls: number; nCovered: number }[];
}) {
  return (
    <div className="bar-list">
      {coverage.map(row => {
        const ratio = row.nControls ? row.nCovered / row.nControls : 0;
        return (
          <div className="bar-row" key={row.name}>
            <span className="bar-label" title={row.name}>{row.name}</span>
            <span className="bar-track">
              <span className="bar-fill" style={{ width: `${Math.max(2, ratio * 100)}%` }} />
            </span>
            <span className="bar-value">{row.nCovered}/{row.nControls}</span>
          </div>
        );
      })}
    </div>
  );
}

const FILE_LABEL: Record<string, string> = {
  xlsx: 'Excel', docx: 'Word', pdf: 'PDF', csv: 'CSV', manuel: 'Saisie',
};

export const fileLabel = (type: string) => FILE_LABEL[type] ?? type;
