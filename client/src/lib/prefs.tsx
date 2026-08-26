import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import { api } from '@/api/client';
import type { Preferences, ThemePref } from '@/api/types';
import { useToast } from '@/components/Toast';

/**
 * Préférences d'affichage — thème, teinte, densité, mouvement, barre latérale.
 *
 * Deux dépôts, un rôle chacun : le serveur porte la vérité (les réglages suivent
 * la personne d'un poste à l'autre), le localStorage n'est qu'un cache d'amorçage
 * lu par le script inline de `index.html`, avant le premier pixel. Sans ce cache,
 * chaque chargement afficherait un thème clair avant de basculer.
 */

const VALUES = {
  theme: ['auto', 'light', 'dark'],
  accent: ['azur', 'indigo', 'emeraude', 'ardoise', 'cuivre'],
  density: ['confort', 'compact'],
  motion: ['full', 'reduced'],
  sidebar: ['expanded', 'collapsed'],
} as const;

// « Auto » reste choisissable, mais un compte neuf démarre en clair : le thème
// système d'un poste ne dit rien de la préférence de son prochain titulaire,
// et un tableau de bord sombre au tout premier écran surprend plus qu'il ne
// rassure.
const DEFAULTS: Preferences = {
  theme: 'light', accent: 'azur', density: 'confort', motion: 'full', sidebar: 'expanded',
};

export const ACCENTS = [
  { value: 'azur', label: 'Azur', from: '#1a68d1', to: '#1354ac' },
  { value: 'indigo', label: 'Indigo', from: '#5045c8', to: '#413893' },
  { value: 'emeraude', label: 'Émeraude', from: '#0d7052', to: '#0a5b43' },
  { value: 'ardoise', label: 'Ardoise', from: '#3f556e', to: '#32445a' },
  { value: 'cuivre', label: 'Cuivre', from: '#9e4f26', to: '#83411f' },
] as const;

export const THEME_LABEL: Record<ThemePref, string> = {
  auto: 'Thème automatique', light: 'Thème clair', dark: 'Thème sombre',
};

const media = window.matchMedia('(prefers-color-scheme: dark)');

function sanitize(source: Partial<Record<keyof Preferences, string | null>>): Preferences {
  const clean = { ...DEFAULTS };
  for (const key of Object.keys(VALUES) as (keyof Preferences)[]) {
    const allowed = VALUES[key] as readonly string[];
    const candidate = source[key];
    if (candidate && allowed.includes(candidate)) {
      (clean as Record<string, string>)[key] = candidate;
    }
  }
  return clean;
}

function readCache(): Preferences {
  const cached: Partial<Record<keyof Preferences, string | null>> = {};
  for (const key of Object.keys(VALUES) as (keyof Preferences)[]) {
    try { cached[key] = localStorage.getItem(key); } catch { /* stockage refusé */ }
  }
  return sanitize(cached);
}

function writeCache(prefs: Preferences) {
  for (const [key, value] of Object.entries(prefs)) {
    try { localStorage.setItem(key, value); } catch { /* mode privé : le serveur suffit */ }
  }
}

function apply(prefs: Preferences) {
  const root = document.documentElement;
  root.dataset.theme = prefs.theme === 'auto' ? (media.matches ? 'dark' : 'light') : prefs.theme;
  root.dataset.themePref = prefs.theme;
  root.dataset.accent = prefs.accent;
  root.dataset.density = prefs.density;
  root.dataset.motion = prefs.motion;
  root.dataset.rail = prefs.sidebar === 'collapsed' ? '1' : '0';
}

interface PrefsContext {
  prefs: Preferences;
  setPrefs: (patch: Partial<Preferences>) => void;
  /** Réglages reçus du serveur : ils écrasent le cache local, qui peut appartenir
   *  à un autre compte utilisé sur le même navigateur. */
  hydrate: (serverPrefs: Preferences | null | undefined) => void;
  cycleTheme: () => ThemePref;
}

const Context = createContext<PrefsContext | null>(null);

export function usePrefs(): PrefsContext {
  const context = useContext(Context);
  if (!context) throw new Error('usePrefs doit être utilisé sous <PreferencesProvider>.');
  return context;
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [prefs, setState] = useState<Preferences>(() => {
    const initial = readCache();
    apply(initial);
    return initial;
  });
  const warned = useRef(false);

  // Le thème « auto » doit suivre le système en cours de session.
  useEffect(() => {
    const onSystemChange = () => { if (prefs.theme === 'auto') apply(prefs); };
    media.addEventListener('change', onSystemChange);
    return () => media.removeEventListener('change', onSystemChange);
  }, [prefs]);

  const setPrefs = useCallback((patch: Partial<Preferences>) => {
    setState(current => {
      const next = sanitize({ ...current, ...patch });
      const changed = (Object.keys(patch) as (keyof Preferences)[])
        .some(key => next[key] !== current[key]);
      if (!changed) return current;

      writeCache(next);
      apply(next);

      // Enregistrement en tâche de fond : un réglage d'affichage ne doit jamais
      // faire attendre. En cas d'échec l'écran reste correct — seule la
      // persistance d'un poste à l'autre est perdue, et on le dit une fois.
      api.put('/api/account/preferences', patch).catch(() => {
        if (warned.current) return;
        warned.current = true;
        toast('Préférences non enregistrées',
              'L’affichage est à jour sur ce poste, mais le serveur n’a pas pu être joint.',
              'warn');
      });

      return next;
    });
  }, [toast]);

  const hydrate = useCallback((serverPrefs: Preferences | null | undefined) => {
    const next = sanitize(serverPrefs ?? readCache());
    writeCache(next);
    apply(next);
    setState(next);
  }, []);

  const cycleTheme = useCallback((): ThemePref => {
    const order = VALUES.theme;
    const next = order[(order.indexOf(prefs.theme) + 1) % order.length];
    setPrefs({ theme: next });
    return next;
  }, [prefs.theme, setPrefs]);

  const value = useMemo<PrefsContext>(
    () => ({ prefs, setPrefs, hydrate, cycleTheme }),
    [prefs, setPrefs, hydrate, cycleTheme]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
