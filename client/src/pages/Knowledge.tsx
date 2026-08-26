import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/api/client';
import { keys, useClients, useMeta } from '@/api/queries';
import type { KbEntry } from '@/api/types';
import { Icon } from '@/components/Icon';
import { EmptyState, Loader } from '@/components/Ui';
import { KbCard } from '@/components/domain/KbCard';
import { KbForm } from '@/components/forms/KbForm';
import { PageMeta } from '@/components/layout/Shell';
import { useDebounced } from '@/lib/useDebounced';
import { fmtNum, plural } from '@/lib/format';

/** Portée « générique uniquement » : aucun client réel ne porte cet identifiant,
 *  la requête ne remonte donc que les entrées partagées. */
const GENERIC_ONLY = -1;

export function KnowledgePage() {
  const [params] = useSearchParams();
  const { data: clients = [] } = useClients();
  const { data: meta } = useMeta();

  const [term, setTerm] = useState(params.get('q') ?? '');
  const [scope, setScope] = useState(params.get('client') ?? '');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<KbEntry | null>(null);
  const [adding, setAdding] = useState(false);

  const debounced = useDebounced(term, 260);

  const query = (() => {
    if (scope === 'generic') return { clientId: GENERIC_ONLY, includeGeneric: true };
    if (scope) return { clientId: Number(scope), includeGeneric: false };
    return {};
  })();

  const { data: entries = [], isLoading } = useQuery({
    queryKey: [...keys.kb, 'list', scope, debounced, category, status],
    queryFn: () => api.get<KbEntry[]>('/api/kb', {
      ...query, q: debounced, category, status,
    }),
  });

  const actions = (
    <button className="btn primary" onClick={() => setAdding(true)}>
      <Icon name="plus" /><span className="nowrap">Nouvelle réponse</span>
    </button>
  );

  return (
    <>
      <PageMeta crumb={[{ label: 'Base de connaissance' }]} actions={actions} />

      <div className="page-head">
        <div>
          <h1>Base de connaissance</h1>
          <p className="sub">
            Le patrimoine de réponses réutilisables. Les entrées <em>génériques</em> servent
            tous les clients ; les entrées rattachées à un client ne sortent jamais de son
            dossier.
          </p>
        </div>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <Icon name="search" />
          <input className="input" value={term}
                 placeholder="Rechercher une question, une réponse, un mot-clé…"
                 onChange={event => setTerm(event.target.value)} />
        </div>

        <select className="select" style={{ maxWidth: 250 }} value={scope}
                onChange={event => setScope(event.target.value)}>
          <option value="">Toutes les portées</option>
          <option value="generic">Génériques uniquement</option>
          {clients.map(client => (
            <option key={client.id} value={client.id}>{client.name}</option>
          ))}
        </select>

        <select className="select" style={{ maxWidth: 220 }} value={category}
                onChange={event => setCategory(event.target.value)}>
          <option value="">Toutes les catégories</option>
          {(meta?.categories ?? []).map(item => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>

        <select className="select" style={{ maxWidth: 170 }} value={status}
                onChange={event => setStatus(event.target.value)}>
          <option value="">Tous les statuts</option>
          <option value="validated">Validées</option>
          <option value="draft">Brouillons</option>
          <option value="obsolete">Obsolètes</option>
        </select>
      </div>

      {entries.length > 0 && (
        <p className="dim small mb-1">
          {fmtNum(entries.length)} {plural(entries.length, 'réponse')}
        </p>
      )}

      {isLoading ? <Loader /> : entries.length ? (
        entries.map(entry => <KbCard entry={entry} key={entry.id} onEdit={setEditing} />)
      ) : (
        <div className="card">
          <EmptyState icon="book" title="Aucune réponse"
            text="Ajoutez vos réponses de référence : chaque entrée sera automatiquement proposée pour les questions équivalentes des questionnaires clients."
            action={<button className="btn primary" onClick={() => setAdding(true)}>
              Ajouter une réponse
            </button>} />
        </div>
      )}

      {(adding || editing) && (
        <KbForm entry={editing} onClose={() => { setAdding(false); setEditing(null); }} />
      )}
    </>
  );
}
