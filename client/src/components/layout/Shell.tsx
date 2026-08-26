import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { api } from '@/api/client';
import { usePresence } from '@/api/queries';
import type { AuthStatus, ThemePref } from '@/api/types';
import { Icon, type IconName } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { usePrefs, THEME_LABEL } from '@/lib/prefs';
import { SESSION_KEY, useSession } from '@/lib/session';
import { initials } from '@/lib/format';
import { CommandPalette } from '@/components/CommandPalette';
import { AccountDrawer, type AccountTab } from '@/components/AccountDrawer';
import { IdleWarning } from '@/components/IdleWarning';
import { OnboardingTour } from '@/components/OnboardingTour';
import { useIdleTimeout } from '@/lib/useIdleTimeout';
import { useTooltips } from './useTooltips';

// --------------------------------------------------------------------------
// Fil d'Ariane et actions de la barre supérieure
//
// Les écrans déclarent ce qu'ils veulent y voir ; c'est la barre qui décide de
// ce qu'elle en montre. Le dernier maillon répète mot pour mot le <h1> de la
// page : on ne rend que ses ancêtres, qui portent une vraie navigation.
// --------------------------------------------------------------------------

export interface Crumb {
  label: string;
  to?: string;
}

interface PageMetaValue {
  setCrumb: (crumb: Crumb[]) => void;
  /** Nœud de la barre supérieure où les écrans projettent leurs boutons. */
  actionsHost: HTMLElement | null;
}

const PageMetaContext = createContext<PageMetaValue | null>(null);

interface PageMetaProps {
  crumb: Crumb[];
  actions?: ReactNode;
}

/**
 * À monter en tête de chaque écran.
 *
 * Le fil d'Ariane passe par un état, avec une dépendance sérialisée : le
 * tableau est reconstruit à chaque rendu, l'utiliser tel quel relancerait
 * l'effet indéfiniment.
 *
 * Les actions, elles, ne passent surtout pas par un état : ce sont des éléments
 * React neufs à chaque rendu, et les stocker relancerait un rendu qui les
 * recréerait, en boucle. Elles sont projetées par portail dans la barre — le
 * nœud cible ne change jamais, la boucle n'existe pas.
 */
export function PageMeta({ crumb, actions = null }: PageMetaProps) {
  const context = useContext(PageMetaContext);
  const setCrumb = context?.setCrumb;
  const signature = JSON.stringify(crumb);

  useEffect(() => {
    setCrumb?.(JSON.parse(signature) as Crumb[]);
  }, [signature, setCrumb]);

  if (!actions || !context?.actionsHost) return null;
  return createPortal(actions, context.actionsHost);
}

// --------------------------------------------------------------------------
// Navigation
// --------------------------------------------------------------------------

/** Même correspondance que le sélecteur « Thème » du panneau Apparence : les
 *  deux commandes règlent la même chose, elles doivent le montrer pareil. */
const THEME_ICON: Record<ThemePref, IconName> = {
  auto: 'monitor',
  light: 'sun',
  dark: 'moon',
};

interface NavEntry {
  to: string;
  label: string;
  icon: Parameters<typeof Icon>[0]['name'];
  adminOnly?: boolean;
}

