/* Fiche client : vue d'ensemble, base de connaissance, configurations, questionnaires. */

import { api } from '../api.js';
import { clientForm, configForm, deleteKb, kbForm } from '../forms.js';
import { configGroups, coverageList, kbCard, questionnaireRow } from '../components.js';
import {
  confirmByTyping, confirmDialog, copyText, debounce, emptyState, esc, fmtNum,
  icon, toast,
} from '../ui.js';
import { uploadDialog } from './questionnaires.js';

const TABS = [
  { key: 'overview', label: 'Vue d’ensemble', icon: 'grid' },
  { key: 'kb', label: 'Base de connaissance', icon: 'book' },
  { key: 'configs', label: 'Configurations', icon: 'settings' },
  { key: 'questionnaires', label: 'Questionnaires', icon: 'fileText' },
];

export default async function clientDetail(node, ctx, route) {
  const clientId = Number(route.params[0]);
  const client = await api.get(`/api/clients/${clientId}`);
  const tab = route.query.get('tab') || 'overview';

  ctx.setCrumb([
    { label: 'Clients', href: '#/clients' },
    { label: client.name },
  ]);
  ctx.setActions(`
    <button class="btn" data-edit-client>${icon('edit')}<span class="nowrap">Modifier</span></button>
    <button class="btn primary" data-upload>${icon('upload')}<span class="nowrap">Téléverser un questionnaire</span></button>`);

  document.querySelector('[data-edit-client]').addEventListener('click', () =>
    clientForm(client, () => ctx.refresh()));
  document.querySelector('[data-upload]').addEventListener('click', () =>
    uploadDialog({ clientId, ctx }));

  node.innerHTML = `
    <div class="page-head">
      <div>
        <h1>${esc(client.name)}</h1>
        ${[client.country, client.contact].filter(Boolean).length
          ? `<p class="sub">${[client.country, client.contact].filter(Boolean).map(esc).join(' · ')}</p>`
          : ''}
      </div>
    </div>

    <div class="tabs">
      ${TABS.map((t) => `
        <a class="tab ${t.key === tab ? 'active' : ''}" href="#/clients/${clientId}?tab=${t.key}">
          ${icon(t.icon)}${esc(t.label)}${tabCount(t.key, client)}
        </a>`).join('')}
    </div>

    <div data-panel></div>`;

  const panel = node.querySelector('[data-panel]');
  const renderers = {
    overview: () => overview(panel, client, ctx),
    kb: () => kbPanel(panel, client, ctx),
    configs: () => configPanel(panel, client, ctx),
    questionnaires: () => questionnairePanel(panel, client, ctx),
  };
  await (renderers[tab] || renderers.overview)();
}

function tabCount(key, client) {
  const counts = {
    kb: client.n_kb, configs: client.n_configs, questionnaires: client.n_questionnaires,
  };
  return key in counts ? `<span class="count">${counts[key]}</span>` : '';
}

