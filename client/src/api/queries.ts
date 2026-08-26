import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { ClientRow, DashboardWidgetSetting, Meta, Presence } from './types';

/**
 * Requêtes partagées par plusieurs écrans.
 *
 * Les clés sont préfixées par ressource : invalider `['clients']` suffit alors à
 * rafraîchir aussi bien la liste que la fiche, sans avoir à énumérer les clés
 * filles à chaque écriture.
 */

export const keys = {
  meta: ['meta'] as const,
  clients: ['clients'] as const,
  client: (id: number) => ['clients', id] as const,
  kb: ['kb'] as const,
  configs: ['configs'] as const,
  frameworks: ['frameworks'] as const,
  controls: ['controls'] as const,
  questionnaires: ['questionnaires'] as const,
  questionnaire: (id: number) => ['questionnaires', id] as const,
  stats: ['stats'] as const,
  storage: ['storage'] as const,
  users: ['users'] as const,
  audit: ['audit'] as const,
  presence: ['presence'] as const,
  settings: ['settings'] as const,
  dashboardLayout: ['settings', 'dashboard-layout'] as const,
};

/** Agencement du tableau de bord — commun à toute l'organisation, réglé par
 *  un administrateur. `staleTime` généreux : ce n'est pas une donnée qui
 *  change en cours de session normale, une réponse mise en cache ne se
 *  périme pas plus vite que la config elle-même. */
export function useDashboardLayout() {
  return useQuery({
    queryKey: keys.dashboardLayout,
    queryFn: () => api.get<DashboardWidgetSetting[]>('/api/settings/dashboard-layout'),
    staleTime: 5 * 60_000,
  });
}

/** Vocabulaire de référence : catégories, statuts, seuils de confiance.
 *  Il ne change qu'au redéploiement — inutile de le redemander. */
export function useMeta() {
  return useQuery({
    queryKey: keys.meta,
    queryFn: () => api.get<Meta>('/api/meta'),
    staleTime: Infinity,
  });
}

export function useClients() {
  return useQuery({
    queryKey: keys.clients,
    queryFn: () => api.get<ClientRow[]>('/api/clients'),
  });
}

/**
 * Qui est en ligne, sondé toutes les 30 secondes — il n'y a pas d'infrastructure
 * de push (pas de WebSocket) dans cette application, donc pas de vrai temps
 * réel ; l'écart perçu reste de l'ordre de quelques secondes.
 *
 * `refetchIntervalInBackground` reste à son défaut (faux) : un onglet réduit
 * n'a pas besoin de continuer à sonder, et il se remet à jour tout seul au
 * retour au premier plan grâce à `refetchOnWindowFocus`. Cet appel étant lui
 * -même authentifié, il rafraîchit au passage la présence de la personne qui
 * regarde l'écran — la présence sert donc aussi de battement de vie.
 *
 * C'est précisément pourquoi `paused` existe : chaque sondage repousse
 * l'échéance de session côté serveur. Laissé libre, il maintiendrait indéfiniment
 * connecté un poste que plus personne ne regarde, et la fermeture pour
 * inactivité ne se déclencherait jamais. Le sondage s'arrête donc dès que la
 * personne cesse d'interagir, et reprend à son premier geste.
 */
export function usePresence({ paused = false }: { paused?: boolean } = {}) {
  return useQuery({
    queryKey: keys.presence,
    queryFn: () => api.get<Presence>('/api/presence'),
    refetchInterval: paused ? false : 30_000,
    staleTime: 25_000,
    // Sinon le retour au premier plan relancerait un sondage alors même que la
    // fenêtre d'avertissement attend une décision.
    refetchOnWindowFocus: !paused,
  });
}

/**
 * Invalidation large après écriture : toucher une réponse de référence change
 * la couverture d'un client, les statistiques et la volumétrie. Recalculer trop
 * coûte un aller-retour local ; recalculer trop peu affiche un chiffre faux.
 */
export function useInvalidateAll() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of [keys.clients, keys.kb, keys.configs, keys.questionnaires,
                       keys.stats, keys.storage, keys.frameworks, keys.controls]) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };
}
