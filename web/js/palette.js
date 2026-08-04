/* Palette de commandes (Ctrl/⌘ + K) — aller n'importe où, lancer les gestes
 * courants, sans quitter le clavier.
 *
 * Elle ne cherche que dans l'application : pages et actions. La recherche dans
 * les données (réponses, questions) a sa propre vue — l'assistant — parce
 * qu'elle appelle le moteur de rapprochement, pas un filtre de libellés.
 */

import { api } from './api.js';
import { openSettings } from './account.js';
import { clientForm } from './forms.js';
import { cycleTheme, getPrefs, setPrefs, THEME_LABEL } from './prefs.js';
import { el, esc, icon } from './ui.js';

const PAGES = [
  { icon: 'home', label: 'Tableau de bord', sub: 'Vue d’ensemble', hash: '#/',
    keywords: 'accueil pilotage synthese couverture' },
  { icon: 'wand', label: 'Assistant réponse', sub: 'Poser une question à la base',
    hash: '#/assistant', keywords: 'chercher rapprochement moteur' },
  { icon: 'users', label: 'Clients', sub: 'Dossiers et périmètres', hash: '#/clients',
    keywords: 'compagnies organismes dossiers' },
  { icon: 'fileText', label: 'Questionnaires', sub: 'Traitement en cours',
    hash: '#/questionnaires', keywords: 'excel word pdf import televerser' },
  { icon: 'book', label: 'Base de connaissance', sub: 'Réponses de référence', hash: '#/kb',
    keywords: 'kb patrimoine reponses' },
  { icon: 'shieldCheck', label: 'Référentiels', sub: 'Contrôles et exigences',
    hash: '#/frameworks', keywords: 'iso 27001 nis2 dora controles' },
  { icon: 'database', label: 'Volumétrie', sub: 'Ce qui est stocké', hash: '#/storage',
    keywords: 'taille disque stockage base' },
  { icon: 'lock', label: 'Sécurité du compte', sub: 'Second facteur', hash: '#/security',
    keywords: 'mfa totp authentification codes' },
  { icon: 'users', label: 'Comptes', sub: 'Qui peut se connecter', hash: '#/users',
    admin: true, keywords: 'utilisateurs droits administrateurs' },
  { icon: 'history', label: 'Journal d’audit', sub: 'Événements tracés', hash: '#/audit',
    admin: true, keywords: 'logs traces evenements' },
];

/* `keep: true` — la palette reste ouverte : ces commandes s'enchaînent
   volontiers (essayer les thèmes l'un après l'autre, par exemple). */
const ACTIONS = [
  {
    icon: 'plus', label: 'Nouveau client', sub: 'Créer un dossier',
    keywords: 'ajouter creer compagnie',
    run: () => clientForm(null, (client) => { window.location.hash = `#/clients/${client.id}`; }),
  },
  {
    icon: 'upload', label: 'Traiter un questionnaire', sub: 'Téléverser un fichier',
    keywords: 'importer excel word pdf', hash: '#/questionnaires',
  },
  {
    icon: 'idCard', label: 'Ma fiche', sub: 'Nom, adresse, fonction',
    keywords: 'profil compte mail email courriel',
    run: (ctx) => openSettings(ctx, 'profil'),
  },
  {
    icon: 'lock', label: 'Connexion & sécurité', sub: 'Second facteur, mot de passe',
    keywords: 'mfa mot de passe totp',
    run: (ctx) => openSettings(ctx, 'securite'),
  },
  {
    icon: 'palette', label: 'Apparence', sub: 'Teinte, densité, animations',
    keywords: 'theme couleur densite compact',
    run: (ctx) => openSettings(ctx, 'apparence'),
  },
  {
    icon: 'devices', label: 'Appareils connectés', sub: 'Sessions ouvertes',
    keywords: 'sessions deconnecter appareils',
    run: (ctx) => openSettings(ctx, 'sessions'),
  },
  {
    icon: 'sun', label: 'Changer de thème', keywords: 'clair sombre auto nuit jour',
    sub: () => THEME_LABEL[getPrefs().theme],
    keep: true,
    run: () => cycleTheme(),
  },
  {
    icon: 'panelLeft', label: 'Réduire ou déployer le menu',
    keywords: 'barre laterale rail colonne',
    keep: true,
    run: () => setPrefs({
      sidebar: getPrefs().sidebar === 'collapsed' ? 'expanded' : 'collapsed',
    }),
  },
  {
    icon: 'logOut', label: 'Se déconnecter', keywords: 'quitter sortir logout',
    run: async () => {
      try { await api.post('/api/auth/logout'); } catch { /* on sort quand même */ }
      window.location.href = '/login';
    },
  },
];

