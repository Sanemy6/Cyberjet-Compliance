/* Journal d'audit — consultation réservée aux administrateurs. */

import { api } from '../api.js';
import {
  debounce, emptyState, esc, fmtNum, icon, modal, toast, truncate,
} from '../ui.js';

const PAGE_SIZE = 100;

/* Familles d'événements et intention de lecture associée. Le résultat
   « échec » prime sur la famille : un échec doit sauter aux yeux. */
const EVENT_TONE = {
  auth: 'accent', mfa: 'accent', user: 'warn', export: 'warn',
  client: '', kb: '', config: '', questionnaire: '', audit: '',
};

export default async function auditView(node, ctx) {
  ctx.setCrumb([{ label: 'Journal d’audit' }]);

  if (!ctx.session?.is_admin) {
    node.innerHTML = `<div class="card">${emptyState({
      iconName: 'lock',
      title: 'Accès réservé',
      text: 'Seuls les administrateurs consultent le journal d’audit.',
    })}</div>`;
    return;
  }

  const filters = { category: '', outcome: '', actor: '', since: '', until: '', q: '' };
  let offset = 0;
  let data = null;

  ctx.setActions(`
    <button class="btn" data-what>${icon('info')}<span class="nowrap">Ce qui est journalisé</span></button>
    <button class="btn primary" data-export>${icon('download')}<span class="nowrap">Exporter en CSV</span></button>`);
  document.querySelector('[data-what]').addEventListener('click', whatIsLogged);
  document.querySelector('[data-export]').addEventListener('click', () => {
    const query = api.qs({ ...filters });
    window.location.href = `/api/audit/export${query}`;
    toast('Export lancé', 'Le téléchargement démarre.', 'ok', 2500);
  });

  async function load(resetOffset = true) {
    if (resetOffset) offset = 0;
    data = await api.get('/api/audit', { ...filters, limit: PAGE_SIZE, offset });
    render();
  }

  function render() {
    const s = data.summary;
    node.innerHTML = `
      <div class="page-head">
        <div>
          <h1>Journal d’audit</h1>
          <p class="sub">
            Trace des connexions, des changements de droits, des modifications de données et
            des exports. Conservation : ${data.retention_days} jours.
          </p>
        </div>
      </div>

      <div class="grid cols-4 mb-2">
        ${stat('Entrées au journal', fmtNum(s.total_entries), 'book',
          s.oldest ? `depuis le ${frDate(s.oldest)}` : 'aucune entrée')}
        ${stat('Échecs de connexion', fmtNum(s.failed_logins_24h), 'xCircle',
          'dernières 24 heures', s.failed_logins_24h > 0 ? 'warn' : '')}
        ${stat('Comptes verrouillés', fmtNum(s.lockouts_24h), 'lock',
          'dernières 24 heures', s.lockouts_24h > 0 ? 'danger' : '')}
        ${stat('Échecs de second facteur', fmtNum(s.mfa_failures_24h), 'shield',
          'dernières 24 heures', s.mfa_failures_24h > 0 ? 'warn' : '')}
      </div>

      <div class="toolbar">
        <div class="search-box">
          ${icon('search')}
          <input class="input" data-f-q value="${esc(filters.q)}"
                 placeholder="Rechercher une cible, un détail, une adresse IP…">
        </div>
        <select class="select" data-f-category style="max-width:200px">
          <option value="">Toutes les familles</option>
          ${data.categories.map((c) =>
            `<option value="${esc(c.code)}"${c.code === filters.category ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}
        </select>
        <select class="select" data-f-actor style="max-width:180px">
          <option value="">Tous les acteurs</option>
          ${data.actors.map((a) =>
            `<option value="${esc(a)}"${a === filters.actor ? ' selected' : ''}>${esc(a)}</option>`).join('')}
        </select>
        <select class="select" data-f-outcome style="max-width:150px">
          <option value="">Tous résultats</option>
          <option value="success"${filters.outcome === 'success' ? ' selected' : ''}>Réussite</option>
          <option value="failure"${filters.outcome === 'failure' ? ' selected' : ''}>Échec</option>
        </select>
        <input class="input" type="date" data-f-since value="${esc(filters.since)}"
               style="max-width:160px" title="À partir du">
        <input class="input" type="date" data-f-until value="${esc(filters.until)}"
               style="max-width:160px" title="Jusqu’au">
        ${Object.values(filters).some(Boolean)
          ? '<button class="btn ghost sm" data-clear>Réinitialiser</button>' : ''}
      </div>

      <p class="dim small mb-1">
        ${fmtNum(data.total)} entrée${data.total > 1 ? 's' : ''}
        ${data.total > PAGE_SIZE
          ? ` — affichage de ${offset + 1} à ${Math.min(offset + PAGE_SIZE, data.total)}` : ''}
      </p>

      <div class="card">
        ${data.entries.length ? `
          <div class="table-wrap">
            <table class="tbl">
              <thead>
                <tr>
                  <th style="width:150px">Horodatage</th>
                  <th style="width:230px">Événement</th>
                  <th style="width:130px">Acteur</th>
                  <th style="width:120px">Adresse IP</th>
                  <th>Cible et détail</th>
                </tr>
              </thead>
              <tbody>${data.entries.map(row).join('')}</tbody>
            </table>
          </div>` : emptyState({
            iconName: 'inbox',
            title: 'Aucune entrée',
            text: 'Aucun événement ne correspond à ces filtres.',
          })}
      </div>

      ${data.total > PAGE_SIZE ? `
        <div class="flex mt-2" style="justify-content:center;gap:9px">
          <button class="btn sm" data-prev ${offset === 0 ? 'disabled' : ''}>
            ${icon('chevronLeft')}Précédentes
          </button>
          <button class="btn sm" data-next ${offset + PAGE_SIZE >= data.total ? 'disabled' : ''}>
            Suivantes${icon('chevronRight')}
          </button>
        </div>` : ''}`;

    bind();
  }

  function row(entry) {
    const family = entry.event.split('.')[0];
    const failed = entry.outcome === 'failure';
    const tone = failed ? 'danger' : (EVENT_TONE[family] ?? '');
    return `
      <tr${failed ? ' style="background:var(--danger-soft)"' : ''}>
        <td class="dim small nowrap mono">${esc(frDateTime(entry.at))}</td>
        <td>
          <span class="badge ${tone}">${failed ? icon('xCircle') : ''}${esc(entry.event_label)}</span>
          <div class="dim mono" style="font-size:.68rem;margin-top:3px">${esc(entry.event)}</div>
        </td>
        <td class="small">${entry.actor_name ? esc(entry.actor_name) : '<span class="dim">—</span>'}</td>
        <td class="dim small mono">${esc(entry.ip || '—')}</td>
        <td class="small">
          ${entry.target_label
            ? `<div>${esc(truncate(entry.target_label, 90))}</div>` : ''}
          ${entry.detail
            ? `<div class="dim" style="font-size:.75rem;margin-top:2px">${esc(entry.detail)}</div>` : ''}
          ${!entry.target_label && !entry.detail ? '<span class="dim">—</span>' : ''}
        </td>
      </tr>`;
  }

  function bind() {
    const wire = (selector, key, immediate = true) => {
      const input = node.querySelector(selector);
      if (!input) return;
      const handler = () => { filters[key] = input.value; load(); };
      input.addEventListener(immediate ? 'change' : 'input',
        immediate ? handler : debounce(handler, 280));
    };
    wire('[data-f-q]', 'q', false);
    wire('[data-f-category]', 'category');
    wire('[data-f-actor]', 'actor');
    wire('[data-f-outcome]', 'outcome');
    wire('[data-f-since]', 'since');
    wire('[data-f-until]', 'until');

    node.querySelector('[data-clear]')?.addEventListener('click', () => {
      Object.keys(filters).forEach((key) => { filters[key] = ''; });
      load();
    });
    node.querySelector('[data-prev]')?.addEventListener('click', () => {
      offset = Math.max(0, offset - PAGE_SIZE);
      load(false);
    });
    node.querySelector('[data-next]')?.addEventListener('click', () => {
      offset += PAGE_SIZE;
      load(false);
    });
  }

  await load();
}

function stat(label, value, iconName, hint, tone = '') {
  return `
    <div class="stat">
      <span class="stat-ico"${tone ? ` style="background:var(--${tone}-soft);color:var(--${tone})"` : ''}>
        ${icon(iconName)}
      </span>
      <span class="label">${esc(label)}</span>
      <span class="value"${tone ? ` style="color:var(--${tone})"` : ''}>${esc(value)}</span>
      <span class="hint">${esc(hint)}</span>
    </div>`;
}

function frDateTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(date);
}

function frDate(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso
    : new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

/* Rendre explicite le périmètre du journal : un utilisateur doit savoir ce
   qui est tracé le concernant, et un auditeur ce sur quoi il peut compter. */
function whatIsLogged() {
  modal({
    title: 'Ce qui est journalisé',
    sub: 'Périmètre, contenu et limites de la trace',
    wide: true,
    body: `
      <div class="flex col" style="gap:16px">
        <div>
          <h3 class="mb-1">Événements tracés</h3>
          <ul class="loss-list">
            <li><b>Authentification</b> — connexions réussies et échouées, déconnexions,
                verrouillages après tentatives répétées.</li>
            <li><b>Second facteur</b> — activation, désactivation, vérifications échouées,
                usage d’un code de récupération, réinitialisation par un administrateur.</li>
            <li><b>Comptes</b> — création, suppression, changement de mot de passe,
                attribution ou retrait des droits d’administration, désactivation.</li>
            <li><b>Données</b> — création, modification et suppression des clients, des
                réponses de référence, des configurations techniques et des questionnaires.</li>
            <li><b>Exports</b> — chaque génération de fichier, c’est-à-dire chaque sortie
                de données hors de l’outil.</li>
          </ul>
        </div>

        <div>
          <h3 class="mb-1">Informations enregistrées</h3>
          <p class="muted small">
            Pour chaque événement : l’horodatage UTC, le code et le libellé de l’événement,
            le résultat, l’identifiant de l’acteur, son adresse IP, son navigateur,
            l’objet concerné et un court détail factuel.
          </p>
        </div>

        <div class="callout">
          ${icon('lock')}
          <div>
            <p><b>Ce qui n’est jamais journalisé</b></p>
            <p class="muted small mt-1">
              Aucun mot de passe, aucun jeton de session, aucun secret d’authentification,
              aucun code de récupération — même haché ou tronqué. Aucun contenu métier
              complet non plus : le journal retient la question et l’objet touché, jamais
              le texte des réponses de conformité de vos clients.
            </p>
            <p class="muted small mt-1">
              Les simples consultations ne sont pas tracées. Journaliser chaque lecture
              noierait les événements qui engagent réellement, sans rien prouver d’utile
              à cette échelle.
            </p>
          </div>
        </div>

        <div class="callout">
          ${icon('alert')}
          <div>
            <p><b>Limites à connaître</b></p>
            <p class="muted small mt-1">
              Le journal est en ajout seul du point de vue de l’application : aucun écran
              ne permet d’en modifier ou d’en supprimer une ligne. En revanche, toute
              personne ayant accès au fichier <span class="mono">data/grc.db</span> sur le
              serveur peut techniquement l’altérer. Pour une valeur probante opposable,
              il faudrait exporter périodiquement le journal vers un stockage distinct
              en écriture unique.
            </p>
          </div>
        </div>
      </div>`,
    foot: '<button class="btn primary" data-close>Compris</button>',
  });
}
