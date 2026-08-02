/* Liste des dossiers clients. */

import { api } from '../api.js';
import { clientForm } from '../forms.js';
import { debounce, emptyState, esc, fmtNum, icon, truncate } from '../ui.js';

export default async function clients(node, ctx) {
  ctx.setCrumb([{ label: 'Clients' }]);
  ctx.setActions(`<button class="btn primary" data-new>${icon('plus')}<span class="nowrap">Nouveau client</span></button>`);
  document.querySelector('[data-new]').addEventListener('click', () =>
    clientForm(null, (client) => ctx.navigate(`#/clients/${client.id}`)));

  const list = await api.get('/api/clients');

  if (!list.length) {
    node.innerHTML = `
      <div class="page-head"><div><h1>Clients</h1></div></div>
      <div class="card">${emptyState({
        iconName: 'users',
        title: 'Aucun client enregistré',
        text: 'Créez un dossier par compagnie ou organisme afin d’y rattacher ses réponses, ses configurations techniques et ses questionnaires.',
        action: '<button class="btn primary" data-empty-new>Créer un client</button>',
      })}</div>`;
    node.querySelector('[data-empty-new]').addEventListener('click', () =>
      clientForm(null, (client) => ctx.navigate(`#/clients/${client.id}`)));
    return;
  }

  node.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Clients</h1>
        <p class="sub">${fmtNum(list.length)} dossier${list.length > 1 ? 's' : ''} de conformité.</p>
      </div>
    </div>
    <div class="toolbar">
      <div class="search-box">
        ${icon('search')}
        <input class="input" data-search placeholder="Rechercher un client, un pays, un contact…">
      </div>
    </div>
    <div class="grid cols-3" data-list>${list.map(card).join('')}</div>`;

  const listNode = node.querySelector('[data-list]');
  node.querySelector('[data-search]').addEventListener('input', debounce((event) => {
    const term = event.target.value.trim().toLowerCase();
    const filtered = list.filter((c) =>
      !term || [c.name, c.country, c.contact, c.description]
        .some((field) => (field || '').toLowerCase().includes(term)));
    listNode.innerHTML = filtered.length
      ? filtered.map(card).join('')
      : '<p class="dim">Aucun client ne correspond à cette recherche.</p>';
  }, 180));
}

function card(client) {
  const initials = client.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return `
    <a class="card clickable" href="#/clients/${client.id}" style="text-decoration:none;color:inherit">
      <div class="card-body">
        <div class="flex" style="align-items:flex-start;gap:12px">
          <span class="brand-mark" style="background:var(--accent-soft);border-color:transparent;color:var(--accent);font-weight:650;font-size:.85rem">
            ${esc(initials)}
          </span>
          <div class="grow">
            <div class="flex between" style="gap:8px">
              <h3 class="truncate">${esc(client.name)}</h3>
              ${client.status !== 'actif' ? '<span class="badge outline">Archivé</span>' : ''}
            </div>
            ${[client.country, client.contact].filter(Boolean).length
              ? `<p class="dim small truncate">${[client.country, client.contact].filter(Boolean).map(esc).join(' · ')}</p>`
              : ''}
          </div>
        </div>
        ${client.description ? `<p class="muted small mt-2">${esc(truncate(client.description, 120))}</p>` : ''}
        <div class="flex wrap mt-2" style="gap:6px">
          <span class="badge">${icon('book')}${client.n_kb} réponse${client.n_kb > 1 ? 's' : ''}</span>
          <span class="badge">${icon('settings')}${client.n_configs} config.</span>
          <span class="badge">${icon('fileText')}${client.n_questionnaires} questionnaire${client.n_questionnaires > 1 ? 's' : ''}</span>
        </div>
      </div>
    </a>`;
}