/* Comparaison insensible à la casse ET aux accents : « referentiel » doit
   trouver « Référentiels », c'est la façon dont on tape vite. */
const fold = (value) => String(value || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function matches(command, tokens) {
  if (!tokens.length) return true;
  const sub = typeof command.sub === 'function' ? command.sub() : command.sub;
  const haystack = fold(`${command.label} ${sub || ''} ${command.keywords || ''}`);
  return tokens.every((token) => haystack.includes(token));
}

let openInstance = null;

export function openPalette(ctx) {
  if (openInstance) return openInstance;

  const isAdmin = Boolean(ctx.session?.is_admin);
  const groups = [
    { title: 'Pages', items: PAGES.filter((page) => !page.admin || isAdmin) },
    { title: 'Actions', items: ACTIONS },
  ];

  const root = el(`
    <div class="pal-backdrop">
      <div class="palette" role="dialog" aria-modal="true" aria-label="Recherche rapide">
        <div class="pal-head">
          ${icon('search')}
          <input class="pal-input" id="pal-input" type="text" autocomplete="off"
                 spellcheck="false" placeholder="Aller à une page, lancer une action…"
                 role="combobox" aria-expanded="true" aria-controls="pal-list">
          <kbd>Échap</kbd>
        </div>
        <div class="pal-list" id="pal-list" role="listbox"></div>
        <div class="pal-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> naviguer</span>
          <span><kbd>Entrée</kbd> ouvrir</span>
          <span><kbd>Ctrl</kbd><kbd>K</kbd> rappeler</span>
        </div>
      </div>
    </div>`);

  const input = root.querySelector('#pal-input');
  const list = root.querySelector('#pal-list');
  let visible = [];
  let cursor = 0;

  const render = () => {
    const tokens = fold(input.value).split(/\s+/).filter(Boolean);
    visible = [];
    let html = '';

    for (const group of groups) {
      const hits = group.items.filter((item) => matches(item, tokens));
      if (!hits.length) continue;
      html += `<p class="pal-group">${esc(group.title)}</p>`;
      for (const item of hits) {
        const index = visible.push(item) - 1;
        const sub = typeof item.sub === 'function' ? item.sub() : item.sub;
        html += `
          <button class="pal-item" role="option" type="button" data-index="${index}"
                  aria-selected="false">
            ${icon(item.icon)}
            <span class="pi-text">
              ${esc(item.label)}
              ${sub ? `<span class="pi-sub">${esc(sub)}</span>` : ''}
            </span>
            ${icon('arrowUpRight', 'pi-go')}
          </button>`;
      }
    }

    list.innerHTML = html || `
      <p class="dim small" style="padding:22px 12px;text-align:center">
        Aucune page ni action ne correspond à « ${esc(input.value)} ».
      </p>`;
    cursor = 0;
    mark();
  };

  const mark = () => {
    list.querySelectorAll('.pal-item').forEach((node, index) => {
      const on = index === cursor;
      node.setAttribute('aria-selected', String(on));
      if (on) node.scrollIntoView({ block: 'nearest' });
    });
  };

  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    openInstance = null;
    root.remove();
    document.body.style.overflow = '';
  };

  const launch = async (item) => {
    if (!item) return;
    if (!item.keep) close();
    if (item.hash) window.location.hash = item.hash;
    else await item.run?.(ctx);
    if (item.keep) render();
  };

  const onKey = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey)) {
      event.preventDefault();
      cursor = visible.length ? (cursor + 1) % visible.length : 0;
      mark();
    } else if (event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)) {
      event.preventDefault();
      cursor = visible.length ? (cursor - 1 + visible.length) % visible.length : 0;
      mark();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      launch(visible[cursor]);
    }
  };

  input.addEventListener('input', render);
  list.addEventListener('click', (event) => {
    const button = event.target.closest('.pal-item');
    if (button) launch(visible[Number(button.dataset.index)]);
  });
  list.addEventListener('pointermove', (event) => {
    const button = event.target.closest('.pal-item');
    if (!button) return;
    const index = Number(button.dataset.index);
    if (index !== cursor) { cursor = index; mark(); }
  });
  root.addEventListener('mousedown', (event) => { if (event.target === root) close(); });
  document.addEventListener('keydown', onKey, true);

  document.body.style.overflow = 'hidden';
  document.getElementById('modal-root').appendChild(root);
  render();
  input.focus();

  openInstance = { close };
  return openInstance;
}
