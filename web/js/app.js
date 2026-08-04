/* Routeur de l'application. Tout ce qui entoure la vue — barre latérale, barre
 * supérieure, menu du compte, palette de commandes — vit dans shell.js.
 */

import { api } from './api.js';
import { applySession, closeSidebar, initShell } from './shell.js';
import { hydratePrefs } from './prefs.js';
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
  // Les préférences du compte prennent le pas sur le cache local, qui peut
  // appartenir à quelqu'un d'autre sur le même navigateur.
  hydratePrefs(status.preferences);
  ctx.setSession(status);
  return true;
}

/* ------------------------------------------------------------------ */
/* Contexte offert aux vues                                            */
/* ------------------------------------------------------------------ */
export const ctx = {
  session: null,

  /* Toute vue qui modifie l'état du compte (fiche, second facteur, codes de
     récupération…) passe par ici : la barre supérieure reflète alors
     immédiatement le nouvel état, sans attendre un rechargement de page. */
  setSession(status) {
    this.session = status;
    applySession(status);
  },

  /* Le dernier maillon répète mot pour mot le <h1> de la page : on ne rend que
     ses ancêtres, qui portent eux une vraie navigation (« Clients / Nordic
     Wings » se réduit à un retour vers « Clients »). Les vues continuent de
     passer le fil complet — c'est la barre supérieure qui décide de ce qu'elle
     en montre, sans avoir à toucher chaque vue. */
  setCrumb(parts) {
    crumbNode.innerHTML = parts
      .slice(0, -1)
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

/* Apparition échelonnée des blocs de la vue. La classe est retirée sitôt
   l'animation terminée : les rendus suivants d'une même vue (filtre saisi,
   liste rechargée) ne doivent pas rejouer l'entrée à chaque frappe. */
let enterTimer = null;
function playEnter() {
  clearTimeout(enterTimer);
  viewNode.classList.remove('enter');
  void viewNode.offsetWidth;
  viewNode.classList.add('enter');
  /* Marge courte au-dessus du cumul réel (.22s d'animation + .105s de décalage
     maximum) : la classe doit disparaître dès la fin, sinon un rendu partiel
     déclenché juste après rejouerait l'entrée. */
  enterTimer = setTimeout(() => viewNode.classList.remove('enter'), 450);
}

/* Le temps de réponse de l'API locale se compte en dizaines de millisecondes.
   Vider la vue puis y poser un spinner aussitôt retiré se lit comme un
   clignotement, et une page qui clignote paraît plus lente qu'une page qui
   attend un instant sans bouger. On ne montre donc le spinner que si la réponse
   se fait vraiment attendre ; en dessous, la vue précédente reste à l'écran
   jusqu'au remplacement. Le retour immédiat, c'est la surbrillance du menu, qui
   bascule avant le moindre appel réseau. */
const LOADER_GRACE = 150;

/* Deux clics rapprochés lancent deux rendus concurrents. Sans repère, le plus
   lent écrit après le plus rapide et c'est la page abandonnée qui s'affiche. */
let generation = 0;

async function render() {
  const { path, query } = currentPath();
  const match = ROUTES.map((route) => ({ route, m: route.pattern.exec(path) }))
    .find((entry) => entry.m);
  const mine = ++generation;

  document.querySelectorAll('.nav-item').forEach((item) =>
    item.classList.toggle('active', item.dataset.route === match?.route.name));

  actionsNode.innerHTML = '';
  viewNode.classList.remove('enter');
  window.scrollTo({ top: 0 });
  closeSidebar();

  const spinner = setTimeout(() => {
    if (mine === generation) {
      viewNode.innerHTML = '<div class="loader"><span class="spinner"></span></div>';
    }
  }, LOADER_GRACE);

  if (!match) {
    clearTimeout(spinner);
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
    if (mine !== generation) return;
    playEnter();
  } catch (error) {
    console.error(error);
    if (mine !== generation) return;
    viewNode.innerHTML = `
      <div class="empty">
        ${icon('xCircle')}
        <h3>Une erreur est survenue</h3>
        <p>${esc(error.message || String(error))}</p>
        <button class="btn" onclick="location.reload()">Recharger</button>
      </div>`;
    toast('Erreur', error.message || String(error), 'error');
  } finally {
    /* La vue a rendu (ou échoué) : le spinner différé n'a plus lieu d'être, même
       si le délai n'est pas encore écoulé. C'est ce `clearTimeout` qui garantit
       qu'une navigation rapide n'en voit jamais la couleur. */
    clearTimeout(spinner);
  }
}

initShell(ctx);
window.addEventListener('hashchange', render);
bootstrapSession().then((ok) => { if (ok) render(); });