const NAV_GROUPS: { title: string; items: NavEntry[] }[] = [
  {
    title: 'Pilotage',
    items: [
      { to: '/', label: 'Tableau de bord', icon: 'home' },
      { to: '/assistant', label: 'Assistant réponse', icon: 'wand' },
    ],
  },
  {
    title: 'Dossiers',
    items: [
      { to: '/clients', label: 'Clients', icon: 'users' },
      { to: '/questionnaires', label: 'Questionnaires', icon: 'fileText' },
    ],
  },
  {
    title: 'Patrimoine',
    items: [
      { to: '/kb', label: 'Base de connaissance', icon: 'book' },
      { to: '/frameworks', label: 'Référentiels', icon: 'shieldCheck' },
      { to: '/storage', label: 'Volumétrie', icon: 'database' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { to: '/users', label: 'Comptes', icon: 'users', adminOnly: true },
      { to: '/audit', label: 'Journal d’audit', icon: 'history', adminOnly: true },
    ],
  },
];

export function Shell() {
  const { status, refresh } = useSession();
  const { prefs, setPrefs, cycleTheme } = usePrefs();
  const toast = useToast();
  const location = useLocation();
  const queryClient = useQueryClient();

  const [crumb, setCrumb] = useState<Crumb[]>([]);
  // État et non ref : le portail des actions doit se remonter une fois le nœud
  // réellement créé, ce qu'une ref ne signalerait pas.
  const [actionsHost, setActionsHost] = useState<HTMLDivElement | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<AccountTab>('profil');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [presenceOpen, setPresenceOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const presenceRef = useRef<HTMLDivElement>(null);

  useTooltips();

  const pageMeta = useMemo<PageMetaValue>(() => ({ setCrumb, actionsHost }), [actionsHost]);

  // Un changement de page ferme tout ce qui flotte : un menu resté ouvert
  // au-dessus de la nouvelle vue donne l'impression d'un écran figé.
  useEffect(() => {
    setMenuOpen(false);
    setPresenceOpen(false);
    setSidebarOpen(false);
    window.scrollTo({ top: 0 });
  }, [location.pathname, location.search]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    // Différé : le clic qui vient d'ouvrir ne doit pas refermer aussitôt.
    const timer = window.setTimeout(
      () => document.addEventListener('pointerdown', onPointer, true), 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!presenceOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!presenceRef.current?.contains(event.target as Node)) setPresenceOpen(false);
    };
    const timer = window.setTimeout(
      () => document.addEventListener('pointerdown', onPointer, true), 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, [presenceOpen]);

  const openDrawer = useCallback((tab: AccountTab = 'profil') => {
    setDrawerTab(tab);
    setDrawerOpen(true);
    setMenuOpen(false);
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/api/auth/logout'); } catch { /* on se déconnecte quand même */ }

    // Purge les données métier, mais PAS le statut de session.
    //
    // `queryClient.clear()` retirerait aussi cette requête-là du cache, et son
    // observateur — toujours monté — se retrouverait orphelin : il resterait
    // « en cours » sans jamais se relancer, et l'écran tournerait indéfiniment
    // jusqu'à ce qu'on recharge la page à la main.
    queryClient.removeQueries({ predicate: query => query.queryKey[0] !== 'auth' });

    // On sait déjà ce que le serveur répondrait : on l'écrit. L'écran de
    // connexion apparaît immédiatement, sans aller-retour ni temps mort.
    queryClient.setQueryData<AuthStatus>(SESSION_KEY, current =>
      current && {
        ...current,
        authenticated: false, mfaPending: false,
        userId: null, username: null, isAdmin: false,
      });
  }, [queryClient]);

  // Déconnexion pour inactivité. Le serveur a déjà fermé la session de son
  // côté ; l'appel à /logout ne fait que nettoyer le cookie, et le message
  // explique pourquoi l'écran de connexion réapparaît — sans lui, la coupure
  // passerait pour une panne.
  const logoutIdle = useCallback(async () => {
    await logout();
    toast('Session fermée après une période d’inactivité.');
  }, [logout, toast]);

  const { secondsLeft, idle, markActive } = useIdleTimeout({
    timeoutMinutes: status?.idleTimeoutMinutes ?? 0,
    enabled: Boolean(status?.authenticated),
    onExpire: logoutIdle,
  });

  // Déclaré après le hook d'inactivité, dont il consomme l'état : le sondage
  // de présence est lui-même une requête authentifiée, et laissé libre il
  // repousserait indéfiniment l'échéance de session.
  const { data: presence } = usePresence({ paused: idle });

  // « Rester connecté » doit atteindre le serveur : remettre le seul compteur
  // local à zéro laisserait croire la session rouverte alors qu'elle expire
  // au même instant côté serveur. Cet appel authentifié repousse l'échéance ;
  // s'il échoue, c'est que la session est déjà close et l'écran doit le dire.
  const stayConnected = useCallback(async () => {
    markActive();
    try {
      await api.get('/api/auth/status');
    } catch {
      await logoutIdle();
    }
  }, [markActive, logoutIdle]);

  // Fermée en local dès le premier geste : attendre la confirmation serveur
  // avant de retirer la visite laisserait l'écran figé le temps de l'aller-
  // retour. Si l'enregistrement échoue, la visite reviendra à la connexion
  // suivante — sans dommage, ce n'est pas un état qui doit à tout prix tenir.
  const [tourDismissed, setTourDismissed] = useState(false);
  const showTour = Boolean(status?.authenticated) && status?.onboarded === false && !tourDismissed;

  const finishTour = useCallback(() => {
    setTourDismissed(true);
    api.post('/api/account/onboarded').then(refresh).catch(() => {});
  }, [refresh]);

  if (!status) return null;

  const isAdmin = status.isAdmin;
  const mark = initials(status.fullName, status.username);
  const role = isAdmin ? 'Administrateur' : 'Membre';
  const lowCodes = status.mfaEnabled && status.recoveryCodesRemaining <= 2;
  const collapsed = prefs.sidebar === 'collapsed';

  return (
    <PageMetaContext.Provider value={pageMeta}>
      <div className="app">
        <div className="scrim" hidden={!sidebarOpen} onClick={() => setSidebarOpen(false)} />

        {/* ============================ Barre latérale ============================ */}
        <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
          <div className="side-head">
            <Link className="brand" to="/" data-tip="Cyberjet Compliance">
              <span className="brand-mark">
                {/* Version blanche : la barre latérale est sombre dans les deux thèmes. */}
                <img src="/cyberjet-logo-white.png" alt="" />
              </span>
              <span className="brand-text">
                <strong>Cyberjet</strong>
                <small>Compliance</small>
              </span>
            </Link>
            {/* Ce bouton n'a d'étiquette visible ni déployé ni réduit : son
                info-bulle doit s'afficher dans les deux états. */}
            <button className="rail-toggle" type="button"
                    data-tip={collapsed ? 'Déployer le menu' : 'Réduire le menu'}
                    data-tip-always=""
                    aria-label={collapsed ? 'Déployer le menu' : 'Réduire le menu'}
                    aria-pressed={collapsed}
                    onClick={() => setPrefs({ sidebar: collapsed ? 'expanded' : 'collapsed' })}>
              <svg viewBox="0 0 24 24"><path d="m14 7-5 5 5 5" /></svg>
            </button>
          </div>

          <button className="side-search" type="button" data-tip="Recherche rapide"
                  data-tour="search" onClick={() => setPaletteOpen(true)}>
            <Icon name="search" />
            <span className="ss-label">Rechercher…</span>
            <kbd className="ss-kbd">Ctrl K</kbd>
          </button>

          <nav className="nav" data-tour="nav">
            {NAV_GROUPS.map(group => {
              const items = group.items.filter(item => !item.adminOnly || isAdmin);
              if (!items.length) return null;
              return (
                <div key={group.title}>
                  <p className="nav-label">{group.title}</p>
                  {items.map(item => (
                    <NavLink key={item.to} to={item.to} end={item.to === '/'}
                             className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                             data-tip={item.label}
                             data-tour={item.to === '/assistant' ? 'assistant'
                                      : item.to === '/questionnaires' ? 'questionnaires'
                                      : undefined}>
                      <Icon name={item.icon} />
                      <span className="ni-label">{item.label}</span>
                    </NavLink>
                  ))}
                </div>
              );
            })}
          </nav>
        </aside>

        {/* ================================ Contenu =============================== */}
        <div className="main">
          <header className="topbar">
            <button className="icon-btn burger" type="button" aria-label="Ouvrir le menu"
                    onClick={() => setSidebarOpen(open => !open)}>
              <svg viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
            </button>

            <div className="crumb">
              {crumb.slice(0, -1).map((part, index) => (
                <span key={`${part.label}-${index}`}>
                  {index > 0 && <span className="sep">/</span>}
                  {part.to ? <Link to={part.to}>{part.label}</Link> : <b>{part.label}</b>}
                </span>
              ))}
            </div>

            <div className="topbar-actions" ref={setActionsHost} />

            <div className="topbar-tools">
              <button className="icon-btn" type="button" aria-label="Recherche rapide"
                      data-tip="Recherche rapide · Ctrl K" onClick={() => setPaletteOpen(true)}>
                <Icon name="search" />
              </button>

              {/* L'icône suit la PRÉFÉRENCE, pas le thème résolu, et reprend
                  celles du panneau « Apparence » : écran pour automatique,
                  soleil pour clair, lune pour sombre. Afficher un soleil parce
                  que le système est en clair alors que le réglage est sur
                  « automatique » contredisait l'info-bulle juste à côté. */}
              <button className="icon-btn" type="button" aria-label="Changer de thème"
                      data-tip={THEME_LABEL[prefs.theme]}
                      onClick={() => toast(THEME_LABEL[cycleTheme()], '', 'info', 1500)}>
                <Icon name={THEME_ICON[prefs.theme]} />
              </button>

              <button className="icon-btn" type="button" aria-label="Paramètres du compte"
                      data-tip="Paramètres" onClick={() => openDrawer('profil')}>
                <Icon name="settings" />
                {/* Incitation permanente au second facteur, jamais bloquante. */}
                <span className="tool-alert" hidden={status.mfaEnabled && !lowCodes}
                      title={lowCodes
                        ? `Plus que ${status.recoveryCodesRemaining} code(s) de récupération`
                        : 'Vérification en deux étapes non activée'} />
              </button>

              {presence && (
                <div className="user-menu" ref={presenceRef}>
                  <button className={`presence-btn${presenceOpen ? ' on' : ''}${presence.count === 0 ? ' empty' : ''}`}
                          type="button" aria-expanded={presenceOpen} aria-haspopup="true"
                          data-tip={`${presence.count} ${presence.count > 1 ? 'connectés' : 'connecté'}`}
                          onClick={() => setPresenceOpen(open => !open)}>
                    <span className="presence-dot" />
                    {presence.count}
                  </button>

                  <div className="menu presence-menu" hidden={!presenceOpen}>
                    {presence.users.length === 0 ? (
                      <p className="presence-empty dim small">Personne d’autre en ligne</p>
                    ) : presence.users.map(user => (
                      <div className="presence-row" key={user.userId}>
                        <span className="avatar sm">{initials(user.fullName, user.username)}</span>
                        <span className="name">{user.fullName || user.username}</span>
                        {user.isSelf && <span className="you">Vous</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="tool-sep" />

              <div className="user-menu" ref={menuRef} data-tour="account">
                <button className={`user-chip${menuOpen ? ' on' : ''}`} type="button"
                        aria-expanded={menuOpen} aria-haspopup="true"
                        onClick={() => setMenuOpen(open => !open)}>
                  <span className="avatar">{mark}</span>
                  <span className="uc-text">
                    <b>{status.fullName || status.username}</b>
                    <small>{role}</small>
                  </span>
                  <svg className="uc-caret" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>
                </button>

                <div className="menu menu-user" hidden={!menuOpen}>
                  <div className="menu-id">
                    <div className="mi-row">
                      <span className="avatar lg">{mark}</span>
                      <div className="mi-text">
                        <b>{status.fullName || status.username}</b>
                        <small className={status.email ? '' : 'dim'}>
                          {status.email || 'Aucune adresse associée'}
                        </small>
                      </div>
                    </div>
                    {/* Hors de la ligne avatar + nom/e-mail : un badge se lit comme
                        une étiquette, pas comme une troisième ligne de texte. Le
                        laisser dans le même bloc décalait le centrage de l'avatar
                        vers le bas, puisqu'il devait alors se répartir sur les
                        trois éléments au lieu des deux seuls qui comptent. */}
                    <span className={`badge ${isAdmin ? 'accent' : ''} mi-badge`}>{role}</span>
                  </div>

                  <div className="menu-sep" />

                  <button className="menu-item" type="button" onClick={() => openDrawer('profil')}>
                    <Icon name="idCard" /><span>Ma fiche</span>
                  </button>
                  <button className="menu-item" type="button" onClick={() => openDrawer('securite')}>
                    <Icon name="lock" /><span>Connexion &amp; sécurité</span>
                    <span className={`mi-state ${status.mfaEnabled && !lowCodes ? 'ok' : 'warn'}`}>
                      {status.mfaEnabled ? (lowCodes ? 'Codes à refaire' : 'Protégé') : 'À activer'}
                    </span>
                  </button>
                  <button className="menu-item" type="button" onClick={() => openDrawer('apparence')}>
                    <Icon name="palette" /><span>Apparence</span>
                  </button>
                  <button className="menu-item" type="button" onClick={() => openDrawer('sessions')}>
                    <Icon name="devices" /><span>Appareils connectés</span>
                  </button>

                  <div className="menu-sep" />

                  <button className="menu-item danger" type="button" onClick={logout}>
                    <Icon name="logOut" /><span>Se déconnecter</span>
                  </button>
                </div>
              </div>
            </div>
          </header>

          <main className="view enter">
            <Outlet />
          </main>
        </div>
      </div>

      {paletteOpen && (
        <CommandPalette
          isAdmin={isAdmin}
          onClose={() => setPaletteOpen(false)}
          onOpenSettings={openDrawer}
          onLogout={logout} />
      )}

      {drawerOpen && (
        <AccountDrawer initialTab={drawerTab} onClose={() => setDrawerOpen(false)} />
      )}

      {secondsLeft !== null && (
        <IdleWarning
          secondsLeft={secondsLeft}
          onStay={stayConnected}
          onLogout={logout} />
      )}

      {showTour && <OnboardingTour onDone={finishTour} />}
    </PageMetaContext.Provider>
  );
}
