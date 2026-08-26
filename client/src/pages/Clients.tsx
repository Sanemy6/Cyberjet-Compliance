import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useClients } from '@/api/queries';
import type { ClientRow } from '@/api/types';
import { Icon } from '@/components/Icon';
import { ClientStatusBadge, EmptyState, Loader } from '@/components/Ui';
import { ClientForm } from '@/components/forms/ClientForm';
import { PageMeta } from '@/components/layout/Shell';
import { useDebounced } from '@/lib/useDebounced';
import { fmtNum, plural, truncate } from '@/lib/format';

export function ClientsPage() {
  const navigate = useNavigate();
  const { data: clients = [], isLoading } = useClients();
  const [creating, setCreating] = useState(false);
  const [term, setTerm] = useState('');
  const debounced = useDebounced(term, 180);

  // Filtrage local : la liste des dossiers tient en mémoire, un aller-retour
  // serveur par frappe serait du gâchis.
  const filtered = useMemo(() => {
    const needle = debounced.trim().toLowerCase();
    if (!needle) return clients;
    return clients.filter(client =>
      [client.name, client.country, client.contact, client.description, client.status]
        .some(field => (field ?? '').toLowerCase().includes(needle)));
  }, [clients, debounced]);

  const actions = (
    <button className="btn primary" onClick={() => setCreating(true)}>
      <Icon name="plus" /><span className="nowrap">Nouveau client</span>
    </button>
  );

  const form = creating && (
    <ClientForm onClose={() => setCreating(false)}
                onSaved={client => navigate(`/clients/${client.id}`)} />
  );

  if (isLoading) return <><PageMeta crumb={[{ label: 'Clients' }]} actions={actions} /><Loader /></>;

  if (!clients.length) {
    return (
      <>
        <PageMeta crumb={[{ label: 'Clients' }]} actions={actions} />
        <div className="page-head"><div><h1>Clients</h1></div></div>
        <div className="card">
          <EmptyState icon="users" title="Aucun client enregistré"
            text="Créez un dossier par compagnie ou organisme afin d’y rattacher ses réponses, ses configurations techniques et ses questionnaires."
            action={<button className="btn primary" onClick={() => setCreating(true)}>
              Créer un client
            </button>} />
        </div>
        {form}
      </>
    );
  }

  return (
    <>
      <PageMeta crumb={[{ label: 'Clients' }]} actions={actions} />

      <div className="page-head">
        <div>
          <h1>Clients</h1>
          <p className="sub">
            {fmtNum(clients.length)} {plural(clients.length, 'dossier')} de conformité.
          </p>
        </div>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <Icon name="search" />
          <input className="input" value={term}
                 placeholder="Rechercher un client, un pays, un contact…"
                 onChange={event => setTerm(event.target.value)} />
        </div>
      </div>

      {filtered.length === 0
        ? <p className="dim">Aucun client ne correspond à cette recherche.</p>
        : <div className="grid cols-3">{filtered.map(client => (
            <ClientCard client={client} key={client.id} />
          ))}</div>}

      {form}
    </>
  );
}

function ClientCard({ client }: { client: ClientRow }) {
  const mark = client.name.split(/\s+/).slice(0, 2)
    .map(word => word[0]).join('').toUpperCase();

  const subtitle = [client.country, client.contact].filter(Boolean).join(' · ');

  return (
    <Link className="card clickable" to={`/clients/${client.id}`}
          style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className="card-body">
        <div className="flex" style={{ alignItems: 'flex-start', gap: 12 }}>
          <span className="brand-mark" style={{
            background: 'var(--accent-soft)', borderColor: 'transparent',
            color: 'var(--accent)', fontWeight: 650, fontSize: '.85rem',
          }}>{mark}</span>
          <div className="grow">
            <div className="flex between" style={{ gap: 8 }}>
              <h3 className="truncate">{client.name}</h3>
              <ClientStatusBadge status={client.status} />
            </div>
            {subtitle && <p className="dim small truncate">{subtitle}</p>}
          </div>
        </div>

        {client.description && (
          <p className="muted small mt-2">{truncate(client.description, 120)}</p>
        )}

        <div className="flex wrap mt-2" style={{ gap: 6 }}>
          <span className="badge">
            <Icon name="book" />{client.nKb} {plural(client.nKb, 'réponse')}
          </span>
          <span className="badge"><Icon name="settings" />{client.nConfigs} config.</span>
          <span className="badge">
            <Icon name="fileText" />{client.nQuestionnaires} {plural(client.nQuestionnaires, 'questionnaire')}
          </span>
        </div>
      </div>
    </Link>
  );
}
