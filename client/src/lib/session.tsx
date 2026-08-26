import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { AuthStatus } from '@/api/types';
import { usePrefs } from './prefs';

/**
 * Session courante.
 *
 * Un seul appel à `/api/auth/status` fait autorité : il porte à la fois l'état
 * d'authentification, la fiche du compte affichée dans la barre supérieure, et
 * les préférences d'affichage. Les regrouper évite trois allers-retours au
 * chargement — et l'avatar qui apparaît après le reste.
 */

export const SESSION_KEY = ['auth', 'status'] as const;

interface SessionContext {
  status: AuthStatus | undefined;
  isLoading: boolean;
  /** Recharge le statut : appelée après toute opération qui touche au compte
   *  (fiche, second facteur, codes de récupération). */
  refresh: () => Promise<void>;
}

const Context = createContext<SessionContext | null>(null);

export function useSession(): SessionContext {
  const context = useContext(Context);
  if (!context) throw new Error('useSession doit être utilisé sous <SessionProvider>.');
  return context;
}

/** Raccourci pour les écrans qui ne s'affichent que connecté. */
export function useCurrentUser(): AuthStatus {
  const { status } = useSession();
  if (!status?.authenticated) throw new Error('Écran atteint hors session.');
  return status;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { hydrate } = usePrefs();

  const query = useQuery({
    queryKey: SESSION_KEY,
    queryFn: () => api.get<AuthStatus>('/api/auth/status'),
    staleTime: 30_000,
    retry: false,
  });

  const preferences = query.data?.preferences;
  useEffect(() => {
    if (preferences) hydrate(preferences);
  }, [preferences, hydrate]);

  const value = useMemo<SessionContext>(() => ({
    status: query.data,
    isLoading: query.isLoading,
    refresh: async () => { await queryClient.invalidateQueries({ queryKey: SESSION_KEY }); },
  }), [query.data, query.isLoading, queryClient]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
