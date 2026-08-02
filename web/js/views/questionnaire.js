/* Revue d'un questionnaire : proposition, ajustement, validation, export. */

import { api } from '../api.js';
import { fileLabel } from '../components.js';
import { kbForm } from '../forms.js';
import {
  bandBadge, confirmDialog, emptyState, esc, fmtNum, icon, modal, statusBadge,
  toast, truncate, withBusy,
} from '../ui.js';

const FILTERS = [
  { key: 'all', label: 'Toutes' },
  { key: 'todo', label: 'À traiter' },
  { key: 'high', label: 'Confiance haute' },
  { key: 'weak', label: 'À vérifier' },
  { key: 'validated', label: 'Validées' },
  { key: 'na', label: 'Sans objet' },
];

export default async function questionnaireDetail(node, ctx, route) {
  const id = Number(route.params[0]);
  let data = await api.get(`/api/questionnaires/${id}`);
  let filter = route.query.get('f') || 'all';
  let clients = null;

  ctx.setCrumb([
    { label: 'Questionnaires', href: '#/questionnaires' },
    { label: data.client_name, href: `#/clients/${data.client_id}?tab=questionnaires` },
    { label: data.name },
  ]);

  function counts() {
    const q = data.questions;
    return {
      all: q.length,
      todo: q.filter((x) => x.status === 'pending' || (x.status === 'auto' && x.confidence < 0.62)).length,
      high: q.filter((x) => x.confidence >= 0.62 && x.status !== 'validated' && x.status !== 'na').length,
      weak: q.filter((x) => x.confidence > 0 && x.confidence < 0.62 && x.status !== 'validated' && x.status !== 'na').length,
      validated: q.filter((x) => x.status === 'validated').length,
      na: q.filter((x) => x.status === 'na').length,
    };
  }

  function matches(question) {
    switch (filter) {
      case 'todo': return question.status === 'pending'
        || (question.status === 'auto' && question.confidence < 0.62);
      case 'high': return question.confidence >= 0.62
        && !['validated', 'na'].includes(question.status);
      case 'weak': return question.confidence > 0 && question.confidence < 0.62
        && !['validated', 'na'].includes(question.status);
      case 'validated': return question.status === 'validated';
      case 'na': return question.status === 'na';
      default: return true;
    }
  }

  function renderShell() {
    const s = data.summary;
    const done = s.validated + s.na;
    const progress = s.total ? done / s.total : 0;
    const c = counts();

    ctx.setActions(`
      <button class="btn" data-rerun title="Relance le rapprochement sur les questions non validées">
        ${icon('refresh')}<span class="nowrap">Relancer</span>
      </button>
      <button class="btn primary" data-export>${icon('download')}<span class="nowrap">Exporter</span></button>`);
    document.querySelector('[data-rerun]').addEventListener('click', (e) => rerun(e.currentTarget));
    document.querySelector('[data-export]').addEventListener('click', exportDialog);

    node.innerHTML = `
      <div class="page-head">
        <div>
          <h1>${esc(data.name)}</h1>
          <p class="sub flex wrap" style="gap:8px">
            <a href="#/clients/${data.client_id}">${esc(data.client_name)}</a>
            <span class="dim">·</span>
            <span class="badge outline">${esc(fileLabel(data.file_type))}</span>
            ${data.original_filename ? `<span class="dim">${esc(data.original_filename)}</span>` : ''}
          </p>
        </div>
      </div>

      <div class="card mb-2">
        <div class="card-body">
          <div class="flex between wrap mb-1" style="gap:12px">
            <div class="flex wrap" style="gap:8px">
              <span class="badge">${fmtNum(s.total)} question${s.total > 1 ? 's' : ''}</span>
              <span class="badge accent">${fmtNum(s.answered)} avec proposition</span>
              <span class="badge ok">${fmtNum(s.validated)} validée${s.validated > 1 ? 's' : ''}</span>
              ${s.pending ? `<span class="badge warn">${fmtNum(s.pending)} sans correspondance</span>` : ''}
            </div>
            ${c.high ? `<button class="btn sm ok" data-validate-high>${icon('check')}Valider les ${c.high} propositions à haute confiance</button>` : ''}
          </div>
          <div class="meter-row">
            <div class="progress ${progress >= 1 ? 'ok' : ''}"><span style="width:${Math.round(progress * 100)}%"></span></div>
            <span class="meter-val">${done}/${s.total}</span>
          </div>
        </div>
      </div>

      <div class="tabs">
        ${FILTERS.map((f) => `
          <button class="tab ${f.key === filter ? 'active' : ''}" data-filter="${f.key}">
            ${esc(f.label)}<span class="count">${c[f.key]}</span>
          </button>`).join('')}
      </div>

      <div data-list></div>`;

    node.querySelectorAll('[data-filter]').forEach((tab) =>
      tab.addEventListener('click', () => {
        filter = tab.dataset.filter;
        history.replaceState(null, '', `#/questionnaires/${id}?f=${filter}`);
        renderShell();
      }));
    node.querySelector('[data-validate-high]')?.addEventListener('click', (e) =>
      withBusy(e.currentTarget, async () => {
        data = await api.post(`/api/questionnaires/${id}/validate-high`);
        toast('Propositions validées', `${data.validated} réponse(s) validée(s).`, 'ok');
        renderShell();
      }));

    renderList();
  }

  function renderList() {
    const listNode = node.querySelector('[data-list]');
    const visible = data.questions.filter(matches);

    if (!visible.length) {
      listNode.innerHTML = `<div class="card">${emptyState({
        iconName: filter === 'all' ? 'inbox' : 'checkCircle',
        title: filter === 'all' ? 'Aucune question extraite' : 'Rien dans ce filtre',
        text: filter === 'all'
          ? 'Le fichier n’a pas pu être découpé en questions. Réimportez-le en collant les questions manuellement.'
          : 'Toutes les questions de cette catégorie ont été traitées.',
      })}</div>`;
      return;
    }

    listNode.innerHTML = visible.map(card).join('');
    visible.forEach((question) => bindCard(listNode, question));
  }

  /* ---------------------------------------------------------------- */
  /* Carte de question                                                 */
  /* ---------------------------------------------------------------- */
  function card(q) {
    const answer = q.final_answer ?? q.suggested_answer ?? '';
    const edited = q.final_answer && q.final_answer !== q.suggested_answer;

    return `
      <div class="q-card" data-q="${q.id}" data-band="${esc(q.band)}" data-status="${esc(q.status)}">
        <div class="q-head">
          <span class="q-index">${q.idx}</span>
          <div class="q-text">
            ${esc(q.text)}
            <div class="q-meta">
              ${q.ref ? `<span class="badge ref">${esc(q.ref)}</span>` : ''}
              ${q.section ? `<span class="badge outline">${esc(q.section)}</span>` : ''}
              ${statusBadge(q.status)}
              ${q.status !== 'na' ? bandBadge(q.band, q.confidence) : ''}
              ${edited ? '<span class="badge accent">Reformulée</span>' : ''}
            </div>
          </div>
        </div>

        <div class="q-body">
          <textarea class="textarea" data-answer placeholder="${q.suggested_answer ? '' : 'Aucune correspondance trouvée — rédigez la réponse, puis versez-la dans la base pour la réutiliser.'}">${esc(answer)}</textarea>
          ${sourceLine(q)}
          <div class="q-actions">
            <button class="btn sm ok" data-validate>${icon('check')}Valider</button>
            <button class="btn sm" data-candidates>${icon('search')}Autres propositions${q.candidates?.length ? ` (${q.candidates.length})` : ''}</button>
            <button class="btn sm" data-promote>${icon('book')}Verser dans la base</button>
            <button class="btn sm ghost" data-na>${icon('slash')}Sans objet</button>
            <span class="dim small" data-saved></span>
          </div>
        </div>
      </div>`;
  }

  function sourceLine(q) {
    if (!q.matched_kind) return '';
    const label = q.matched_kind === 'config'
      ? 'Configuration technique du client'
      : 'Base de connaissance';
    return `<div class="q-source">${icon('link')}Source : ${esc(label)}</div>`;
  }

  function bindCard(root, q) {
    const cardNode = root.querySelector(`[data-q="${q.id}"]`);
    if (!cardNode) return;
    const textarea = cardNode.querySelector('[data-answer]');
    const savedNode = cardNode.querySelector('[data-saved]');

    autoGrow(textarea);
    textarea.addEventListener('input', () => autoGrow(textarea));

    let lastSaved = textarea.value;
    textarea.addEventListener('blur', async () => {
      if (textarea.value === lastSaved) return;
      lastSaved = textarea.value;
      const updated = await api.patch(`/api/questions/${q.id}`, { final_answer: textarea.value });
      Object.assign(q, updated, { candidates: q.candidates, band: q.band });
      savedNode.textContent = 'Enregistré';
      setTimeout(() => { savedNode.textContent = ''; }, 1600);
    });

    cardNode.querySelector('[data-validate]').addEventListener('click', (event) =>
      withBusy(event.currentTarget, async () => {
        const updated = await api.patch(`/api/questions/${q.id}`, {
          final_answer: textarea.value, status: 'validated',
        });
        applyUpdate(q, updated);
      }).catch((error) => toast('Validation impossible', error.message, 'error')));

    cardNode.querySelector('[data-na]').addEventListener('click', async () => {
      const updated = await api.patch(`/api/questions/${q.id}`, { status: 'na' });
      applyUpdate(q, updated);
    });

    cardNode.querySelector('[data-candidates]').addEventListener('click', () =>
      candidatesDialog(q, textarea));

    cardNode.querySelector('[data-promote]').addEventListener('click', async () => {
      const answer = textarea.value.trim();
      if (!answer) {
        toast('Réponse vide', 'Rédigez la réponse avant de la verser dans la base.', 'warn');
        return;
      }
      clients ||= await api.get('/api/clients');
      kbForm({
        entry: {
          question: q.text,
          answer,
          client_id: data.client_id,
          category: 'Général',
          status: 'validated',
          source: `Questionnaire « ${data.name} »`,
          controls: [],
        },
        clientList: clients,
        onSaved: () => toast('Ajoutée à la base', 'Cette réponse sera réutilisée automatiquement.', 'ok'),
      });
    });
  }

  function applyUpdate(q, updated) {
    Object.assign(q, updated);
    data.summary = recomputeSummary();
    renderShell();
  }

  function recomputeSummary() {
    const q = data.questions;
    return {
      ...data.summary,
      answered: q.filter((x) => (x.final_answer || x.suggested_answer || '').trim()).length,
      validated: q.filter((x) => x.status === 'validated').length,
      na: q.filter((x) => x.status === 'na').length,
      pending: q.filter((x) => x.status === 'pending').length,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Autres propositions                                               */
  /* ---------------------------------------------------------------- */
  function candidatesDialog(q, textarea) {
    const dialog = modal({
      title: 'Propositions de la base',
      sub: truncate(q.text, 140),
      wide: true,
      body: `
        <div class="field">
          <label for="cd-q">Reformuler la recherche</label>
          <div class="flex" style="gap:8px">
            <input class="input" id="cd-q" value="${esc(q.text)}">
            <button class="btn" data-search>${icon('search')}Chercher</button>
          </div>
          <span class="help">Utile quand la question du client est elliptique : reformulez-la comme vous l’auriez posée.</span>
        </div>
        <div data-results></div>`,
      foot: '<button class="btn" data-close>Fermer</button>',
    });

    const resultsNode = dialog.root.querySelector('[data-results]');

    function draw(candidates) {
      if (!candidates.length) {
        resultsNode.innerHTML = '<p class="dim small">Aucune correspondance dans la base pour ce client.</p>';
        return;
      }
      resultsNode.innerHTML = candidates.map((candidate) => `
        <div class="candidate" data-pick='${esc(JSON.stringify({ kind: candidate.kind, id: candidate.id }))}'>
          <div class="c-head">
            <span class="c-q">${esc(truncate(candidate.title, 120))}</span>
            ${bandBadge(candidate.band, candidate.confidence)}
          </div>
          <p class="c-a pre-wrap">${esc(candidate.body)}</p>
          <div class="flex wrap mt-1" style="gap:6px">
            <span class="badge outline">${candidate.kind === 'config' ? 'Configuration' : 'Base de connaissance'}</span>
            ${candidate.category ? `<span class="badge">${esc(candidate.category)}</span>` : ''}
            ${candidate.ref_hit ? '<span class="badge accent">Référence normative commune</span>' : ''}
            ${(candidate.refs || []).slice(0, 3).map((r) => `<span class="badge ref">${esc(r)}</span>`).join('')}
          </div>
        </div>`).join('');

      resultsNode.querySelectorAll('[data-pick]').forEach((pickNode) =>
        pickNode.addEventListener('click', async () => {
          const { kind, id: sourceId } = JSON.parse(pickNode.dataset.pick);
          const updated = await api.post(`/api/questions/${q.id}/apply`, { kind, source_id: sourceId });
          Object.assign(q, updated);
          textarea.value = updated.final_answer || '';
          autoGrow(textarea);
          dialog.close();
          toast('Réponse appliquée', '', 'ok', 2200);
          data.summary = recomputeSummary();
          renderShell();
        }));
    }

    draw(q.candidates || []);
    dialog.root.querySelector('[data-search]').addEventListener('click', (event) =>
      withBusy(event.currentTarget, async () => {
        const value = dialog.root.querySelector('#cd-q').value.trim();
        const res = await api.post(`/api/questions/${q.id}/rematch`, { q: value });
        draw(res.candidates);
      }));
  }

  /* ---------------------------------------------------------------- */
  /* Relance et export                                                 */
  /* ---------------------------------------------------------------- */
  async function rerun(button) {
    const force = await confirmDialog({
      title: 'Relancer le rapprochement',
      message: 'Les propositions non validées seront recalculées avec l’état actuel de la base de connaissance. Vos réponses validées et vos modifications manuelles sont conservées.',
      confirmLabel: 'Relancer',
    });
    if (!force) return;
    await withBusy(button, async () => {
      data = await api.post(`/api/questionnaires/${id}/autoanswer`, undefined);
      const run = data.run?.by_band || {};
      toast('Rapprochement terminé',
        `${run.haute || 0} haute confiance · ${run.moyenne || 0} à vérifier · ${run.aucune || 0} sans correspondance`,
        'ok', 6000);
      renderShell();
    });
  }

  function exportDialog() {
    const canOriginal = data.summary.can_export_original;
    const dialog = modal({
      title: 'Exporter les réponses',
      sub: data.name,
      body: `
        <div class="flex col" style="gap:10px">
          <button class="btn block" data-mode="original" ${canOriginal ? '' : 'disabled'}
                  style="justify-content:flex-start;padding:14px;height:auto;text-align:left">
            <span style="display:flex;gap:11px;align-items:flex-start">
              ${icon('file')}
              <span>
                <span style="display:block;font-weight:620">Le fichier du client, complété</span>
                <span class="dim small" style="display:block;margin-top:2px;white-space:normal">
                  ${canOriginal
                    ? 'Les réponses sont réécrites dans le classeur Excel d’origine, à leur emplacement exact.'
                    : 'Disponible uniquement pour les questionnaires importés au format Excel.'}
                </span>
              </span>
            </span>
          </button>
          <button class="btn block" data-mode="report"
                  style="justify-content:flex-start;padding:14px;height:auto;text-align:left">
            <span style="display:flex;gap:11px;align-items:flex-start">
              ${icon('layers')}
              <span>
                <span style="display:block;font-weight:620">Rapport de synthèse</span>
                <span class="dim small" style="display:block;margin-top:2px;white-space:normal">
                  Classeur autonome : synthèse de couverture + détail question par question,
                  avec niveau de confiance et source de chaque réponse.
                </span>
              </span>
            </span>
          </button>
        </div>`,
      foot: '<button class="btn" data-close>Annuler</button>',
    });

    dialog.root.querySelectorAll('[data-mode]').forEach((button) =>
      button.addEventListener('click', (event) =>
        withBusy(event.currentTarget, async () => {
          try {
            await download(`/api/questionnaires/${id}/export?mode=${button.dataset.mode}`);
            dialog.close();
            toast('Export généré', 'Le fichier a été téléchargé.', 'ok');
          } catch (error) {
            toast('Export impossible', error.message, 'error', 7000);
          }
        })));
  }

  renderShell();
}

/* ------------------------------------------------------------------ */
/* Utilitaires                                                         */
/* ------------------------------------------------------------------ */
function autoGrow(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(textarea.scrollHeight + 2, 460)}px`;
}

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) {
    let detail = `Erreur ${response.status}`;
    try { detail = (await response.json()).detail || detail; } catch { /* réponse non JSON */ }
    throw new Error(detail);
  }
  const disposition = response.headers.get('content-disposition') || '';
  const match = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(disposition);
  const filename = match ? decodeURIComponent(match[1]) : 'export.xlsx';

  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}
