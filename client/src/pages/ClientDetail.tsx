import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/api/client';
import { keys, useInvalidateAll } from '@/api/queries';
import type {
  ClientDetail, ConfigItem, KbEntry, QuestionnaireRow as QuestionnaireRowType,
} from '@/api/types';
import { Icon, type IconName } from '@/components/Icon';
import {
  ClientStatusBadge, CoverageList, EmptyState, ErrorState, Loader,
} from '@/components/Ui';
import { useToast } from '@/components/Toast';
import { useDialogs } from '@/components/Dialogs';
import { ClientForm } from '@/components/forms/ClientForm';
import { KbForm } from '@/components/forms/KbForm';
import { ConfigForm } from '@/components/forms/ConfigForm';
import { KbCard } from '@/components/domain/KbCard';
import { ConfigGroups } from '@/components/domain/ConfigGroups';
import { QuestionnaireRow } from '@/components/domain/QuestionnaireRow';
import { UploadDialog } from '@/components/domain/UploadDialog';
import { PageMeta } from '@/components/layout/Shell';
import { useDebounced } from '@/lib/useDebounced';
import { fmtNum } from '@/lib/format';

type Tab = 'overview' | 'kb' | 'configs' | 'questionnaires';

const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: 'overview', label: 'Vue d’ensemble', icon: 'grid' },
  { key: 'kb', label: 'Base de connaissance', icon: 'book' },
  { key: 'configs', label: 'Configurations', icon: 'settings' },
  { key: 'questionnaires', label: 'Questionnaires', icon: 'fileText' },
];

