/* Préférences d'affichage — thème, teinte, densité, mouvement, barre latérale.
 *
 * Deux dépôts, un rôle chacun : le serveur porte la vérité (les réglages
 * suivent la personne d'un poste à l'autre), le localStorage n'est qu'un cache
 * d'amorçage lu par le script inline de la page, avant le premier pixel. Sans
 * ce cache, chaque chargement afficherait un thème clair avant de basculer.
 */

import { api } from './api.js';

const VALUES = {
  theme: ['auto', 'light', 'dark'],
  accent: ['azur', 'indigo', 'emeraude', 'ardoise', 'cuivre'],
  density: ['confort', 'compact'],
  motion: ['full', 'reduced'],
  sidebar: ['expanded', 'collapsed'],
};

const DEFAULTS = {
  theme: 'auto', accent: 'azur', density: 'confort', motion: 'full', sidebar: 'expanded',
};

export const ACCENTS = [
  { value: 'azur', label: 'Azur', from: '#1a68d1', to: '#1354ac' },
  { value: 'indigo', label: 'Indigo', from: '#5045c8', to: '#413893' },
  { value: 'emeraude', label: 'Émeraude', from: '#0d7052', to: '#0a5b43' },
  { value: 'ardoise', label: 'Ardoise', from: '#3f556e', to: '#32445a' },
  { value: 'cuivre', label: 'Cuivre', from: '#9e4f26', to: '#83411f' },
];

const media = window.matchMedia('(prefers-color-scheme: dark)');
let current = { ...DEFAULTS };
let warned = false;

function sanitize(source = {}) {
  const clean = {};
  for (const [key, allowed] of Object.entries(VALUES)) {
    clean[key] = allowed.includes(source[key]) ? source[key] : DEFAULTS[key];
  }
  return clean;
}

function readCache() {
  const cached = {};
  for (const key of Object.keys(VALUES)) {
    try { cached[key] = localStorage.getItem(key); } catch { /* stockage refusé */ }
  }
  return sanitize(cached);
}

function writeCache() {
  for (const [key, value] of Object.entries(current)) {
    try { localStorage.setItem(key, value); } catch { /* mode privé : le serveur suffit */ }
  }
}

export function getPrefs() {
  return { ...current };
}

/* Thème effectivement appliqué, « auto » résolu. */
export function resolvedTheme() {
  return current.theme === 'auto' ? (media.matches ? 'dark' : 'light') : current.theme;
}

export function applyPrefs() {
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme();
  root.dataset.themePref = current.theme;
  root.dataset.accent = current.accent;
  root.dataset.density = current.density;
  root.dataset.motion = current.motion;
  root.dataset.rail = current.sidebar === 'collapsed' ? '1' : '0';
}

/* Réglages reçus du serveur au démarrage : ils écrasent le cache local, qui
   peut appartenir à un autre compte utilisé sur le même navigateur. */
export function hydratePrefs(serverPrefs) {
  current = sanitize(serverPrefs || readCache());
  writeCache();
  applyPrefs();
}

export function setPrefs(patch) {
  const next = sanitize({ ...current, ...patch });
  const changed = Object.keys(patch).filter((key) => next[key] !== current[key]);
  if (!changed.length) return current;

  current = next;
  writeCache();
  applyPrefs();

  // Enregistrement en tâche de fond : un réglage d'affichage ne doit jamais
  // faire attendre. En cas d'échec, l'écran reste correct — seule la
  // persistance d'un poste à l'autre est perdue, et on le dit une fois.
  api.put('/api/account/preferences', patch).catch(() => {
    if (warned) return;
    warned = true;
    import('./ui.js').then(({ toast }) => toast(
      'Préférences non enregistrées',
      'L’affichage est à jour sur ce poste, mais le serveur n’a pas pu être joint.',
      'warn',
    ));
  });
  return current;
}

/* Cycle du bouton de thème : automatique → clair → sombre. */
export function cycleTheme() {
  const order = VALUES.theme;
  const next = order[(order.indexOf(current.theme) + 1) % order.length];
  setPrefs({ theme: next });
  return next;
}

export const THEME_LABEL = {
  auto: 'Thème automatique', light: 'Thème clair', dark: 'Thème sombre',
};

/* Le thème « auto » doit suivre le système en cours de session. */
media.addEventListener('change', () => {
  if (current.theme === 'auto') applyPrefs();
});

// Premier rendu sur le cache : le shell rappellera hydratePrefs() dès que le
// serveur aura répondu.
current = readCache();
