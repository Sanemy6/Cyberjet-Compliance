/* Tableau de bord — vue d'ensemble du patrimoine et des dossiers en cours.
 *
 * Choix de représentation (et ce qu'ils écartent) :
 *   — Le taux de réponse automatique est UN ratio : chiffre directeur + jauge,
 *     pas un anneau. Un anneau pour deux parts n'est qu'un camembert à deux
 *     tranches, plus difficile à lire qu'une barre.
 *   — L'état des questions est un tout découpé en parts : barre composée
 *     horizontale, segments séparés par un vide de 2 px, légende chiffrée.
 *     Aucune valeur n'est écrite dans un segment : elle y serait rognée.
 *   — La répartition par domaine est une magnitude : barres d'une seule teinte.
 *     La longueur porte déjà la valeur ; la recolorer serait redondant.
 *   — Aucune évolution n'est affichée : la base ne conserve pas d'historique
 *     daté des réponses, et inventer une flèche « +12 % » serait un mensonge.
 */

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
    node.innerHTML = welcome(ctx);
    node.querySelector('[data-new-client]').addEventListener('click', () =>
      clientForm(null, (client) => ctx.navigate(`#/clients/${client.id}`)));
    return;
  }

  node.innerHTML = `
    ${pageHead(ctx)}

    <div class="grid hero mb-2">
      ${coveragePanel(s)}
      <div class="kpi-grid">
        ${stat('Clients actifs', fmtNum(s.clients), 'users',
          `${fmtNum(s.configs)} configuration${s.configs > 1 ? 's' : ''} technique${s.configs > 1 ? 's' : ''}`)}
        ${stat('Réponses en base', fmtNum(s.kb_total), 'book',
          `${fmtNum(s.kb_generic)} génériques · ${fmtNum(s.kb_validated)} validées`)}
        ${stat('Questionnaires ouverts', fmtNum(s.questionnaires_open), 'fileText',
          `${fmtNum(s.questionnaires_total)} au total`)}
        ${stat('Référentiels couverts', fmtNum(s.frameworks), 'shieldCheck',
          `${fmtNum(s.controls)} contrôles répertoriés`)}
      </div>
    </div>

    ${nextStep(s)}

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

      <div class="flex col" style="gap:var(--gap)">
        <div class="card">
          <div class="card-head">
            <h2>Répartition par domaine</h2>
            <span class="badge outline">${fmtNum(s.by_category.length)} domaine${s.by_category.length > 1 ? 's' : ''}</span>
          </div>
          <div class="card-body">
            ${s.by_category.length ? barList(s.by_category) :
              '<p class="dim small">La base de connaissance est vide.</p>'}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h2>Réponses les plus réutilisées</h2></div>
          <div class="card-body">
            ${s.top_kb.length ? `
              <div class="flex col" style="gap:12px">
                ${s.top_kb.map(topRow).join('')}
              </div>` :
              '<p class="dim small">Les compteurs se remplissent au fil des questionnaires validés.</p>'}
          </div>
        </div>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* En-tête                                                             */
/* ------------------------------------------------------------------ */
function pageHead(ctx) {
  const name = (ctx.session?.full_name || ctx.session?.username || '').split(/[\s._-]+/)[0];
  const hour = new Date().getHours();
  const hello = hour < 6 || hour >= 18 ? 'Bonsoir' : 'Bonjour';
  const today = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date());

  return `
    <div class="page-head">
      <div>
        <p class="eyebrow">${icon('gauge')}${esc(today)}</p>
        <h1>${esc(hello)}${name ? `, ${esc(name)}` : ''}</h1>
        <p class="sub">
          Vue d’ensemble de votre patrimoine de réponses et des questionnaires en cours
          de traitement.
        </p>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* Bloc de tête : le ratio directeur, puis le tout en parts             */