/* ------------------------------------------------------------------ */
/* Vue d'ensemble                                                       */
/* ------------------------------------------------------------------ */
async function overview(panel, client, ctx) {
  panel.innerHTML = `
    <div class="grid side">
      <div class="flex col" style="gap:16px">
        <div class="grid cols-3">
          ${miniStat('Réponses de référence', client.n_kb, 'book',
            `#/clients/${client.id}?tab=kb`)}
          ${miniStat('Configurations techniques', client.n_configs, 'settings',
            `#/clients/${client.id}?tab=configs`)}
          ${miniStat('Questionnaires', client.n_questionnaires, 'fileText',
            `#/clients/${client.id}?tab=questionnaires`)}
        </div>

        <div class="card">
          <div class="card-head">
            <h2>Couverture des référentiels</h2>
            <span class="dim small">Contrôles reliés à au moins une réponse disponible</span>
          </div>
          <div class="card-body">${coverageList(client.coverage)}</div>
        </div>

        ${client.description ? `
          <div class="card">
            <div class="card-head"><h2>Contexte et périmètre</h2></div>
            <div class="card-body"><p class="muted pre-wrap">${esc(client.description)}</p></div>
          </div>` : ''}

        <div class="card danger-zone">
          <div class="card-head"><h2>Zone de danger</h2></div>
          <div class="card-body flex between wrap" style="gap:14px">
            <div class="grow" style="min-width:260px">
              <div class="row-title">Supprimer ce client</div>
              <p class="muted small mt-1">
                Efface définitivement le dossier et tout ce qu’il contient. Les réponses
                génériques de la base commune ne sont pas affectées.
              </p>
            </div>
            <button class="btn danger" data-delete-client>${icon('trash')}Supprimer</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>Actions rapides</h2></div>
        <div class="card-body flex col" style="gap:9px">
          <button class="btn block" data-add-kb>${icon('plus')}Ajouter une réponse</button>
          <button class="btn block" data-add-config>${icon('plus')}Ajouter une configuration</button>
          <a class="btn block" href="#/assistant?client=${client.id}">${icon('search')}Tester une question</a>
        </div>
        <div class="card-foot" style="justify-content:flex-start">
          <p class="dim" style="font-size:.75rem;line-height:1.5">
            Les réponses génériques de la base commune s’ajoutent automatiquement à
            celles de ce client lors du traitement d’un questionnaire.
          </p>
        </div>
      </div>
    </div>`;

  const clients = await api.get('/api/clients');
  panel.querySelector('[data-add-kb]').addEventListener('click', () =>
    kbForm({ clientId: client.id, clientList: clients, onSaved: () => ctx.refresh() }));
  panel.querySelector('[data-add-config]').addEventListener('click', () =>
    configForm({ clientId: client.id, onSaved: () => ctx.refresh() }));
  panel.querySelector('[data-delete-client]').addEventListener('click', () =>
    deleteClient(client, ctx));
}

async function deleteClient(client, ctx) {
  const losses = [
    [client.n_kb, 'réponse de référence', 'réponses de référence'],
    [client.n_configs, 'configuration technique', 'configurations techniques'],
    [client.n_questionnaires, 'questionnaire traité', 'questionnaires traités'],
  ].filter(([n]) => n > 0);

  const warning = `
    <div class="callout danger">
      ${icon('alert')}
      <div>
        <p><b>Cette action est irréversible.</b> Seront supprimés avec le dossier :</p>
        ${losses.length ? `
          <ul class="loss-list">
            ${losses.map(([n, one, many]) =>
              `<li><b>${n}</b> ${esc(n > 1 ? many : one)}</li>`).join('')}
          </ul>`
          : '<p class="muted small mt-1">Ce dossier est vide — aucune donnée métier ne sera perdue.</p>'}
        ${client.n_questionnaires
          ? '<p class="muted small mt-1">Les fichiers reçus du client et leurs réponses seront également effacés du disque.</p>'
          : ''}
      </div>
    </div>`;

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
    toast('Client supprimé', client.name, 'ok');
    ctx.navigate('#/clients');
  } catch (error) {
    toast('Suppression impossible', error.message, 'error');
  }
}

function miniStat(label, value, iconName, href) {
  return `
    <a class="stat" href="${href}" style="text-decoration:none;color:inherit">
      <span class="stat-ico">${icon(iconName)}</span>
      <span class="label">${esc(label)}</span>
      <span class="value">${fmtNum(value)}</span>
    </a>`;
}

/* ------------------------------------------------------------------ */
/* Base de connaissance du client                                       */
/* ------------------------------------------------------------------ */
async function kbPanel(panel, client, ctx) {
  const clients = await api.get('/api/clients');
  let includeGeneric = true;
  let term = '';

  panel.innerHTML = `
    <div class="toolbar">
      <div class="search-box">
        ${icon('search')}
        <input class="input" data-search placeholder="Rechercher dans les réponses…">
      </div>
      <label class="switch">
        <input type="checkbox" data-generic checked>
        <span class="track"></span>
        <span>Inclure les réponses génériques</span>
      </label>
      <button class="btn primary" data-add>${icon('plus')}Ajouter</button>
    </div>
    <div data-list>${'<div class="loader"><span class="spinner"></span></div>'}</div>`;

  const listNode = panel.querySelector('[data-list]');

  async function refresh() {
    const entries = await api.get('/api/kb', {
      client_id: client.id, include_generic: includeGeneric, q: term,
    });
    listNode.innerHTML = entries.length
      ? entries.map((entry) => kbCard(entry)).join('')
      : `<div class="card">${emptyState({
          iconName: 'book',
          title: term ? 'Aucun résultat' : 'Base de connaissance vide',
          text: term
            ? 'Aucune réponse ne correspond à cette recherche.'
            : 'Ajoutez les réponses de référence de ce client : elles seront réutilisées automatiquement dans les questionnaires.',
        })}</div>`;
    bindKbActions(listNode, entries, clients, refresh);
  }

  panel.querySelector('[data-add]').addEventListener('click', () =>
    kbForm({ clientId: client.id, clientList: clients, onSaved: refresh }));
  panel.querySelector('[data-generic]').addEventListener('change', (event) => {
    includeGeneric = event.target.checked;
    refresh();
  });
  panel.querySelector('[data-search]').addEventListener('input', debounce((event) => {
    term = event.target.value.trim();
    refresh();
  }, 240));

  await refresh();
}

export function bindKbActions(root, entries, clients, refresh) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  root.querySelectorAll('[data-edit]').forEach((btn) =>
    btn.addEventListener('click', () =>
      kbForm({ entry: byId.get(Number(btn.dataset.edit)), clientList: clients, onSaved: refresh })));
  root.querySelectorAll('[data-copy]').forEach((btn) =>
    btn.addEventListener('click', () => copyText(byId.get(Number(btn.dataset.copy)).answer)));
  root.querySelectorAll('[data-del]').forEach((btn) =>
    btn.addEventListener('click', () =>
      deleteKb(byId.get(Number(btn.dataset.del)), refresh)));
}

/* ------------------------------------------------------------------ */
/* Configurations techniques                                            */
/* ------------------------------------------------------------------ */
async function configPanel(panel, client, ctx) {
  panel.innerHTML = `
    <div class="toolbar">
      <p class="grow muted small">
        Faits techniques précis du client. Le moteur les injecte directement dans les
        réponses — par exemple « quel chiffrement au repos ? » renvoie la valeur saisie ici.
      </p>
      <button class="btn primary" data-add>${icon('plus')}Ajouter une configuration</button>
    </div>
    <div data-list><div class="loader"><span class="spinner"></span></div></div>`;

  const listNode = panel.querySelector('[data-list]');

  async function refresh() {
    const configs = await api.get('/api/configs', { client_id: client.id });
    listNode.innerHTML = configs.length
      ? configGroups(configs)
      : `<div class="card">${emptyState({
          iconName: 'settings',
          title: 'Aucune configuration enregistrée',
          text: 'Décrivez les dispositifs en place : chiffrement au repos et en transit, authentification, sauvegardes, journalisation, hébergement…',
        })}</div>`;

    const byId = new Map(configs.map((c) => [c.id, c]));
    listNode.querySelectorAll('[data-cfg-edit]').forEach((btn) =>
      btn.addEventListener('click', () =>
        configForm({ config: byId.get(Number(btn.dataset.cfgEdit)), clientId: client.id, onSaved: refresh })));
    listNode.querySelectorAll('[data-cfg-del]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const config = byId.get(Number(btn.dataset.cfgDel));
        const ok = await confirmDialog({
          title: 'Supprimer cette configuration ?',
          message: `« ${config.label} » ne sera plus utilisée pour répondre aux questionnaires.`,
          confirmLabel: 'Supprimer',
          danger: true,
        });
        if (!ok) return;
        await api.del(`/api/configs/${config.id}`);
        toast('Configuration supprimée', '', 'ok');
        refresh();
      }));
  }

  panel.querySelector('[data-add]').addEventListener('click', () =>
    configForm({ clientId: client.id, onSaved: refresh }));
  await refresh();
}

/* ------------------------------------------------------------------ */
/* Questionnaires du client                                             */
/* ------------------------------------------------------------------ */
async function questionnairePanel(panel, client, ctx) {
  const list = await api.get('/api/questionnaires', { client_id: client.id });

  panel.innerHTML = list.length
    ? `<div class="card"><div class="rows">
         ${list.map((q) => questionnaireRow(q, { showClient: false })).join('')}
       </div></div>`
    : `<div class="card">${emptyState({
        iconName: 'inbox',
        title: 'Aucun questionnaire',
        text: 'Téléversez le questionnaire sécurité reçu de ce client : le moteur proposera une réponse pour chaque question reconnue.',
        action: '<button class="btn primary" data-empty-upload>Téléverser un questionnaire</button>',
      })}</div>`;

  panel.querySelector('[data-empty-upload]')?.addEventListener('click', () =>
    uploadDialog({ clientId: client.id, ctx }));

  panel.querySelectorAll('[data-qq-del]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Supprimer ce questionnaire ?',
        message: 'Les questions et les réponses saisies seront perdues. La base de connaissance n’est pas affectée.',
        confirmLabel: 'Supprimer',
        danger: true,
      });
      if (!ok) return;
      await api.del(`/api/questionnaires/${btn.dataset.qqDel}`);
      toast('Questionnaire supprimé', '', 'ok');
      ctx.refresh();
    }));
}
