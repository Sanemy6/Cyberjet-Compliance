import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/api/client';
import { keys } from '@/api/queries';
import type { Control, Framework } from '@/api/types';
import { Icon } from '@/components/Icon';
import { ErrorState, Loader } from '@/components/Ui';
import { PageMeta } from '@/components/layout/Shell';
import { useDebounced } from '@/lib/useDebounced';
import { fmtNum } from '@/lib/format';

export function FrameworksPage() {
  const [params] = useSearchParams();
  const [term, setTerm] = useState('');
  const debounced = useDebounced(term, 200);

  const { data: frameworks = [], isLoading, error, refetch } = useQuery({
    queryKey: keys.frameworks,
    queryFn: () => api.get<Framework[]>('/api/frameworks'),
    staleTime: 5 * 60_000,
  });

  const active = Number(params.get('fw')) || frameworks[0]?.id;

  const { data: controls = [], isLoading: controlsLoading } = useQuery({
    queryKey: [...keys.controls, active],
    queryFn: () => api.get<Control[]>(`/api/frameworks/${active}/controls`),
    enabled: Boolean(active),
    staleTime: 5 * 60_000,
  });

  const framework = frameworks.find(entry => entry.id === active);
  const covered = controls.filter(control => control.nKb > 0).length;

  // Regroupement par thème : 93 contrôles à plat sont illisibles, et le thème
  // est exactement la façon dont les référentiels eux-mêmes les présentent.
  const byTheme = useMemo(() => {
    const needle = debounced.trim().toLowerCase();
    const filtered = needle
      ? controls.filter(control =>
          `${control.ref} ${control.title} ${control.description ?? ''} ${control.theme ?? ''}`
            .toLowerCase().includes(needle))
      : controls;

    const groups = new Map<string, Control[]>();
    for (const control of filtered) {
      const key = control.theme || '—';
      const bucket = groups.get(key);
      if (bucket) bucket.push(control);
      else groups.set(key, [control]);
    }
    return [...groups.entries()];
  }, [controls, debounced]);

  if (error) {
    return (
      <>
        <PageMeta crumb={[{ label: 'Référentiels' }]} />
        <ErrorState error={error} onRetry={() => void refetch()} />
      </>
    );
  }

  if (isLoading) return <><PageMeta crumb={[{ label: 'Référentiels' }]} /><Loader /></>;

  return (
    <>
      <PageMeta crumb={[{ label: 'Référentiels' }]} />

      <div className="page-head">
        <div>
          <h1>Référentiels</h1>
          <p className="sub">
            Les contrôles servent d’ancrage : une réponse rattachée à{' '}
            <span className="mono">IS.I.OR.205</span> ou <span className="mono">A.8.24</span>{' '}
            est proposée en priorité dès qu’un questionnaire cite cette référence.
          </p>
        </div>
      </div>

      <div className="grid cols-3 mb-2">
        {frameworks.map(entry => (
          <Link className="card clickable" key={entry.id} to={`/frameworks?fw=${entry.id}`}
                replace
                style={{
                  textDecoration: 'none', color: 'inherit',
                  borderColor: entry.id === active ? 'var(--accent)' : undefined,
                }}>
            <div className="card-body">
              <div className="flex between" style={{ alignItems: 'flex-start', gap: 10 }}>
                <div className="grow">
                  <h3>{entry.name}</h3>
                  <p className="dim small">{entry.version}</p>
                </div>
                <span className="badge accent nowrap">{entry.nControls}</span>
              </div>
              <p className="muted small mt-2">{entry.description}</p>
              <p className="dim mt-1" style={{ fontSize: '.75rem' }}>
                <Icon name="shield" /> {entry.authority}
              </p>
            </div>
          </Link>
        ))}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>
            {framework?.name ?? 'Contrôles'}
            <span className="dim small" style={{ fontWeight: 400 }}>
              {' '}— {fmtNum(covered)} / {fmtNum(controls.length)} contrôles couverts
            </span>
          </h2>
          <div className="search-box" style={{ maxWidth: 320 }}>
            <Icon name="search" />
            <input className="input" value={term} placeholder="Filtrer les contrôles…"
                   onChange={event => setTerm(event.target.value)} />
          </div>
        </div>

        {controlsLoading ? <Loader /> : byTheme.length === 0 ? (
          <p className="dim" style={{ padding: 22 }}>Aucun contrôle ne correspond.</p>
        ) : byTheme.map(([theme, items]) => (
          <div key={theme}>
            <p style={{
              padding: '11px 18px 7px', fontSize: '.72rem', textTransform: 'uppercase',
              letterSpacing: '.07em', fontWeight: 650, color: 'var(--text-3)',
              background: 'var(--surface-2)', borderBottom: '1px solid var(--border)',
            }}>
              {theme} · {items.length}
            </p>
            {items.map(control => (
              <div className="row-item" key={control.id}>
                <span className="badge ref nowrap" style={{ marginTop: 2 }}>{control.ref}</span>
                <div className="row-main">
                  <div className="row-title">{control.title}</div>
                  {control.description && (
                    <div className="row-sub dim">{control.description}</div>
                  )}
                </div>
                <div className="row-actions">
                  {control.nKb > 0 ? (
                    <Link className="badge ok" to="/kb"
                          title={`${control.nKb} réponse(s) rattachée(s)`}>
                      <Icon name="check" />{control.nKb}
                    </Link>
                  ) : (
                    <span className="badge outline">Non couvert</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
