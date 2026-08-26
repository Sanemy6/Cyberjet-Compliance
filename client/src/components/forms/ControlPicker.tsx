import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { ControlChip } from '@/api/types';
import { Icon } from '../Icon';
import { useDebounced } from '@/lib/useDebounced';

/**
 * Sélecteur de contrôles normatifs.
 *
 * Rattacher une réponse à `IS.I.OR.205` ou `A.8.24` la fait remonter en priorité
 * dès qu'un questionnaire cite cette référence : c'est le seul endroit où ce
 * lien se pose, il doit donc rester rapide à utiliser.
 */
export function ControlPicker({ selected, onChange }: {
  selected: ControlChip[];
  onChange: (controls: ControlChip[]) => void;
}) {
  const [term, setTerm] = useState('');
  const debounced = useDebounced(term, 220);

  const { data: results = [] } = useQuery({
    queryKey: ['controls', 'search', debounced],
    queryFn: () => api.get<ControlChip[]>('/api/controls', { q: debounced, limit: 60 }),
    staleTime: 60_000,
  });

  const selectedIds = useMemo(() => new Set(selected.map(c => c.id)), [selected]);

  return (
    <>
      <div className="search-box" style={{ marginBottom: 8 }}>
        <Icon name="search" />
        <input className="input" value={term}
               placeholder="Rechercher un contrôle : IS.I.OR.205, A.8.24, chiffrement…"
               onChange={event => setTerm(event.target.value)} />
      </div>

      <div className="chips" style={{ marginBottom: 8 }}>
        {selected.length === 0
          ? <span className="dim small">Aucun contrôle rattaché.</span>
          : selected.map(control => (
            <span className="chip on" key={control.id} title={control.title}>
              <b>{control.frameworkCode}</b> {control.ref}
              <span className="x" role="button" tabIndex={0}
                    onClick={() => onChange(selected.filter(c => c.id !== control.id))}
                    onKeyDown={event => {
                      if (event.key === 'Enter')
                        onChange(selected.filter(c => c.id !== control.id));
                    }}>
                <Icon name="x" />
              </span>
            </span>
          ))}
      </div>

      <div style={{
        maxHeight: 190, overflowY: 'auto',
        border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
      }}>
        {results.length === 0 && (
          <p className="dim small" style={{ padding: 12 }}>Aucun contrôle trouvé.</p>
        )}
        {results.map(control => (
          <div className="row-item clickable" key={control.id} style={{ padding: '8px 12px' }}
               role="button" tabIndex={0}
               onClick={() => { if (!selectedIds.has(control.id)) onChange([...selected, control]); }}
               onKeyDown={event => {
                 if (event.key === 'Enter' && !selectedIds.has(control.id))
                   onChange([...selected, control]);
               }}>
            <div className="row-main">
              <div className="flex" style={{ gap: 7 }}>
                <span className="badge ref"><b>{control.frameworkCode}</b> {control.ref}</span>
                <span className="small">{control.title}</span>
              </div>
            </div>
            <Icon name={selectedIds.has(control.id) ? 'check' : 'plus'} />
          </div>
        ))}
      </div>
    </>
  );
}

/** Réinitialise la sélection quand le formulaire change d'entrée éditée. */
export function useControlSelection(initial: ControlChip[]) {
  const [selected, setSelected] = useState<ControlChip[]>(initial);
  const signature = initial.map(c => c.id).join(',');

  useEffect(() => {
    setSelected(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return [selected, setSelected] as const;
}
