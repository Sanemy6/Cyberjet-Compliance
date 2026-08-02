/* Tableau de bord — vue d'ensemble du patrimoine et des dossiers en cours. */

import { api } from '../api.js';
import { clientForm } from '../forms.js';
import {
  emptyState, esc, fmtNum, fmtPct, fmtRelative, icon, truncate,
} from '../ui.js';

const FILE_LABEL = { xlsx: 'Excel', docx: 'Word', pdf: 'PDF', csv: 'CSV', manuel: 'Saisie' };

export default async function dashboard(node, ctx) {
  ctx.setCrumb([{ label: 'Tableau de bord' }]);
  ctx.setActions(`
    <a class="btn" href="#/assistant">${icon('search')}<span class="nowrap">Poser une question</span></a>
    <a class="btn primary" href="#/questionnaires">${icon('upload')}<span class="nowrap">Traiter un questionnaire</span></a>`);

  const s = await api.get('/api/stats');

  if (!s.clients && !s.kb_total) {
    node.innerHTML = welcome();
    node.querySelector('[data-new-client]').addEventListener('click', () =>
      clientForm(null, (client) => ctx.navigate(`#/clients/${client.id}`)));
    return;
  }

  const validationRate = s.questions_total ? s.questions_validated / s.questions_total : 0;

  node.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Tableau de bord</h1>
        <p class="sub">
          Vue d’ensemble de votre patrimoine de réponses et des questionnaires en cours de traitement.
        </p>
      </div>
    </div>

    <div class="grid side mb-2">
      <div class="card">
        <div class="card-body">
          <p class="label" style="font-size:.72rem;text-transform:uppercase;letter-spacing:.07em;font-weight:650;color:var(--text-3)">
            Taux de réponse automatique
          </p>
          <div class="flex" style="align-items:baseline;gap:12px;margin:6px 0 14px">
            <span class="hero-figure">${fmtPct(s.coverage)}</span>
            <span class="muted small">
              ${fmtNum(s.questions_answered)} question${s.questions_answered > 1 ? 's' : ''}
              sur ${fmtNum(s.questions_total)} ont reçu une proposition issue de la base
            </span>
          </div>
          <div class="progress ${coverageTone(s.coverage)}" role="img"
               aria-label="Couverture ${fmtPct(s.coverage)}">
            <span style="width:${Math.round(s.coverage * 100)}%"></span>
          </div>
          <div class="flex between mt-2 small muted" style="flex-wrap:wrap;gap:8px">
            <span>${fmtNum(s.questions_validated)} réponse${s.questions_validated > 1 ? 's' : ''} validée${s.questions_validated > 1 ? 's' : ''} (${fmtPct(validationRate)})</span>
            <span>${fmtNum(s.controls)} contrôles répartis sur ${s.frameworks} référentiels</span>
          </div>
        </div>
      </div>

      <div class="grid cols-2" style="gap:14px">
        ${stat('Clients actifs', fmtNum(s.clients), 'users', `${fmtNum(s.configs)} configurations techniques`)}
        ${stat('Réponses en base', fmtNum(s.kb_total), 'book', `${fmtNum(s.kb_generic)} génériques · ${fmtNum(s.kb_validated)} validées`)}
        ${stat('Questionnaires ouverts', fmtNum(s.questionnaires_open), 'fileText', `${fmtNum(s.questionnaires_total)} au total`)}
        ${stat('Questions traitées', fmtNum(s.questions_total), 'checkCircle', `${fmtNum(s.questions_validated)} validées`)}
      </div>
    </div>

    <div class="grid side">
      <div class="card">
        <div class="card-head">
          <h2>Questionnaires récents</h2>
          <a class="btn sm ghost" href="#/questionnaires">Tout voir ${icon('chevronRight')}</a>
        </div>
        ${s.recent_questionnaires.length ? `
          <div class="rows">
            ${s.recent_questionnaires.map(recentRow).join('')}
          </div>` : emptyState({
            iconName: 'inbox',
            title: 'Aucun questionnaire',
            text: 'Téléversez un questionnaire client pour lancer le traitement automatique.',
            action: '<a class="btn primary" href="#/questionnaires">Téléverser un questionnaire</a>',
          })}
      </div>

      <div class="flex col" style="gap:16px">
        <div class="card">
          <div class="card-head"><h2>Répartition par domaine</h2></div>
          <div class="card-body">
            ${s.by_category.length ? barList(s.by_category) :
              '<p class="dim small">La base de connaissance est vide.</p>'}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h2>Réponses les plus réutilisées</h2></div>
          <div class="card-body">
            ${s.top_kb.length ? `
              <div class="flex col" style="gap:11px">
                ${s.top_kb.map((entry) => `
                  <div class="flex" style="align-items:flex-start;gap:10px">
                    <span class="badge accent nowrap">${entry.usage_count}×</span>
                    <div class="grow">
                      <div class="small">${esc(truncate(entry.question, 88))}</div>
                      <div class="dim" style="font-size:.75rem">${esc(entry.category)}</div>
                    </div>
                  </div>`).join('')}
              </div>` :
              '<p class="dim small">Les compteurs se remplissent au fil des questionnaires validés.</p>'}
          </div>
        </div>
      </div>
    </div>`;
}

function coverageTone(ratio) {
  if (ratio >= 0.7) return 'ok';
  if (ratio >= 0.4) return 'warn';
  return 'danger';
}

function stat(label, value, iconName, hint) {
  return `
    <div class="stat">
      <span class="stat-ico">${icon(iconName)}</span>
      <span class="label">${esc(label)}</span>
      <span class="value">${esc(value)}</span>
      <span class="hint">${esc(hint)}</span>
    </div>`;
}

/* Barres de magnitude : une seule teinte, la longueur porte la valeur. */
function barList(items) {
  const max = Math.max(...items.map((i) => i.n), 1);
  return `
    <div class="bar-list">
      ${items.slice(0, 9).map((item) => `
        <div class="bar-row">
          <span class="bar-label" title="${esc(item.category)}">${esc(item.category)}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${Math.max(3, (item.n / max) * 100)}%"></span></span>
          <span class="bar-value">${fmtNum(item.n)}</span>
        </div>`).join('')}
    </div>`;
}

function recentRow(q) {
  const progress = q.n_questions ? q.n_done / q.n_questions : 0;
  return `
    <a class="row-item" href="#/questionnaires/${q.id}" style="text-decoration:none;color:inherit">
      <div class="row-main">
        <div class="row-title">${esc(q.name)}</div>
        <div class="row-sub flex wrap" style="gap:7px">
          <span>${esc(q.client_name)}</span>
          <span class="dim">·</span>
          <span class="badge outline">${esc(FILE_LABEL[q.file_type] || q.file_type)}</span>
          <span class="dim">·</span>
          <span class="dim">${esc(fmtRelative(q.updated_at))}</span>
        </div>
        <div class="meter-row mt-1">
          <div class="progress ${progress >= 1 ? 'ok' : ''}"><span style="width:${Math.round(progress * 100)}%"></span></div>
          <span class="meter-val">${q.n_done}/${q.n_questions}</span>
        </div>
      </div>
      ${icon('chevronRight')}
    </a>`;
}

function welcome() {
  return `
    <div class="page-head">
      <div>
        <h1>Bienvenue</h1>
        <p class="sub">
          Cette application centralise vos réponses de conformité et les réutilise
          automatiquement pour répondre aux questionnaires sécurité de vos clients.
        </p>
      </div>
    </div>

    <div class="card mb-2">
      <div class="card-body">
        <h2 class="mb-1">Trois étapes pour démarrer</h2>
        <div class="grid cols-3 mt-2">
          ${step(1, 'users', 'Créez un client',
            'Un dossier par compagnie ou organisme : périmètre, contexte, référentiels applicables.')}
          ${step(2, 'book', 'Alimentez sa base',
            'Réponses de référence et configurations techniques (chiffrement, accès, sauvegardes…).')}
          ${step(3, 'wand', 'Téléversez un questionnaire',
            'Excel, Word ou PDF : le moteur propose une réponse pour chaque question reconnue.')}
        </div>
      </div>
      <div class="card-foot" style="justify-content:flex-start">
        <button class="btn primary" data-new-client>${icon('plus')}Créer mon premier client</button>
        <a class="btn" href="#/frameworks">${icon('shieldCheck')}Parcourir les référentiels</a>
      </div>
    </div>

    <div class="card">
      <div class="card-body flex" style="align-items:flex-start;gap:12px">
        ${icon('lock')}
        <div>
          <h3>Vos données restent sur ce poste</h3>
          <p class="muted small mt-1">
            Le moteur de rapprochement fonctionne entièrement hors ligne : normalisation
            bilingue, thésaurus cybersécurité, BM25 et similarité par trigrammes. Aucune
            requête réseau, aucun service tiers, aucune clé d’API. Les données des clients
            sont cloisonnées : une réponse rattachée à un client n’est jamais proposée pour
            un autre.
          </p>
        </div>
      </div>
    </div>`;
}

function step(n, iconName, title, text) {
  return `
    <div class="flex" style="align-items:flex-start;gap:11px">
      <span class="stat-ico" style="position:static;flex:none">${icon(iconName)}</span>
      <div>
        <div class="row-title">${n}. ${esc(title)}</div>
        <p class="muted small mt-1">${esc(text)}</p>
      </div>
    </div>`;
}