/* ------------------------------------------------------------------ */
function coveragePanel(s) {
  const validationRate = s.questions_total ? s.questions_validated / s.questions_total : 0;

  return `
    <div class="hero-panel">
      <p class="label">Taux de réponse automatique</p>
      <div class="flex" style="align-items:baseline;gap:14px;margin:8px 0 16px;flex-wrap:wrap">
        <span class="hero-figure">${fmtPct(s.coverage)}</span>
        <span class="muted small" style="max-width:34ch">
          ${s.questions_total
            ? `${fmtNum(s.questions_answered)} question${s.questions_answered > 1 ? 's' : ''}
               sur ${fmtNum(s.questions_total)} ont reçu une proposition issue de la base`
            : 'Aucune question traitée pour l’instant'}
        </span>
      </div>

      <div class="progress lg ${coverageTone(s.coverage, s.questions_total)}" role="img"
           aria-label="Couverture ${fmtPct(s.coverage)}">
        <span style="width:${Math.round(s.coverage * 100)}%"></span>
      </div>

      ${s.questions_total ? `
        <div class="flex between mt-2 small muted" style="flex-wrap:wrap;gap:8px">
          <span>
            ${fmtNum(s.questions_validated)} réponse${s.questions_validated > 1 ? 's' : ''}
            validée${s.questions_validated > 1 ? 's' : ''} (${fmtPct(validationRate)})
          </span>
          <span>${fmtNum(s.controls)} contrôles sur ${fmtNum(s.frameworks)} référentiels</span>
        </div>

        <div style="border-top:1px solid var(--border);margin:18px 0 15px"></div>

        <p class="label">État des ${fmtNum(s.questions_total)} questions traitées</p>
        ${stackBar(s)}` : `
        <div class="callout accent mt-3">
          ${icon('upload')}
          <div>
            <p><b>Le taux se calculera au premier questionnaire traité.</b></p>
            <p class="muted small mt-1">
              Téléversez un fichier Excel, Word ou PDF : le moteur propose une réponse
              pour chaque question qu’il reconnaît dans votre base.
            </p>
          </div>
        </div>`}
    </div>`;
}

/* Barre composée : validées / proposées / sans réponse. Les parts nulles ne
   sont pas rendues — un segment de largeur zéro dessinerait quand même son
   minimum et laisserait croire à une part résiduelle. */
function stackBar(s) {
  const validated = s.questions_validated;
  const proposed = Math.max(0, s.questions_answered - s.questions_validated);
  const pending = Math.max(0, s.questions_total - s.questions_answered);
  const total = validated + proposed + pending || 1;

  const parts = [
    { key: 'sv-validated', label: 'Validées', n: validated,
      hint: 'Relues et confirmées par une personne' },
    { key: 'sv-proposed', label: 'Proposées', n: proposed,
      hint: 'Réponse suggérée par le moteur, en attente de relecture' },
    { key: 'sv-empty', label: 'Sans proposition', n: pending,
      hint: 'Aucune correspondance trouvée dans la base' },
  ];
  const shown = parts.filter((part) => part.n > 0);

  return `
    <div class="stack-bar" role="img"
         aria-label="${shown.map((p) => `${p.label} : ${p.n}`).join(', ')}">
      ${shown.map((part) => `
        <span class="${part.key}" style="width:${(part.n / total) * 100}%"
              title="${esc(part.label)} : ${fmtNum(part.n)}"></span>`).join('')}
    </div>
    <div class="viz-legend mt-2">
      ${parts.map((part) => `
        <span class="vl-item" title="${esc(part.hint)}">
          <span class="vl-swatch ${part.key}"></span>
          ${esc(part.label)}
          <span class="vl-val">${fmtNum(part.n)}</span>
        </span>`).join('')}
    </div>`;
}

/* La sévérité n'a de sens qu'une fois des questions traitées : sans donnée, une
   piste rouge pleine largeur ferait passer « rien à mesurer » pour « tout va
   mal ». Piste neutre dans ce cas. */
function coverageTone(ratio, total) {
  if (!total) return '';
  if (ratio >= 0.7) return 'ok';
  if (ratio >= 0.4) return 'warn';
  return 'danger';
}

