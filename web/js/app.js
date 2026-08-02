/* Routeur, shell applicatif et gestion du thème. */

import { api } from './api.js';
import { esc, icon, toast } from './ui.js';
import dashboard from './views/dashboard.js';
import assistant from './views/assistant.js';
import clients from './views/clients.js';
import clientDetail from './views/client.js';
import knowledge from './views/kb.js';
import questionnaires from './views/questionnaires.js';
import questionnaireDetail from './views/questionnaire.js';
import frameworks from './views/frameworks.js';
import storageView from './views/storage.js';
import usersView from './views/users.js';
import securityView from './views/security.js';
import auditView from './views/audit.js';

const viewNode = document.getElementById('view');
const crumbNode = document.getElementById('crumb');
const actionsNode = document.getElementById('topbar-actions');
const sidebar = document.getElementById('sidebar');
const scrim = document.getElementById('scrim');

/* ------------------------------------------------------------------ */
/* Thème — « auto » est résolu ici pour ne garder qu'un bloc CSS sombre */
/* ------------------------------------------------------------------ */
const media = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme() {
  const preference = localStorage.getItem('theme') || 'auto';
  const resolved = preference === 'auto' ? (media.matches ? 'dark' : 'light') : preference;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePref = preference;
  const label = document.querySelector('.theme-label');
  if (label) {
    label.textContent = { auto: 'Thème automatique', light: 'Thème clair', dark: 'Thème sombre' }[preference];
  }
}

document.getElementById('theme-toggle').addEventListener('click', () => {
  const order = ['auto', 'light', 'dark'];
  const current = localStorage.getItem('theme') || 'auto';
  localStorage.setItem('theme', order[(order.indexOf(current) + 1) % order.length]);
  applyTheme();
});
media.addEventListener('change', applyTheme);
applyTheme();

/* ------------------------------------------------------------------ */
/* Navigation mobile                                                    */
/* ------------------------------------------------------------------ */
function closeSidebar() {
  sidebar.classList.remove('open');
  scrim.hidden = true;
}
document.getElementById('burger').addEventListener('click', () => {
  sidebar.classList.toggle('open');
  scrim.hidden = !sidebar.classList.contains('open');
});
scrim.addEventListener('click', closeSidebar);

/* ------------------------------------------------------------------ */
/* Session — vérifiée avant le premier rendu ; la page de connexion et      */
/* celle de création du premier compte vivent hors de cette SPA.           */
/* ------------------------------------------------------------------ */
async function bootstrapSession() {
  let status;
  try {
    status = await api.get('/api/auth/status');
  } catch {
    // Serveur injoignable : on affiche quand même le shell, l'erreur
    // remontera au premier appel réel depuis une vue.
    return true;
  }
  if (status.needs_setup || !status.authenticated) {
    window.location.href = '/login';
    return false;
  }
  ctx.setSession(status);
  return true;
}

function applySessionToShell(status) {
  const account = document.getElementById('sidebar-account');
  if (account) {
    account.hidden = false;
    document.getElementById('sa-name').textContent = status.username;
    document.getElementById('sa-avatar').textContent =
      status.username.slice(0, 2).toUpperCase();
  }
  document.querySelectorAll('[data-admin-only]').forEach((node) => {
    node.hidden = !status.is_admin;
  });

  // Pastille discrète tant que le second facteur n'est pas activé : incitation
  // permanente, sans bloquer l'usage de l'application. Elle doit suivre les
  // changements faits en cours de session, pas seulement l'état au chargement —
  // d'où le passage systématique par ctx.setSession().
  const alertDot = document.getElementById('mfa-alert');
  if (alertDot) {
    const low = status.mfa_enabled && status.recovery_codes_remaining <= 2;
    alertDot.hidden = Boolean(status.mfa_enabled) && !low;
    alertDot.title = low
      ? `Plus que ${status.recovery_codes_remaining} code(s) de récupération`
      : 'Vérification en deux étapes non activée';
  }
}

