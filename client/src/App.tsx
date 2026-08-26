import { useEffect } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { setSessionLostHandler } from '@/api/client';
import { ToastProvider } from '@/components/Toast';
import { DialogProvider } from '@/components/Dialogs';
import { PreferencesProvider } from '@/lib/prefs';
import { SESSION_KEY, SessionProvider, useSession } from '@/lib/session';
import { Shell } from '@/components/layout/Shell';
import { Loader } from '@/components/Ui';

import { LoginPage } from '@/pages/Login';
import { DashboardPage } from '@/pages/Dashboard';
import { AssistantPage } from '@/pages/Assistant';
import { ClientsPage } from '@/pages/Clients';
import { ClientDetailPage } from '@/pages/ClientDetail';
import { KnowledgePage } from '@/pages/Knowledge';
import { QuestionnairesPage } from '@/pages/Questionnaires';
import { QuestionnaireDetailPage } from '@/pages/QuestionnaireDetail';
import { FrameworksPage } from '@/pages/Frameworks';
import { StoragePage } from '@/pages/Storage';
import { UsersPage } from '@/pages/Users';
import { SecurityPage } from '@/pages/Security';
import { AuditPage } from '@/pages/Audit';

/**
 * Le cache par défaut de React Query remplace le cache maison de l'ancienne
 * version : durée de fraîcheur courte, pas de rechargement au retour sur
 * l'onglet mais un rechargement à la reconnexion réseau, et aucune tentative
 * répétée — une API locale qui échoue ne réussira pas mieux au troisième essai.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: false,
      refetchOnWindowFocus: true,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <PreferencesProvider>
            <DialogProvider>
              <SessionProvider>
                <SessionGate />
              </SessionProvider>
            </DialogProvider>
          </PreferencesProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

/**
 * Aiguillage entre l'écran de connexion et l'application. Le shell n'est jamais
 * monté sans session : les écrans peuvent donc supposer un compte connecté au
 * lieu de tester `status?.authenticated` à chaque ligne.
 */
function SessionGate() {
  const { status, isLoading } = useSession();
  const client = useQueryClient();

  // Session expirée, ou révoquée à distance — changement de mot de passe,
  // déconnexion des autres appareils, compte désactivé.
  //
  // On vide le cache (des données d'un autre compte ne doivent pas rester à
  // l'écran) puis on redemande le statut. C'est lui qui décide : dès qu'il
  // revient « non authentifié », le garde ci-dessous rend l'écran de connexion.
  //
  // Naviguer vers /login ne suffirait pas : tant que le statut en cache dit
  // « connecté », la route /login renvoie vers l'accueil, et on tourne en rond.
  useEffect(() => {
    setSessionLostHandler(() => {
      // On retire les données métier mais on garde la requête de session : la
      // vider détacherait son observateur, qui resterait « en cours » sans
      // jamais se relancer — écran de chargement perpétuel.
      client.removeQueries({ predicate: query => query.queryKey[0] !== 'auth' });
      void client.refetchQueries({ queryKey: SESSION_KEY });
    });
  }, [client]);

  if (isLoading) return <Loader />;

  if (!status?.authenticated) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<Shell />}>
        <Route index element={<DashboardPage />} />
        <Route path="assistant" element={<AssistantPage />} />
        <Route path="clients" element={<ClientsPage />} />
        <Route path="clients/:clientId" element={<ClientDetailPage />} />
        <Route path="kb" element={<KnowledgePage />} />
        <Route path="questionnaires" element={<QuestionnairesPage />} />
        <Route path="questionnaires/:questionnaireId" element={<QuestionnaireDetailPage />} />
        <Route path="frameworks" element={<FrameworksPage />} />
        <Route path="storage" element={<StoragePage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="security" element={<SecurityPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

function NotFound() {
  return (
    <div className="empty">
      <h3>Page introuvable</h3>
      <p>Le lien demandé n’existe pas.</p>
      <a className="btn primary" href="/">Retour au tableau de bord</a>
    </div>
  );
}