/* ------------------------------------------------------------------ */
/* Tuiles                                                              */
/* ------------------------------------------------------------------ */
function stat(label, value, iconName, hint) {
  return `
    <div class="stat">
      <span class="stat-ico">${icon(iconName)}</span>
      <span class="label">${esc(label)}</span>
      <span class="value">${esc(value)}</span>
      <span class="hint">${esc(hint)}</span>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* Prochaine étape — déduite de l'état réel, jamais affichée à vide     */
/* ------------------------------------------------------------------ */
function nextStep(s) {
  let step = null;

  if (!s.kb_total) {
    step = {
      icon: 'book',
      title: 'Alimentez la base de connaissance',
      text: 'Sans réponse de référence, le moteur n’a rien à proposer. Commencez par '
        + 'les questions qui reviennent dans tous les questionnaires.',
      action: '<a class="btn primary" href="#/kb">Ajouter des réponses</a>',
    };
  } else if (!s.questionnaires_total) {
    step = {
      icon: 'upload',
      title: 'Traitez un premier questionnaire',
      text: `Votre base compte ${fmtNum(s.kb_total)} réponses : elle est prête à être `
        + 'confrontée à un questionnaire client.',
      action: '<a class="btn primary" href="#/questionnaires">Téléverser un questionnaire</a>',
    };
  } else if (s.questionnaires_open) {
    const pending = Math.max(0, s.questions_total - s.questions_validated);
    step = {
      icon: 'wand',
      title: `${fmtNum(s.questionnaires_open)} questionnaire${s.questionnaires_open > 1 ? 's' : ''} `
        + `en cours de traitement`,
      text: pending
        ? `${fmtNum(pending)} question${pending > 1 ? 's' : ''} attend${pending > 1 ? 'ent' : ''} `
          + 'encore une validation.'
        : 'Toutes les questions ont été traitées : il reste à exporter les réponses.',
      action: '<a class="btn primary" href="#/questionnaires">Reprendre le traitement</a>',
    };
  }

  if (!step) return '';

  return `
    <div class="card hoverable mb-2">
      <div class="card-body flex" style="align-items:center;gap:15px;flex-wrap:wrap">
        <span class="stat-ico" style="position:static;flex:none;width:38px;height:38px">
          ${icon(step.icon)}
        </span>
        <div class="grow" style="min-width:240px">
          <div class="row-title">${esc(step.title)}</div>
          <p class="muted small" style="margin-top:2px">${esc(step.text)}</p>
        </div>
        ${step.action}
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* Listes                                                              */
/* ------------------------------------------------------------------ */
/* Barres de magnitude : une seule teinte, la longueur porte la valeur. Au-delà
   de huit domaines, la queue est annoncée plutôt que coupée en silence. */
function barList(items) {
  const max = Math.max(...items.map((item) => item.n), 1);
  const shown = items.slice(0, 8);
  const rest = items.length - shown.length;

  return `
    <div class="bar-list">
      ${shown.map((item) => `
        <div class="bar-row">
          <span class="bar-label" title="${esc(item.category)}">${esc(item.category)}</span>
          <span class="bar-track">
            <span class="bar-fill" style="width:${Math.max(3, (item.n / max) * 100)}%"></span>
          </span>
          <span class="bar-value">${fmtNum(item.n)}</span>
        </div>`).join('')}
    </div>
    ${rest > 0 ? `
      <p class="dim small mt-2">
        ${fmtNum(rest)} autre${rest > 1 ? 's' : ''} domaine${rest > 1 ? 's' : ''} non affiché${rest > 1 ? 's' : ''} —
        <a href="#/kb">voir la base complète</a>.
      </p>` : ''}`;
}

function topRow(entry) {
  return `
    <div class="flex" style="align-items:flex-start;gap:11px">
      <span class="badge accent nowrap" title="Réutilisations validées">${entry.usage_count}×</span>
      <div class="grow">
        <div class="small">${esc(truncate(entry.question, 88))}</div>
        <div class="dim" style="font-size:.75rem">${esc(entry.category)}</div>
      </div>
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
          <div class="progress ${progress >= 1 ? 'ok' : ''}">
            <span style="width:${Math.round(progress * 100)}%"></span>
          </div>
          <span class="meter-val">${q.n_done}/${q.n_questions}</span>
        </div>
      </div>
      ${icon('chevronRight')}
    </a>`;
}

/* ------------------------------------------------------------------ */
/* Premier démarrage                                                   */
/* ------------------------------------------------------------------ */
function welcome(ctx) {
  const name = (ctx.session?.full_name || ctx.session?.username || '').split(/[\s._-]+/)[0];

  return `
    <div class="page-head">
      <div>
        <p class="eyebrow">${icon('sparkle')}Première mise en route</p>
        <h1>Bienvenue${name ? `, ${esc(name)}` : ''}</h1>
        <p class="sub">
          Cette application centralise vos réponses de conformité et les réutilise
          automatiquement pour répondre aux questionnaires sécurité de vos clients.
        </p>
      </div>
    </div>

    <div class="card mb-2">
      <div class="card-body">
        <h2 class="mb-2">Trois étapes pour démarrer</h2>
        <div class="grid cols-3">
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

    <div class="grid cols-2">
      <div class="card">
        <div class="card-body flex" style="align-items:flex-start;gap:13px">
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
      </div>

      <div class="card">
        <div class="card-body flex" style="align-items:flex-start;gap:13px">
          ${icon('command')}
          <div>
            <h3>Deux raccourcis à connaître</h3>
            <p class="muted small mt-1">
              <b>Ctrl + K</b> ouvre la recherche rapide : toutes les pages et les gestes
              courants au clavier. L’avatar en haut à droite regroupe votre fiche, la
              vérification en deux étapes et l’apparence de l’interface.
            </p>
          </div>
        </div>
      </div>
    </div>`;
}

function step(n, iconName, title, text) {
  return `
    <div class="flex" style="align-items:flex-start;gap:12px">
      <span class="stat-ico" style="position:static;flex:none">${icon(iconName)}</span>
      <div>
        <div class="row-title">${n}. ${esc(title)}</div>
        <p class="muted small mt-1">${esc(text)}</p>
      </div>
    </div>`;
}
