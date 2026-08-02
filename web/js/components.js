/* Fragments de rendu partagés entre plusieurs vues. */

import { controlChips, esc, fmtDate, fmtRelative, icon, kbStatusBadge, truncate } from './ui.js';

const FILE_LABEL = { xlsx: 'Excel', docx: 'Word', pdf: 'PDF', csv: 'CSV', manuel: 'Saisie' };
export const fileLabel = (type) => FILE_LABEL[type] || type;

/* ------------------------------------------------------------------ */
/* Entrée de base de connaissance                                       */
/* ------------------------------------------------------------------ */
export function kbCard(entry, { showClient = true } = {}) {
  const scope = entry.client_id
    ? `<span class="badge accent">${icon('user')}${esc(entry.client_name || 'Client')}</span>`
    : `<span class="badge">${icon('layers')}Générique</span>`;

  return `
    <div class="card" data-kb="${entry.id}" style="margin-bottom:12px">
      <div class="card-body">
        <div class="flex between" style="align-items:flex-start;gap:12px">
          <div class="grow">
            <h3 style="line-height:1.45">${esc(entry.question)}</h3>
          </div>
          <div class="row-actions">
            <button class="icon-btn sm" data-edit="${entry.id}" title="Modifier">${icon('edit')}</button>
            <button class="icon-btn sm" data-copy="${entry.id}" title="Copier la réponse">${icon('copy')}</button>
            <button class="icon-btn sm" data-del="${entry.id}" title="Supprimer">${icon('trash')}</button>
          </div>
        </div>
        <p class="muted small mt-1 pre-wrap">${esc(truncate(entry.answer, 420))}</p>
        <div class="flex wrap mt-2" style="gap:6px">
          ${showClient ? scope : ''}
          <span class="badge outline">${esc(entry.category)}</span>
          ${kbStatusBadge(entry.status)}
          ${entry.usage_count ? `<span class="badge accent" title="Nombre de réutilisations validées">${icon('refresh')}${entry.usage_count}×</span>` : ''}
          ${controlChips(entry.controls)}
        </div>
        ${entry.evidence || entry.tags ? `
          <div class="flex wrap mt-1 dim" style="gap:12px;font-size:.75rem">
            ${entry.tags ? `<span>${icon('filter')} ${esc(entry.tags)}</span>` : ''}
            ${entry.evidence ? `<span>${icon('file')} ${esc(entry.evidence)}</span>` : ''}
            <span title="Dernière mise à jour">${icon('clock')} ${esc(fmtDate(entry.updated_at))}</span>
          </div>` : ''}
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* Configurations techniques, regroupées par catégorie                  */
/* ------------------------------------------------------------------ */
const CONFIG_TONE = {
  'en place': 'ok', partiel: 'warn', planifié: '', 'non applicable': 'outline',
};

export function configGroups(configs) {
  const groups = new Map();
  for (const config of configs) {
    if (!groups.has(config.category)) groups.set(config.category, []);
    groups.get(config.category).push(config);
  }

  return [...groups.entries()].map(([category, items]) => `
    <div class="card" style="margin-bottom:14px">
      <div class="card-head">
        <h2>${esc(category)}</h2>
        <span class="badge">${items.length}</span>
      </div>
      <div class="table-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th style="width:30%">Élément</th>
              <th>Valeur en place</th>
              <th style="width:120px">État</th>
              <th style="width:80px"></th>
            </tr>
          </thead>
          <tbody>
            ${items.map((config) => `
              <tr>
                <td><strong>${esc(config.label)}</strong>
                  ${config.scope ? `<div class="dim" style="font-size:.75rem;margin-top:3px">${esc(config.scope)}</div>` : ''}
                </td>
                <td>
                  <span class="mono">${esc(config.value)}</span>
                  ${config.details ? `<div class="muted small mt-1 pre-wrap">${esc(config.details)}</div>` : ''}
                </td>
                <td><span class="badge ${CONFIG_TONE[config.status] ?? ''}">${esc(config.status)}</span></td>
                <td class="actions">
                  <button class="icon-btn sm" data-cfg-edit="${config.id}" title="Modifier">${icon('edit')}</button>
                  <button class="icon-btn sm" data-cfg-del="${config.id}" title="Supprimer">${icon('trash')}</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`).join('');
}

/* ------------------------------------------------------------------ */
/* Ligne de questionnaire                                               */
/* ------------------------------------------------------------------ */
export function questionnaireRow(q, { showClient = true } = {}) {
  const total = q.n_questions || 0;
  const done = (q.n_validated || 0) + (q.n_na || 0);
  const progress = total ? done / total : 0;
  const complete = total > 0 && done >= total;

  return `
    <div class="row-item">
      <div class="row-main">
        <a class="row-title" href="#/questionnaires/${q.id}" style="color:inherit">${esc(q.name)}</a>
        <div class="row-sub flex wrap" style="gap:7px">
          ${showClient ? `<span>${esc(q.client_name)}</span><span class="dim">·</span>` : ''}
          <span class="badge outline">${esc(fileLabel(q.file_type))}</span>
          <span class="dim">·</span>
          <span class="dim">${total} question${total > 1 ? 's' : ''}</span>
          <span class="dim">·</span>
          <span class="dim">${esc(fmtRelative(q.updated_at))}</span>
          ${complete ? '<span class="badge ok">Terminé</span>' : ''}
        </div>
        <div class="meter-row mt-1" style="max-width:420px">
          <div class="progress ${complete ? 'ok' : ''}"><span style="width:${Math.round(progress * 100)}%"></span></div>
          <span class="meter-val">${done}/${total}</span>
        </div>
      </div>
      <div class="row-actions">
        <a class="btn sm" href="#/questionnaires/${q.id}">Ouvrir</a>
        <button class="icon-btn sm" data-qq-del="${q.id}" title="Supprimer">${icon('trash')}</button>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* Couverture par référentiel                                           */
/* ------------------------------------------------------------------ */
export function coverageList(coverage) {
  return `
    <div class="bar-list">
      ${coverage.map((row) => {
        const ratio = row.n_controls ? row.n_covered / row.n_controls : 0;
        return `
          <div class="bar-row">
            <span class="bar-label" title="${esc(row.name)}">${esc(row.name)}</span>
            <span class="bar-track"><span class="bar-fill" style="width:${Math.max(2, ratio * 100)}%"></span></span>
            <span class="bar-value">${row.n_covered}/${row.n_controls}</span>
          </div>`;
      }).join('')}
    </div>`;
}