document.getElementById('btn-logout').addEventListener('click', async () => {
  try { await api.post('/api/auth/logout'); } catch { /* on se déconnecte quand même */ }
  window.location.href = '/login';
});

/* ------------------------------------------------------------------ */
/* Contexte offert aux vues                                            */
/* ------------------------------------------------------------------ */
export const ctx = {
  session: null,

  /* Toute vue qui modifie l'état du compte (activation du second facteur,
     régénération des codes…) passe par ici : la barre latérale reflète alors
     immédiatement le nouvel état, sans attendre un rechargement de page. */
  setSession(status) {
    this.session = status;
    applySessionToShell(status);
  },

  setCrumb(parts) {
    crumbNode.innerHTML = parts
      .map((part, i) => {
        const sep = i ? '<span class="sep">/</span>' : '';
        const label = part.href
          ? `<a href="${esc(part.href)}">${esc(part.label)}</a>`
          : `<b>${esc(part.label)}</b>`;
        return sep + label;
      })
      .join('');
  },
  setActions(markup = '') {
    actionsNode.innerHTML = markup;
    return actionsNode;
  },
  navigate(hash) {
    window.location.hash = hash;
  },
  refresh() {
    render();
  },
};

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */
const ROUTES = [
  { pattern: /^\/?$/, name: 'dashboard', view: dashboard },
  { pattern: /^\/assistant$/, name: 'assistant', view: assistant },
  { pattern: /^\/clients$/, name: 'clients', view: clients },
  { pattern: /^\/clients\/(\d+)$/, name: 'clients', view: clientDetail },
  { pattern: /^\/kb$/, name: 'kb', view: knowledge },
  { pattern: /^\/questionnaires$/, name: 'questionnaires', view: questionnaires },
  { pattern: /^\/questionnaires\/(\d+)$/, name: 'questionnaires', view: questionnaireDetail },
  { pattern: /^\/frameworks$/, name: 'frameworks', view: frameworks },
  { pattern: /^\/storage$/, name: 'storage', view: storageView },
  { pattern: /^\/users$/, name: 'users', view: usersView },
  { pattern: /^\/security$/, name: 'security', view: securityView },
  { pattern: /^\/audit$/, name: 'audit', view: auditView },
];

function currentPath() {
  const hash = window.location.hash.replace(/^#/, '');
  const [path, query] = hash.split('?');
  return { path: path || '/', query: new URLSearchParams(query || '') };
}

async function render() {
  const { path, query } = currentPath();
  const match = ROUTES.map((route) => ({ route, m: route.pattern.exec(path) }))
    .find((entry) => entry.m);

  document.querySelectorAll('.nav-item').forEach((item) =>
    item.classList.toggle('active', item.dataset.route === match?.route.name));

  actionsNode.innerHTML = '';
  viewNode.innerHTML = '<div class="loader"><span class="spinner"></span></div>';
  window.scrollTo({ top: 0 });
  closeSidebar();

  if (!match) {
    ctx.setCrumb([{ label: 'Page introuvable' }]);
    viewNode.innerHTML = `
      <div class="empty">
        ${icon('alert')}
        <h3>Page introuvable</h3>
        <p>Le lien demandé n’existe pas.</p>
        <a class="btn primary" href="#/">Retour au tableau de bord</a>
      </div>`;
    return;
  }

  try {
    const params = match.m.slice(1);
    await match.route.view(viewNode, ctx, { params, query });
  } catch (error) {
    console.error(error);
    viewNode.innerHTML = `
      <div class="empty">
        ${icon('xCircle')}
        <h3>Une erreur est survenue</h3>
        <p>${esc(error.message || String(error))}</p>
        <button class="btn" onclick="location.reload()">Recharger</button>
      </div>`;
    toast('Erreur', error.message || String(error), 'error');
  }
}

window.addEventListener('hashchange', render);
bootstrapSession().then((ok) => { if (ok) render(); });
