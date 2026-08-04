/* Coquille applicative : barre latérale rétractable, info-bulles, barre
 * supérieure, menu du compte.
 *
 * Tout ce qui entoure la vue vit ici ; app.js ne garde que le routeur.
 */

import { api } from './api.js';
import { openSettings } from './account.js';
import { openPalette } from './palette.js';
import { cycleTheme, getPrefs, setPrefs, THEME_LABEL } from './prefs.js';
import { dropdown, closeMenus, initials, toast } from './ui.js';

const sidebar = document.getElementById('sidebar');
const scrim = document.getElementById('scrim');
const tip = document.getElementById('tip-root');

/* ------------------------------------------------------------------ */
/* Barre latérale                                                      */
/* ------------------------------------------------------------------ */
/* Deux comportements distincts derrière un seul composant :
   — au-delà de 900 px, la barre se réduit en rail d'icônes (état persistant) ;
   — en dessous, elle devient un tiroir superposé (état éphémère).
   Le seuil est le même que celui de la feuille de style. */
const isDrawerMode = () => window.matchMedia('(max-width: 900px)').matches;

export function closeSidebar() {
  sidebar.classList.remove('open');
  scrim.hidden = true;
}

function toggleRail() {
  const collapsed = getPrefs().sidebar === 'collapsed';
  setPrefs({ sidebar: collapsed ? 'expanded' : 'collapsed' });
  syncRailToggle();
  hideTip();
}

function syncRailToggle() {
  const button = document.getElementById('rail-toggle');
  const collapsed = getPrefs().sidebar === 'collapsed';
  button.setAttribute('aria-pressed', String(collapsed));
  button.setAttribute('aria-label', collapsed ? 'Déployer le menu' : 'Réduire le menu');
  button.dataset.tip = collapsed ? 'Déployer le menu' : 'Réduire le menu';
}

/* ------------------------------------------------------------------ */
/* Info-bulles                                                         */
/* ------------------------------------------------------------------ */
/* Posées sur <body> en position fixe : à l'intérieur de la barre latérale,
   le conteneur de défilement les rognerait. Elles ne s'affichent pour les
   éléments de la barre que lorsque celle-ci est réduite — sinon elles
   répéteraient une étiquette déjà lisible à côté. */
let tipTimer = null;

function hideTip() {
  clearTimeout(tipTimer);
  tip.classList.remove('show');
  tip.hidden = true;
}

function showTip(target) {
  const text = target.dataset.tip;
  if (!text) return;
  const inSidebar = sidebar.contains(target);
  if (inSidebar && (getPrefs().sidebar !== 'collapsed' || isDrawerMode())) return;
  if (isDrawerMode()) return;

  tip.textContent = text;
  tip.hidden = false;
  tip.classList.remove('below');

  const anchor = target.getBoundingClientRect();
  const box = tip.getBoundingClientRect();

  if (inSidebar) {
    // Dégagement suffisant pour que la pointe de la bulle ne chevauche pas le
    // bord de la barre latérale.
    tip.style.left = `${anchor.right + 16}px`;
    tip.style.top = `${anchor.top + anchor.height / 2 - box.height / 2}px`;
  } else {
    tip.classList.add('below');
    const left = anchor.left + anchor.width / 2 - box.width / 2;
    tip.style.left = `${Math.min(Math.max(8, left), window.innerWidth - box.width - 8)}px`;
    tip.style.top = `${anchor.bottom + 9}px`;
  }
  tipTimer = setTimeout(() => tip.classList.add('show'), 60);
}

function initTips() {
  document.addEventListener('pointerover', (event) => {
    const target = event.target.closest?.('[data-tip]');
    if (target) showTip(target); else hideTip();
  });
  document.addEventListener('pointerdown', hideTip);
  document.addEventListener('focusin', (event) => {
    const target = event.target.closest?.('[data-tip]');
    if (target) showTip(target); else hideTip();
  });
  document.addEventListener('focusout', hideTip);
  window.addEventListener('scroll', hideTip, true);
  window.addEventListener('resize', hideTip);
}

