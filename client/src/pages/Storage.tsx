import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/api/client';
import { keys } from '@/api/queries';
import type { StorageReport } from '@/api/types';
import { Icon, type IconName } from '@/components/Icon';
import { CoverageList, EmptyState, ErrorState, Loader } from '@/components/Ui';
import { PageMeta } from '@/components/layout/Shell';
import { fmtBytes, fmtMonth, fmtNum } from '@/lib/format';

/** Mesures relevées sur ce projet avec des réponses de longueur réaliste
 *  (75 mots en moyenne). Elles servent de repère de dimensionnement. */
const BENCHMARK = [
  { entries: 250, mb: 0.3, seconds: 0.4 },
  { entries: 1000, mb: 0.9, seconds: 1.4 },
  { entries: 2500, mb: 2.1, seconds: 3.7 },
  { entries: 5000, mb: 4.1, seconds: 7.4 },
  { entries: 10000, mb: 8.0, seconds: 15.0 },
];

export function StoragePage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: keys.storage,
    queryFn: () => api.get<StorageReport>('/api/storage'),
  });

  if (error) {
    return (
      <>
        <PageMeta crumb={[{ label: 'Volumétrie' }]} />
        <ErrorState error={error} onRetry={() => void refetch()} />
      </>
    );
  }

  if (isLoading || !data) {
    return <><PageMeta crumb={[{ label: 'Volumétrie' }]} /><Loader /></>;
  }

  const { disk, counts, backlog } = data;
  const nearest = BENCHMARK.reduce((best, row) =>
    Math.abs(row.entries - counts.kb) < Math.abs(best - counts.kb) ? row.entries : best,
    BENCHMARK[0].entries);

  return (
    <>
      <PageMeta crumb={[{ label: 'Volumétrie' }]} />

      <div className="page-head">
        <div>
          <h1>Volumétrie et stockage</h1>
          <p className="sub">
            Ce que l’application conserve aujourd’hui, la vitesse à laquelle la base
            s’enrichit, et ce qu’il reste à saisir pour qu’elle réponde seule.
          </p>
        </div>
      </div>

      <div className="grid cols-4 mb-2">
        <Stat label="Espace disque total" value={fmtBytes(disk.total)} icon="database"
              hint={`${fmtNum(disk.uploads.count + disk.exports.count)} fichier(s) hors base`} />
        <Stat label="Réponses de référence" value={fmtNum(counts.kb)} icon="book"
              hint={`${fmtNum(counts.kbGeneric)} génériques · ${fmtNum(counts.configs)} configurations`} />
        <Stat label="Questions traitées" value={fmtNum(counts.questions)} icon="fileText"
              hint={`${fmtNum(counts.questionnaires)} questionnaire(s)`} />
        <Stat label="Éléments indexés" value={fmtNum(counts.indexed)} icon="layers"
              hint={`${fmtNum(counts.controlLinks)} lien(s) vers un contrôle`} />
      </div>

      <div className="grid side">
        <div className="flex col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card-head">
              <h2>Occupation disque</h2>
              <span className="badge">{fmtBytes(disk.total)}</span>
            </div>
            <div className="card-body">
              <DiskBars disk={disk} />
              <p className="dim small mt-2">
                <Icon name="folder" /> Les fichiers reçus et produits sont dans{' '}
                <span className="mono">{disk.path}</span>. La base, elle, est sauvegardée
                par le serveur SQL — les deux entrent dans le plan de reprise.
              </p>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Croissance de la base</h2>
              <span className="dim small">Réponses ajoutées par mois</span>
            </div>
            <div className="card-body"><Growth series={data.growth} /></div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Couverture des référentiels</h2>
              <span className="dim small">Contrôles reliés à au moins une réponse</span>
            </div>
            <div className="card-body"><CoverageList coverage={data.coverage} /></div>
          </div>

          {data.perClient.length > 0 && (
            <div className="card">
              <div className="card-head"><h2>Répartition par client</h2></div>
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th className="num">Réponses</th>
                      <th className="num">Configurations</th>
                      <th className="num">Questions traitées</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.perClient.map(row => (
                      <tr key={row.id}>
                        <td><Link to={`/clients/${row.id}`}>{row.name}</Link></td>
                        <td className="num">{fmtNum(row.nKb)}</td>
                        <td className="num">{fmtNum(row.nConfigs)}</td>
                        <td className="num">{fmtNum(row.nQuestions)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="flex col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card-head"><h2>À alimenter en priorité</h2></div>
            <div className="card-body"><Backlog backlog={backlog} hasEntries={counts.kb > 0} /></div>
          </div>

          <div className="card">
            <div className="card-head"><h2>Repères de dimensionnement</h2></div>
            <div className="card-body">
              <p className="muted small mb-2">
                Mesures relevées avec des réponses de longueur réaliste. La dernière colonne
                correspond au traitement complet d’un questionnaire de 60 questions,
                application fraîchement démarrée.
              </p>
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th className="num">Réponses</th>
                      <th className="num">Base</th>
                      <th className="num">60 questions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {BENCHMARK.map(row => (
                      <tr key={row.entries}
                          style={row.entries === nearest
                            ? { background: 'var(--accent-soft)' } : undefined}>
                        <td className="num">{fmtNum(row.entries)}</td>
                        <td className="num">{String(row.mb).replace('.', ',')} Mo</td>
                        <td className="num">{String(row.seconds).replace('.', ',')} s</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted small mt-2">
                Le stockage n’est pas un facteur limitant : <b>10 000 réponses tiennent dans
                8 Mo de données utiles</b>. C’est le temps de traitement qui croît, de façon
                linéaire, et il reste confortable bien au-delà des volumes réalistes.
                L’index est gardé en mémoire entre deux requêtes : seul le premier
                traitement après démarrage paie la construction.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, icon, hint }: {
  label: string; value: string; icon: IconName; hint: string;
}) {
  return (
    <div className="stat">
      <span className="stat-ico"><Icon name={icon} /></span>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      <span className="hint">{hint}</span>
    </div>
  );
}

function DiskBars({ disk }: { disk: StorageReport['disk'] }) {
  const items: [string, number, string][] = [
    ['Base de données', disk.database.bytes, 'taille allouée sur le serveur SQL, journal compris'],
    ['Fichiers reçus', disk.uploads.bytes, `${disk.uploads.count} questionnaire(s) client`],
    ['Exports produits', disk.exports.bytes, `${disk.exports.count} fichier(s) générés`],
  ];
  const max = Math.max(...items.map(([, bytes]) => bytes), 1);

  return (
    <div className="bar-list">
      {items.map(([label, bytes, hint]) => (
        <div className="bar-row" key={label} title={hint}>
          <span className="bar-label">{label}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${Math.max(2, (bytes / max) * 100)}%` }} />
          </span>
          <span className="bar-value" style={{ minWidth: 64 }}>{fmtBytes(bytes)}</span>
        </div>
      ))}
    </div>
  );
}

function Growth({ series }: { series: StorageReport['growth'] }) {
  const firstActive = series.findIndex(row => row.kb > 0);
  if (firstActive === -1) {
    return (
      <EmptyState icon="activity" title="Pas encore d’historique"
                  text="Les réponses ajoutées apparaîtront ici, mois par mois." />
    );
  }

  const visible = series.slice(firstActive);
  const max = Math.max(...visible.map(row => row.kb), 1);
  const total = visible.reduce((sum, row) => sum + row.kb, 0);
  const average = total / visible.length;

  return (
    <>
      <div className="bar-list">
        {visible.map(row => (
          <div className="bar-row" key={row.month}>
            <span className="bar-label">{fmtMonth(row.month)}</span>
            <span className="bar-track">
              <span className="bar-fill" style={{ width: `${Math.max(2, (row.kb / max) * 100)}%` }} />
            </span>
            <span className="bar-value">{fmtNum(row.kb)}</span>
          </div>
        ))}
      </div>
      <p className="dim small mt-2">
        {fmtNum(total)} réponse(s) sur {visible.length} mois, soit{' '}
        {average.toFixed(average < 10 ? 1 : 0).replace('.', ',')} par mois en moyenne.
      </p>
    </>
  );
}

function Backlog({ backlog, hasEntries }: {
  backlog: StorageReport['backlog'];
  hasEntries: boolean;
}) {
  const items = [
    {
      n: backlog.uncapitalised,
      title: 'réponse(s) rédigée(s) à la main, absente(s) de la base',
      hint: 'Validées pendant une revue sans correspondance trouvée. Tant qu’elles ne sont pas versées dans la base, il faudra les réécrire au prochain client.',
      tone: 'danger', to: '/questionnaires',
    },
    {
      n: backlog.corrected,
      title: 'proposition(s) corrigée(s) avant validation',
      hint: 'La réponse de la base ne convenait pas telle quelle : l’entrée d’origine mérite d’être mise à jour.',
      tone: 'warn', to: '/questionnaires',
    },
    {
      n: backlog.drafts,
      title: 'réponse(s) au statut brouillon',
      hint: 'Elles sont proposées avec une confiance minorée tant qu’elles ne sont pas validées.',
      tone: 'warn', to: '/kb',
    },
    {
      n: backlog.stale,
      title: 'réponse(s) sans revue depuis plus d’un an',
      hint: 'Les certifications, versions et prestataires changent — une réponse périmée dans un questionnaire client coûte cher.',
      tone: 'warn', to: '/kb',
    },
    {
      n: backlog.clientsWithoutConfig,
      title: 'client(s) sans aucune configuration technique',
      hint: 'Sans configurations, les questions factuelles (chiffrement, MFA, hébergement) restent sans réponse précise.',
      tone: 'danger', to: '/clients',
    },
  ].filter(item => item.n > 0);

  if (!items.length) {
    return (
      <div className="flex" style={{ alignItems: 'flex-start', gap: 11 }}>
        <Icon name="checkCircle" />
        <div>
          <div className="row-title">Rien à rattraper</div>
          <p className="muted small mt-1">
            Toutes les réponses validées sont dans la base et à jour.
            {!hasEntries && ' La base est encore vide — commencez par y verser vos réponses récurrentes.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex col" style={{ gap: 14 }}>
      {items.map(item => (
        <Link className="flex" key={item.title} to={item.to}
              style={{ alignItems: 'flex-start', gap: 11, textDecoration: 'none', color: 'inherit' }}>
          <span className={`badge ${item.tone} nowrap`} style={{ marginTop: 2 }}>
            {fmtNum(item.n)}
          </span>
          <div>
            <div className="row-title" style={{ fontSize: '.87rem' }}>{item.title}</div>
            <p className="muted" style={{ fontSize: '.78rem', marginTop: 2 }}>{item.hint}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}