export function ClientDetailPage() {
  const { clientId: raw } = useParams();
  const clientId = Number(raw);
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') ?? 'overview') as Tab;

  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);

  const { data: client, isLoading, error, refetch } = useQuery({
    queryKey: keys.client(clientId),
    queryFn: () => api.get<ClientDetail>(`/api/clients/${clientId}`),
  });

  if (error) {
    return (
      <>
        <PageMeta crumb={[{ label: 'Clients', to: '/clients' }, { label: 'Dossier' }]} />
        <ErrorState error={error} onRetry={() => void refetch()} />
      </>
    );
  }

  if (isLoading || !client) return <Loader />;

  const counts: Partial<Record<Tab, number>> = {
    kb: client.nKb, configs: client.nConfigs, questionnaires: client.nQuestionnaires,
  };

  const actions = (
    <>
      <button className="btn" onClick={() => setEditing(true)}>
        <Icon name="edit" /><span className="nowrap">Modifier</span>
      </button>
      <button className="btn primary" onClick={() => setUploading(true)}>
        <Icon name="upload" /><span className="nowrap">Téléverser un questionnaire</span>
      </button>
    </>
  );

  const subtitle = [client.country, client.contact].filter(Boolean).join(' · ');

  return (
    <>
      <PageMeta actions={actions}
                crumb={[{ label: 'Clients', to: '/clients' }, { label: client.name }]} />

      <div className="page-head">
        <div>
          <div className="flex wrap" style={{ alignItems: 'center', gap: 10 }}>
            <h1>{client.name}</h1>
            <ClientStatusBadge status={client.status} />
          </div>
          {subtitle && <p className="sub">{subtitle}</p>}
        </div>
      </div>

      <div className="tabs">
        {TABS.map(entry => (
          <button key={entry.key} className={`tab ${entry.key === tab ? 'active' : ''}`}
                  onClick={() => setParams({ tab: entry.key }, { replace: true })}>
            <Icon name={entry.icon} />{entry.label}
            {counts[entry.key] !== undefined && (
              <span className="count">{counts[entry.key]}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview client={client} />}
      {tab === 'kb' && <KbPanel client={client} />}
      {tab === 'configs' && <ConfigPanel client={client} />}
      {tab === 'questionnaires' && (
        <QuestionnairePanel client={client} onUpload={() => setUploading(true)} />
      )}

      {editing && <ClientForm client={client} onClose={() => setEditing(false)} />}
      {uploading && (
        <UploadDialog clientId={client.id} onClose={() => setUploading(false)} />
      )}
    </>
  );
}

// --------------------------------------------------------------------------
// Vue d'ensemble
// --------------------------------------------------------------------------

function Overview({ client }: { client: ClientDetail }) {
  const toast = useToast();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const { confirmByTyping } = useDialogs();
  const [addingKb, setAddingKb] = useState(false);
  const [addingConfig, setAddingConfig] = useState(false);

  const remove = async () => {
    const losses: [number, string, string][] = [
      [client.nKb, 'réponse de référence', 'réponses de référence'],
      [client.nConfigs, 'configuration technique', 'configurations techniques'],
      [client.nQuestionnaires, 'questionnaire traité', 'questionnaires traités'],
    ];
    const present = losses.filter(([n]) => n > 0);

    const warning = (
      <div className="callout danger">
        <Icon name="alert" />
        <div>
          <p><b>Cette action est irréversible.</b> Seront supprimés avec le dossier :</p>
          {present.length ? (
            <ul className="loss-list">
              {present.map(([n, one, many]) => (
                <li key={one}><b>{n}</b> {n > 1 ? many : one}</li>
              ))}
            </ul>
          ) : (
            <p className="muted small mt-1">
              Ce dossier est vide — aucune donnée métier ne sera perdue.
            </p>
          )}
          {client.nQuestionnaires > 0 && (
            <p className="muted small mt-1">
              Les fichiers reçus du client et leurs réponses seront également effacés du disque.
            </p>
          )}
        </div>
      </div>
    );

    const confirmed = await confirmByTyping({
      title: 'Supprimer ce client ?',
      sub: client.name,
      warning,
      expected: client.name,
      confirmLabel: 'Supprimer définitivement',
    });
    if (!confirmed) return;

    try {
      await api.del(`/api/clients/${client.id}`);
      invalidate();
      toast('Client supprimé', client.name, 'ok');
      navigate('/clients');
    } catch (error) {
      toast('Suppression impossible', (error as Error).message, 'error');
    }
  };

  return (
    <div className="grid side">
      <div className="flex col" style={{ gap: 16 }}>
        <div className="grid cols-3">
          <MiniStat label="Réponses de référence" value={client.nKb} icon="book"
                    to={`/clients/${client.id}?tab=kb`} />
          <MiniStat label="Configurations techniques" value={client.nConfigs} icon="settings"
                    to={`/clients/${client.id}?tab=configs`} />
          <MiniStat label="Questionnaires" value={client.nQuestionnaires} icon="fileText"
                    to={`/clients/${client.id}?tab=questionnaires`} />
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Couverture des référentiels</h2>
            <span className="dim small">Contrôles reliés à au moins une réponse disponible</span>
          </div>
          <div className="card-body"><CoverageList coverage={client.coverage} /></div>
        </div>

        {client.description && (
          <div className="card">
            <div className="card-head"><h2>Contexte et périmètre</h2></div>
            <div className="card-body">
              <p className="muted pre-wrap">{client.description}</p>
            </div>
          </div>
        )}

        <div className="card danger-zone">
          <div className="card-head"><h2>Zone de danger</h2></div>
          <div className="card-body flex between wrap" style={{ gap: 14 }}>
            <div className="grow" style={{ minWidth: 260 }}>
              <div className="row-title">Supprimer ce client</div>
              <p className="muted small mt-1">
                Efface définitivement le dossier et tout ce qu’il contient. Les réponses
                génériques de la base commune ne sont pas affectées.
              </p>
            </div>
            <button className="btn danger" onClick={remove}>
              <Icon name="trash" />Supprimer
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Actions rapides</h2></div>
        <div className="card-body flex col" style={{ gap: 9 }}>
          <button className="btn block" onClick={() => setAddingKb(true)}>
            <Icon name="plus" />Ajouter une réponse
          </button>
          <button className="btn block" onClick={() => setAddingConfig(true)}>
            <Icon name="plus" />Ajouter une configuration
          </button>
          <Link className="btn block" to={`/assistant?client=${client.id}`}>
            <Icon name="search" />Tester une question
          </Link>
        </div>
        <div className="card-foot" style={{ justifyContent: 'flex-start' }}>
          <p className="dim" style={{ fontSize: '.75rem', lineHeight: 1.5 }}>
            Les réponses génériques de la base commune s’ajoutent automatiquement à celles
            de ce client lors du traitement d’un questionnaire.
          </p>
        </div>
      </div>

      {addingKb && <KbForm clientId={client.id} onClose={() => setAddingKb(false)} />}
      {addingConfig && (
        <ConfigForm clientId={client.id} onClose={() => setAddingConfig(false)} />
      )}
    </div>
  );
}

function MiniStat({ label, value, icon, to }: {
  label: string; value: number; icon: IconName; to: string;
}) {
  return (
    <Link className="stat" to={to} style={{ textDecoration: 'none', color: 'inherit' }}>
      <span className="stat-ico"><Icon name={icon} /></span>
      <span className="label">{label}</span>
      <span className="value">{fmtNum(value)}</span>
    </Link>
  );
}

// --------------------------------------------------------------------------
// Base de connaissance du client
// --------------------------------------------------------------------------

function KbPanel({ client }: { client: ClientDetail }) {
  const [includeGeneric, setIncludeGeneric] = useState(true);
  const [term, setTerm] = useState('');
  const debounced = useDebounced(term, 240);
  const [editing, setEditing] = useState<KbEntry | null>(null);
  const [adding, setAdding] = useState(false);

  const { data: entries = [], isLoading } = useQuery({
    queryKey: [...keys.kb, client.id, includeGeneric, debounced],
    queryFn: () => api.get<KbEntry[]>('/api/kb', {
      clientId: client.id, includeGeneric, q: debounced,
    }),
  });

  return (
    <>
      <div className="toolbar">
        <div className="search-box">
          <Icon name="search" />
          <input className="input" value={term} placeholder="Rechercher dans les réponses…"
                 onChange={event => setTerm(event.target.value)} />
        </div>
        <label className="switch">
          <input type="checkbox" checked={includeGeneric}
                 onChange={event => setIncludeGeneric(event.target.checked)} />
          <span className="track" />
          <span>Inclure les réponses génériques</span>
        </label>
        <button className="btn primary" onClick={() => setAdding(true)}>
          <Icon name="plus" />Ajouter
        </button>
      </div>

      {isLoading ? <Loader /> : entries.length ? (
        entries.map(entry => (
          <KbCard entry={entry} key={entry.id} onEdit={setEditing} />
        ))
      ) : (
        <div className="card">
          <EmptyState icon="book"
            title={debounced ? 'Aucun résultat' : 'Base de connaissance vide'}
            text={debounced
              ? 'Aucune réponse ne correspond à cette recherche.'
              : 'Ajoutez les réponses de référence de ce client : elles seront réutilisées automatiquement dans les questionnaires.'} />
        </div>
      )}

      {(adding || editing) && (
        <KbForm entry={editing} clientId={client.id}
                onClose={() => { setAdding(false); setEditing(null); }} />
      )}
    </>
  );
}

// --------------------------------------------------------------------------
// Configurations techniques
// --------------------------------------------------------------------------

function ConfigPanel({ client }: { client: ClientDetail }) {
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const { confirm } = useDialogs();
  const [editing, setEditing] = useState<ConfigItem | null>(null);
  const [adding, setAdding] = useState(false);

  const { data: configs = [], isLoading } = useQuery({
    queryKey: [...keys.configs, client.id],
    queryFn: () => api.get<ConfigItem[]>('/api/configs', { clientId: client.id }),
  });

  const remove = async (config: ConfigItem) => {
    const ok = await confirm({
      title: 'Supprimer cette configuration ?',
      message: `« ${config.label} » ne sera plus utilisée pour répondre aux questionnaires.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;

    try {
      await api.del(`/api/configs/${config.id}`);
      invalidate();
      toast('Configuration supprimée', '', 'ok');
    } catch (error) {
      toast('Suppression impossible', (error as Error).message, 'error');
    }
  };

  return (
    <>
      <div className="toolbar">
        <p className="grow muted small">
          Faits techniques précis du client. Le moteur les injecte directement dans les
          réponses — par exemple « quel chiffrement au repos ? » renvoie la valeur saisie ici.
        </p>
        <button className="btn primary" onClick={() => setAdding(true)}>
          <Icon name="plus" />Ajouter une configuration
        </button>
      </div>

      {isLoading ? <Loader /> : configs.length ? (
        <ConfigGroups configs={configs} onEdit={setEditing} onDelete={remove} />
      ) : (
        <div className="card">
          <EmptyState icon="settings" title="Aucune configuration enregistrée"
            text="Décrivez les dispositifs en place : chiffrement au repos et en transit, authentification, sauvegardes, journalisation, hébergement…" />
        </div>
      )}

      {(adding || editing) && (
        <ConfigForm config={editing} clientId={client.id}
                    onClose={() => { setAdding(false); setEditing(null); }} />
      )}
    </>
  );
}

// --------------------------------------------------------------------------
// Questionnaires du client
// --------------------------------------------------------------------------

function QuestionnairePanel({ client, onUpload }: {
  client: ClientDetail;
  onUpload: () => void;
}) {
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const { confirm } = useDialogs();

  const { data: list = [], isLoading } = useQuery({
    queryKey: [...keys.questionnaires, client.id],
    queryFn: () => api.get<QuestionnaireRowType[]>('/api/questionnaires', {
      clientId: client.id,
    }),
  });

  const remove = async (questionnaire: QuestionnaireRowType) => {
    const ok = await confirm({
      title: 'Supprimer ce questionnaire ?',
      message: 'Les questions et les réponses saisies seront perdues. '
             + 'La base de connaissance n’est pas affectée.',
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;

    try {
      await api.del(`/api/questionnaires/${questionnaire.id}`);
      invalidate();
      toast('Questionnaire supprimé', '', 'ok');
    } catch (error) {
      toast('Suppression impossible', (error as Error).message, 'error');
    }
  };

  if (isLoading) return <Loader />;

  if (!list.length) {
    return (
      <div className="card">
        <EmptyState icon="inbox" title="Aucun questionnaire"
          text="Téléversez le questionnaire sécurité reçu de ce client : le moteur proposera une réponse pour chaque question reconnue."
          action={<button className="btn primary" onClick={onUpload}>
            Téléverser un questionnaire
          </button>} />
      </div>
    );
  }

  return (
    <div className="card">
      <div className="rows">
        {list.map(questionnaire => (
          <QuestionnaireRow key={questionnaire.id} questionnaire={questionnaire}
                            showClient={false} onDelete={remove} />
        ))}
      </div>
    </div>
  );
}
