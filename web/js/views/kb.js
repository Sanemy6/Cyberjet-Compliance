/* Base de connaissance globale — toutes portées confondues. */

import { api } from '../api.js';
import { kbForm, meta } from '../forms.js';
import { kbCard } from '../components.js';
import { bindKbActions } from './client.js';
import { debounce, emptyState, esc, fmtNum, icon } from '../ui.js';

export default async function knowledge(node, ctx, route) {
  ctx.setCrumb([{ label: 'Base de connaissance' }]);

  const [clients, m] = await Promise.all([api.get('/api/clients'), meta()]);
  const filters = {
    q: route.query.get('q') || '',
    client_id: route.query.get('client') || '',
    category: '',
    status: '',
  };

  ctx.setActions(`<button class="btn primary" data-add>${icon('plus')}<span class="nowrap">Nouvelle réponse</span></button>`);
  document.querySelector('[data-add]').addEventListener('click', () =>
    kbForm({ clientList: clients, onSaved: refresh }));

  node.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Base de connaissance</h1>
        <p class="sub">
          Le patrimoine de réponses réutilisables. Les entrées <em>génériques</em> servent
          tous les clients ; les entrées rattachées à un client ne sortent jamais de son dossier.
        </p>
      </div>
    </div>

    <div class="toolbar">
      <div class="search-box">
        ${icon('search')}
        <input class="input" data-f-q value="${esc(filters.q)}" placeholder="Rechercher une question, une réponse, un mot-clé…">
      </div>
      <select class="select" data-f-client style="max-width:250px">
        <option value="">Toutes les portées</option>
        <option value="generic">Génériques uniquement</option>
        ${clients.map((c) => `<option value="${c.id}"${String(c.id) === filters.client_id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select>
      <select class="select" data-f-category style="max-width:220px">
        <option value="">Toutes les catégories</option>
        ${m.categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
      </select>
      <select class="select" data-f-status style="max-width:170px">
        <option value="">Tous les statuts</option>
        <option value="validated">Validées</option>
        <option value="draft">Brouillons</option>
        <option value="obsolete">Obsolètes</option>
      </select>
    </div>

    <p class="dim small mb-1" data-count></p>
    <div data-list><div class="loader"><span class="spinner"></span></div></div>`;

  const listNode = node.querySelector('[data-list]');
  const countNode = node.querySelector('[data-count]');

  async function refresh() {
    const params = { q: filters.q, category: filters.category, status: filters.status };
    if (filters.client_id === 'generic') {
      params.include_generic = true;
      params.client_id = -1;   // aucun client réel : ne remonte que le générique
    } else if (filters.client_id) {
      params.client_id = filters.client_id;
      params.include_generic = false;
    }

    const entries = await api.get('/api/kb', params);
    countNode.textContent = entries.length
      ? `${fmtNum(entries.length)} réponse${entries.length > 1 ? 's' : ''}`
      : '';
    listNode.innerHTML = entries.length
      ? entries.map((entry) => kbCard(entry)).join('')
      : `<div class="card">${emptyState({
          iconName: 'book',
          title: 'Aucune réponse',
          text: 'Ajoutez vos réponses de référence : chaque entrée sera automatiquement proposée pour les questions équivalentes des questionnaires clients.',
          action: '<button class="btn primary" data-empty-add>Ajouter une réponse</button>',
        })}</div>`;

    listNode.querySelector('[data-empty-add]')?.addEventListener('click', () =>
      kbForm({ clientList: clients, onSaved: refresh }));
    bindKbActions(listNode, entries, clients, refresh);
  }

  const bind = (selector, key, immediate = true) => {
    const input = node.querySelector(selector);
    const handler = () => { filters[key] = input.value; refresh(); };
    input.addEventListener(immediate ? 'change' : 'input',
      immediate ? handler : debounce(handler, 260));
  };
  bind('[data-f-q]', 'q', false);
  bind('[data-f-client]', 'client_id');
  bind('[data-f-category]', 'category');
  bind('[data-f-status]', 'status');

  await refresh();
}
