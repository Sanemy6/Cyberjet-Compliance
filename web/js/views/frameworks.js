/* Référentiels de conformité et couverture de la base de connaissance. */

import { api } from '../api.js';
import { debounce, esc, fmtNum, icon } from '../ui.js';

export default async function frameworks(node, ctx, route) {
  ctx.setCrumb([{ label: 'Référentiels' }]);

  const list = await api.get('/api/frameworks');
  const active = Number(route.query.get('fw')) || list[0]?.id;

  node.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Référentiels</h1>
        <p class="sub">
          Les contrôles servent d’ancrage : une réponse rattachée à
          <span class="mono">IS.I.OR.205</span> ou <span class="mono">A.8.24</span> est
          proposée en priorité dès qu’un questionnaire cite cette référence.
        </p>
      </div>
    </div>

    <div class="grid cols-3 mb-2">
      ${list.map((fw) => `
        <a class="card clickable" href="#/frameworks?fw=${fw.id}"
           style="text-decoration:none;color:inherit${fw.id === active ? ';border-color:var(--accent)' : ''}">
          <div class="card-body">
            <div class="flex between" style="align-items:flex-start;gap:10px">
              <div class="grow">
                <h3>${esc(fw.name)}</h3>
                <p class="dim small">${esc(fw.version || '')}</p>
              </div>
              <span class="badge accent nowrap">${fw.n_controls}</span>
            </div>
            <p class="muted small mt-2">${esc(fw.description || '')}</p>
            <p class="dim mt-1" style="font-size:.75rem">${icon('shield')} ${esc(fw.authority || '')}</p>
          </div>
        </a>`).join('')}
    </div>

    <div class="card">
      <div class="card-head">
        <h2 data-title></h2>
        <div class="search-box" style="max-width:320px">
          ${icon('search')}
          <input class="input" data-search placeholder="Filtrer les contrôles…">
        </div>
      </div>
      <div data-controls><div class="loader"><span class="spinner"></span></div></div>
    </div>`;

  if (!active) return;

  const framework = list.find((fw) => fw.id === active);
  node.querySelector('[data-title]').textContent = framework ? framework.name : 'Contrôles';

  const controlsNode = node.querySelector('[data-controls]');
  const controls = await api.get(`/api/frameworks/${active}/controls`);

  function draw(term = '') {
    const needle = term.trim().toLowerCase();
    const filtered = controls.filter((c) =>
      !needle || `${c.ref} ${c.title} ${c.description} ${c.theme}`.toLowerCase().includes(needle));

    if (!filtered.length) {
      controlsNode.innerHTML = '<p class="dim" style="padding:22px">Aucun contrôle ne correspond.</p>';
      return;
    }

    const themes = new Map();
    for (const control of filtered) {
      const key = control.theme || '—';
      if (!themes.has(key)) themes.set(key, []);
      themes.get(key).push(control);
    }

    controlsNode.innerHTML = [...themes.entries()].map(([theme, items]) => `
      <div>
        <p style="padding:11px 18px 7px;font-size:.72rem;text-transform:uppercase;letter-spacing:.07em;font-weight:650;color:var(--text-3);background:var(--surface-2);border-bottom:1px solid var(--border)">
          ${esc(theme)} · ${items.length}
        </p>
        ${items.map((control) => `
          <div class="row-item">
            <span class="badge ref nowrap" style="margin-top:2px">${esc(control.ref)}</span>
            <div class="row-main">
              <div class="row-title">${esc(control.title)}</div>
              ${control.description ? `<div class="row-sub dim">${esc(control.description)}</div>` : ''}
            </div>
            <div class="row-actions">
              ${control.n_kb
                ? `<a class="badge ok" href="#/kb" title="${control.n_kb} réponse(s) rattachée(s)">${icon('check')}${control.n_kb}</a>`
                : '<span class="badge outline">Non couvert</span>'}
            </div>
          </div>`).join('')}
      </div>`).join('');
  }

  const covered = controls.filter((c) => c.n_kb > 0).length;
  node.querySelector('[data-title]').innerHTML = `
    ${esc(framework?.name || 'Contrôles')}
    <span class="dim small" style="font-weight:400">
      — ${fmtNum(covered)} / ${fmtNum(controls.length)} contrôles couverts
    </span>`;

  node.querySelector('[data-search]').addEventListener('input',
    debounce((event) => draw(event.target.value), 200));
  draw();
}
