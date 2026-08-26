import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';

import { api, download } from '@/api/client';
import { keys } from '@/api/queries';
import type { AuditEntry, AuditPage as AuditPageData } from '@/api/types';
import { Icon, type IconName } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { EmptyState, ErrorState, Loader } from '@/components/Ui';
import { useToast } from '@/components/Toast';
import { PageMeta } from '@/components/layout/Shell';
import { useSession } from '@/lib/session';
import { useDebounced } from '@/lib/useDebounced';
import { fmtDate, fmtDateTime, fmtNum, plural, truncate } from '@/lib/format';

const PAGE_SIZE = 100;

/** Familles d'événements et intention de lecture associée. Le résultat « échec »
 *  prime sur la famille : un échec doit sauter aux yeux. */
const EVENT_TONE: Record<string, string> = {
  auth: 'accent', mfa: 'accent', user: 'warn', export: 'warn',
};

interface Filters {
  category: string;
  outcome: string;
  actor: string;
  since: string;
  until: string;
  q: string;
}

const EMPTY_FILTERS: Filters = {
  category: '', outcome: '', actor: '', since: '', until: '', q: '',
};

export function AuditPage() {
  const toast = useToast();
  const { status } = useSession();
  const isAdmin = status?.isAdmin ?? false;

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);

  const debouncedQuery = useDebounced(filters.q, 280);
  const effective = { ...filters, q: debouncedQuery };

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [...keys.audit, effective, offset],
    queryFn: () => api.get<AuditPageData>('/api/audit', {
      ...effective, limit: PAGE_SIZE, offset,
    }),
    enabled: isAdmin,
    // La pagination ne doit pas vider la table à chaque page : garder la
    // précédente évite un clignotement à chaque clic sur « Suivantes ».
    placeholderData: keepPreviousData,
  });

  const setFilter = (patch: Partial<Filters>) => {
    setOffset(0);
    setFilters(current => ({ ...current, ...patch }));
  };

  if (!isAdmin) {
    return (
      <>
        <PageMeta crumb={[{ label: 'Journal d’audit' }]} />
        <div className="card">
          <EmptyState icon="lock" title="Accès réservé"
                      text="Seuls les administrateurs consultent le journal d’audit." />
        </div>
      </>
    );
  }

  const exportCsv = async () => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(effective)) if (value) params.set(key, value);
    try {
      await download(`/api/audit/export?${params}`);
      toast('Export généré', 'Le fichier a été téléchargé.', 'ok');
    } catch (error) {
      toast('Export impossible', (error as Error).message, 'error');
    }
  };

  const actions = (
    <>
      <button className="btn" onClick={() => setHelpOpen(true)}>
        <Icon name="info" /><span className="nowrap">Ce qui est journalisé</span>
      </button>
      <button className="btn primary" onClick={exportCsv}>
        <Icon name="download" /><span className="nowrap">Exporter en CSV</span>
      </button>
    </>
  );

  if (error) {
    return (
      <>
        <PageMeta crumb={[{ label: 'Journal d’audit' }]} actions={actions} />
        <ErrorState error={error} onRetry={() => void refetch()} />
      </>
    );
  }

  if (isLoading || !data) {
    return <><PageMeta crumb={[{ label: 'Journal d’audit' }]} actions={actions} /><Loader /></>;
  }

  const summary = data.summary;
  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <>
      <PageMeta crumb={[{ label: 'Journal d’audit' }]} actions={actions} />

      <div className="page-head">
        <div>
          <h1>Journal d’audit</h1>
          <p className="sub">
            Trace des connexions, des changements de droits, des modifications de données
            et des exports. Conservation : {data.retentionDays} jours.
          </p>
        </div>
      </div>

      <div className="grid cols-4 mb-2">
        <Stat label="Entrées au journal" value={fmtNum(summary.totalEntries)} icon="book"
              hint={summary.oldest ? `depuis le ${fmtDate(summary.oldest)}` : 'aucune entrée'} />
        <Stat label="Échecs de connexion" value={fmtNum(summary.failedLogins24h)} icon="xCircle"
              hint="dernières 24 heures" tone={summary.failedLogins24h > 0 ? 'warn' : ''} />
        <Stat label="Comptes verrouillés" value={fmtNum(summary.lockouts24h)} icon="lock"
              hint="dernières 24 heures" tone={summary.lockouts24h > 0 ? 'danger' : ''} />
        <Stat label="Échecs de second facteur" value={fmtNum(summary.mfaFailures24h)} icon="shield"
              hint="dernières 24 heures" tone={summary.mfaFailures24h > 0 ? 'warn' : ''} />
      </div>

      <div className="toolbar">
        <div className="search-box">
          <Icon name="search" />
          <input className="input" value={filters.q}
                 placeholder="Rechercher une cible, un détail, une adresse IP…"
                 onChange={event => setFilter({ q: event.target.value })} />
        </div>

        <select className="select" style={{ maxWidth: 200 }} value={filters.category}
                onChange={event => setFilter({ category: event.target.value })}>
          <option value="">Toutes les familles</option>
          {data.categories.map(item => (
            <option key={item.code} value={item.code}>{item.label}</option>
          ))}
        </select>

        <select className="select" style={{ maxWidth: 180 }} value={filters.actor}
                onChange={event => setFilter({ actor: event.target.value })}>
          <option value="">Tous les acteurs</option>
          {data.actors.map(actor => <option key={actor} value={actor}>{actor}</option>)}
        </select>

        <select className="select" style={{ maxWidth: 150 }} value={filters.outcome}
                onChange={event => setFilter({ outcome: event.target.value })}>
          <option value="">Tous résultats</option>
          <option value="success">Réussite</option>
          <option value="failure">Échec</option>
        </select>

        <input className="input" type="date" style={{ maxWidth: 160 }} title="À partir du"
               value={filters.since} onChange={event => setFilter({ since: event.target.value })} />
        <input className="input" type="date" style={{ maxWidth: 160 }} title="Jusqu’au"
               value={filters.until} onChange={event => setFilter({ until: event.target.value })} />

        {hasFilters && (
          <button className="btn ghost sm"
                  onClick={() => { setOffset(0); setFilters(EMPTY_FILTERS); }}>
            Réinitialiser
          </button>
        )}
      </div>

      <p className="dim small mb-1">
        {fmtNum(data.total)} {plural(data.total, 'entrée')}
        {data.total > PAGE_SIZE && (
          ` — affichage de ${offset + 1} à ${Math.min(offset + PAGE_SIZE, data.total)}`
        )}
      </p>

      <div className="card">
        {data.entries.length ? (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 150 }}>Horodatage</th>
                  <th style={{ width: 230 }}>Événement</th>
                  <th style={{ width: 130 }}>Acteur</th>
                  <th style={{ width: 120 }}>Adresse IP</th>
                  <th>Cible et détail</th>
                </tr>
              </thead>
              <tbody>{data.entries.map(entry => <Row entry={entry} key={entry.id} />)}</tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="inbox" title="Aucune entrée"
                      text="Aucun événement ne correspond à ces filtres." />
        )}
      </div>

      {data.total > PAGE_SIZE && (
        <div className="flex mt-2" style={{ justifyContent: 'center', gap: 9 }}>
          <button className="btn sm" disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            <Icon name="chevronLeft" />Précédentes
          </button>
          <button className="btn sm" disabled={offset + PAGE_SIZE >= data.total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}>
            Suivantes<Icon name="chevronRight" />
          </button>
        </div>
      )}

      {helpOpen && <WhatIsLogged onClose={() => setHelpOpen(false)} />}
    </>
  );
}