/* ------------------------------------------------------------------ */
/* Compte connecté                                                     */
/* ------------------------------------------------------------------ */
/* Appelée à chaque `ctx.setSession()` : toute vue qui modifie le compte
   (fiche, second facteur) met ainsi la barre supérieure à jour sans
   rechargement. */
export function applySession(status) {
  const name = status.full_name || status.username || '';
  const mark = initials(status.full_name, status.username);
  const role = status.is_admin ? 'Administrateur' : 'Membre';

  document.getElementById('user-avatar').textContent = mark;
  document.getElementById('menu-avatar').textContent = mark;
  document.getElementById('user-name').textContent = name;
  document.getElementById('menu-name').textContent = name;
  document.getElementById('user-role').textContent = role;

  const mail = document.getElementById('menu-mail');
  mail.textContent = status.email || 'Aucune adresse associée';
  mail.classList.toggle('dim', !status.email);

  const roleBadge = document.getElementById('menu-role');
  roleBadge.textContent = role;
  roleBadge.className = `badge ${status.is_admin ? 'accent' : ''}`;

  document.querySelectorAll('[data-admin-only]').forEach((node) => {
    node.hidden = !status.is_admin;
  });

  // Second facteur : pastille sur l'icône des paramètres, et état rappelé dans
  // le menu. Incitation permanente, jamais bloquante.
  const low = status.mfa_enabled && status.recovery_codes_remaining <= 2;
  const alert = document.getElementById('mfa-alert');
  alert.hidden = Boolean(status.mfa_enabled) && !low;
  alert.title = low
    ? `Plus que ${status.recovery_codes_remaining} code(s) de récupération`
    : 'Vérification en deux étapes non activée';

  const state = document.getElementById('menu-mfa');
  state.textContent = status.mfa_enabled ? (low ? 'Codes à refaire' : 'Protégé') : 'À activer';
  state.className = `mi-state ${status.mfa_enabled && !low ? 'ok' : 'warn'}`;
}

/* ------------------------------------------------------------------ */
/* Démarrage                                                           */
/* ------------------------------------------------------------------ */
export function initShell(ctx) {
  /* --- Barre latérale --- */
  document.getElementById('rail-toggle').addEventListener('click', toggleRail);
  syncRailToggle();
  // Le même réglage est aussi offert dans le panneau « Apparence » : les deux
  // commandes doivent rester d'accord sur l'état affiché.
  window.addEventListener('shell:rail-sync', syncRailToggle);

  document.getElementById('burger').addEventListener('click', () => {
    const open = sidebar.classList.toggle('open');
    scrim.hidden = !open;
  });
  scrim.addEventListener('click', closeSidebar);

  /* --- Recherche rapide --- */
  const palette = () => openPalette(ctx);
  document.getElementById('side-search').addEventListener('click', palette);
  document.getElementById('cmd-btn').addEventListener('click', palette);
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      palette();
    }
  });

  /* --- Thème --- */
  const themeButton = document.getElementById('theme-btn');
  const syncTheme = () => { themeButton.dataset.tip = THEME_LABEL[getPrefs().theme]; };
  themeButton.addEventListener('click', () => {
    const next = cycleTheme();
    syncTheme();
    toast(THEME_LABEL[next], '', 'info', 1500);
  });
  syncTheme();

  /* --- Paramètres et menu du compte --- */
  document.getElementById('settings-btn').addEventListener('click', () => openSettings(ctx));

  const menu = dropdown(
    document.getElementById('user-chip'),
    document.getElementById('user-menu'),
  );
  document.getElementById('user-menu').addEventListener('click', (event) => {
    const item = event.target.closest('[data-open]');
    if (item) openSettings(ctx, item.dataset.open);
  });

  document.getElementById('btn-logout').addEventListener('click', async () => {
    try { await api.post('/api/auth/logout'); } catch { /* on se déconnecte quand même */ }
    window.location.href = '/login';
  });

  /* --- Info-bulles --- */
  initTips();

  // Un changement de page ferme tout ce qui flotte : un menu resté ouvert
  // au-dessus de la nouvelle vue donne l'impression d'un écran figé.
  window.addEventListener('hashchange', () => {
    closeMenus();
    closeSidebar();
    hideTip();
  });

  return menu;
}