function Row({ entry }: { entry: AuditEntry }) {
  const family = entry.event.split('.')[0];
  const failed = entry.outcome === 'failure';
  const tone = failed ? 'danger' : (EVENT_TONE[family] ?? '');

  return (
    <tr style={failed ? { background: 'var(--danger-soft)' } : undefined}>
      <td className="dim small nowrap mono">{fmtDateTime(entry.at)}</td>
      <td>
        <span className={`badge ${tone}`}>
          {failed && <Icon name="xCircle" />}{entry.eventLabel}
        </span>
        <div className="dim mono" style={{ fontSize: '.68rem', marginTop: 3 }}>{entry.event}</div>
      </td>
      <td className="small">
        {entry.actorName ?? <span className="dim">—</span>}
      </td>
      <td className="dim small mono">{entry.ip ?? '—'}</td>
      <td className="small">
        {entry.targetLabel && <div>{truncate(entry.targetLabel, 90)}</div>}
        {entry.detail && (
          <div className="dim" style={{ fontSize: '.75rem', marginTop: 2 }}>{entry.detail}</div>
        )}
        {!entry.targetLabel && !entry.detail && <span className="dim">—</span>}
      </td>
    </tr>
  );
}

function Stat({ label, value, icon, hint, tone = '' }: {
  label: string; value: string; icon: IconName; hint: string; tone?: string;
}) {
  return (
    <div className="stat">
      <span className="stat-ico"
            style={tone ? { background: `var(--${tone}-soft)`, color: `var(--${tone})` } : undefined}>
        <Icon name={icon} />
      </span>
      <span className="label">{label}</span>
      <span className="value" style={tone ? { color: `var(--${tone})` } : undefined}>{value}</span>
      <span className="hint">{hint}</span>
    </div>
  );
}

/** Rendre explicite le périmètre du journal : un utilisateur doit savoir ce qui
 *  est tracé le concernant, et un auditeur ce sur quoi il peut compter. */
function WhatIsLogged({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Ce qui est journalisé" sub="Périmètre, contenu et limites de la trace"
           wide onClose={onClose}
           footer={<button className="btn primary" onClick={onClose}>Compris</button>}>
      <div className="flex col" style={{ gap: 16 }}>
        <div>
          <h3 className="mb-1">Événements tracés</h3>
          <ul className="loss-list">
            <li><b>Authentification</b> — connexions réussies et échouées, déconnexions,
                verrouillages après tentatives répétées.</li>
            <li><b>Second facteur</b> — activation, désactivation, vérifications échouées,
                usage d’un code de récupération, réinitialisation par un administrateur.</li>
            <li><b>Comptes</b> — création, suppression, changement de mot de passe,
                attribution ou retrait des droits d’administration, désactivation.</li>
            <li><b>Données</b> — création, modification et suppression des clients, des
                réponses de référence, des configurations techniques et des questionnaires.</li>
            <li><b>Exports</b> — chaque génération de fichier, c’est-à-dire chaque sortie
                de données hors de l’outil.</li>
          </ul>
        </div>

        <div>
          <h3 className="mb-1">Informations enregistrées</h3>
          <p className="muted small">
            Pour chaque événement : l’horodatage UTC, le code et le libellé de l’événement,
            le résultat, l’identifiant de l’acteur, son adresse IP, son navigateur, l’objet
            concerné et un court détail factuel.
          </p>
        </div>

        <div className="callout">
          <Icon name="lock" />
          <div>
            <p><b>Ce qui n’est jamais journalisé</b></p>
            <p className="muted small mt-1">
              Aucun mot de passe, aucun jeton de session, aucun secret d’authentification,
              aucun code de récupération — même haché ou tronqué. Aucun contenu métier
              complet non plus : le journal retient la question et l’objet touché, jamais
              le texte des réponses de conformité de vos clients.
            </p>
            <p className="muted small mt-1">
              Les simples consultations ne sont pas tracées. Journaliser chaque lecture
              noierait les événements qui engagent réellement, sans rien prouver d’utile
              à cette échelle.
            </p>
          </div>
        </div>

        <div className="callout">
          <Icon name="alert" />
          <div>
            <p><b>Limites à connaître</b></p>
            <p className="muted small mt-1">
              Le journal est en ajout seul du point de vue de l’application : aucun écran ne
              permet d’en modifier ou d’en supprimer une ligne, et la purge de rétention se
              journalise elle-même. En revanche, tout compte disposant de droits d’écriture
              sur la base SQL peut techniquement l’altérer. Pour une valeur probante
              opposable, restreignez les droits du compte applicatif à
              <span className="mono"> INSERT</span> sur cette table et exportez
              périodiquement le journal vers un stockage en écriture unique.
            </p>
          </div>
        </div>
      </div>
    </Modal>
  );
}
