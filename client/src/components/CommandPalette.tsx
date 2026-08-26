import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';

import { Icon, type IconName } from './Icon';
import { useClients } from '@/api/queries';
import { usePrefs, THEME_LABEL } from '@/lib/prefs';
import type { AccountTab } from './AccountDrawer';

/**
 * Palette de commandes (Ctrl/⌘ + K) — aller n'importe où, lancer les gestes
 * courants, sans quitter le clavier.
 *
 * Elle navigue : pages, actions, et dossiers clients par leur nom. Chercher
 * *dans* les réponses reste le travail de l'assistant, qui appelle le moteur de
 * rapprochement — ici, on ne filtre que des libellés déjà connus.
 *
 * Les clients n'apparaissent qu'une fois quelque chose de saisi : à l'ouverture,
 * la liste doit répondre à « où puis-je aller », pas dérouler tout le fichier.
 */

interface Command {
  icon: IconName;
  label: string;
  sub?: string | (() => string);
  keywords?: string;
  adminOnly?: boolean;
  to?: string;
  run?: () => void | Promise<void>;
  /** La palette reste ouverte : ces commandes s'enchaînent volontiers — essayer
   *  les thèmes l'un après l'autre, par exemple. */
  keep?: boolean;
  /** Masquée tant que rien n'est saisi. Réservé à ce qui n'a pas sa place dans
   *  une liste d'accueil : une entrée trop spécifique, ou un doublon avec la
   *  recherche par nom qu'elle encombrerait. */
  onSearchOnly?: boolean;
}

interface CommandPaletteProps {
  isAdmin: boolean;
  onClose: () => void;
  onOpenSettings: (tab: AccountTab) => void;
  onLogout: () => void | Promise<void>;
}

/** Comparaison insensible à la casse ET aux accents : « referentiel » doit
 *  trouver « Référentiels », c'est la façon dont on tape vite. */
const fold = (value: string) =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function CommandPalette({ isAdmin, onClose, onOpenSettings, onLogout }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { prefs, setPrefs, cycleTheme } = usePrefs();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const groups = useMemo<{ title: string; items: Command[] }[]>(() => [
    {
      title: 'Pages',
      items: [
        { icon: 'home', label: 'Tableau de bord', sub: 'Vue d’ensemble', to: '/',
          keywords: 'accueil pilotage synthese couverture' },
        { icon: 'wand', label: 'Assistant réponse', sub: 'Poser une question à la base',
          to: '/assistant', keywords: 'chercher rapprochement moteur' },
        // Masquée à l'ouverture : la liste complète des clients n'est presque
        // jamais la destination voulue — on cherche un client précis, et le
        // groupe « Clients » plus bas y mène directement.
        { icon: 'users', label: 'Clients', sub: 'Dossiers et périmètres', to: '/clients',
          keywords: 'compagnies organismes dossiers liste tous', onSearchOnly: true },
        { icon: 'fileText', label: 'Questionnaires', sub: 'Traitement en cours',
          to: '/questionnaires', keywords: 'excel word pdf import televerser' },
        { icon: 'book', label: 'Base de connaissance', sub: 'Réponses de référence', to: '/kb',
          keywords: 'kb patrimoine reponses' },
        { icon: 'shieldCheck', label: 'Référentiels', sub: 'Contrôles et exigences',
          to: '/frameworks', keywords: 'iso 27001 nis2 dora controles' },
        { icon: 'database', label: 'Volumétrie', sub: 'Ce qui est stocké', to: '/storage',
          keywords: 'taille disque stockage base' },
        { icon: 'lock', label: 'Sécurité du compte', sub: 'Second facteur', to: '/security',
          keywords: 'mfa totp authentification codes' },
        { icon: 'users', label: 'Comptes', sub: 'Qui peut se connecter', to: '/users',
          adminOnly: true, keywords: 'utilisateurs droits administrateurs' },
        { icon: 'history', label: 'Journal d’audit', sub: 'Événements tracés', to: '/audit',
          adminOnly: true, keywords: 'logs traces evenements' },
      ],
    },
    {
      title: 'Actions',
      items: [
        { icon: 'upload', label: 'Traiter un questionnaire', sub: 'Téléverser un fichier',
          to: '/questionnaires', keywords: 'importer excel word pdf' },
        { icon: 'idCard', label: 'Ma fiche', sub: 'Nom, adresse, fonction',
          keywords: 'profil compte mail email courriel',
          run: () => onOpenSettings('profil') },
        { icon: 'lock', label: 'Connexion & sécurité', sub: 'Second facteur, mot de passe',
          keywords: 'mfa mot de passe totp', run: () => onOpenSettings('securite') },
        { icon: 'palette', label: 'Apparence', sub: 'Teinte, densité, animations',
          keywords: 'theme couleur densite compact', run: () => onOpenSettings('apparence') },
        { icon: 'devices', label: 'Appareils connectés', sub: 'Sessions ouvertes',
          keywords: 'sessions deconnecter appareils', run: () => onOpenSettings('sessions') },
        { icon: 'clock', label: 'Fermeture automatique des sessions',
          sub: 'Délai d’inactivité avant déconnexion',
          to: '/users#fermeture-sessions', adminOnly: true,
          keywords: 'timeout expiration inactivite delai session deconnexion automatique' },
        { icon: 'sun', label: 'Changer de thème', keywords: 'clair sombre auto nuit jour',
          sub: () => THEME_LABEL[prefs.theme], keep: true, run: () => { cycleTheme(); } },
        { icon: 'panelLeft', label: 'Réduire ou déployer le menu',
          keywords: 'barre laterale rail colonne', keep: true,
          run: () => setPrefs({
            sidebar: prefs.sidebar === 'collapsed' ? 'expanded' : 'collapsed',
          }) },
        { icon: 'logOut', label: 'Se déconnecter', keywords: 'quitter sortir logout',
          run: onLogout },
      ],
    },
  ], [prefs.theme, prefs.sidebar, cycleTheme, setPrefs, onOpenSettings, onLogout]);

  /** Les dossiers clients, cherchables par leur nom. La liste est déjà en cache
   *  dès qu'un écran l'a demandée ; la palette ne la recharge donc pas à chaque
   *  ouverture. */
  const { data: clients = [] } = useClients();

  const clientCommands = useMemo<Command[]>(() => clients.map(client => ({
    icon: 'users',
    label: client.name,
    sub: client.country ?? 'Dossier client',
    to: `/clients/${client.id}`,
    // Le statut est cherchable : « prospect » liste les dossiers en cours de
    // signature sans qu'on ait à se souvenir de leurs noms.
    keywords: `client dossier ${client.status} ${client.country ?? ''}`,
    onSearchOnly: true,
  })), [clients]);

  const visible = useMemo(() => {
    const tokens = fold(query).split(/\s+/).filter(Boolean);
    const flat: { group: string; command: Command }[] = [];

    const searchable: { title: string; items: Command[] }[] =
      [...groups, { title: 'Clients', items: clientCommands }];

    for (const group of searchable) {
      for (const command of group.items) {
        if (command.adminOnly && !isAdmin) continue;
        // Rien de saisi : on ne montre que les destinations d'usage courant.
        if (command.onSearchOnly && tokens.length === 0) continue;

        const sub = typeof command.sub === 'function' ? command.sub() : command.sub;
        const haystack = fold(`${command.label} ${sub ?? ''} ${command.keywords ?? ''}`);
        if (tokens.every(token => haystack.includes(token)))
          flat.push({ group: group.title, command });
      }
    }
    return flat;
  }, [groups, clientCommands, query, isAdmin]);

  useEffect(() => { setCursor(0); }, [query]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  useEffect(() => {
    listRef.current
      ?.querySelectorAll('.pal-item')[cursor]
      ?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const launch = async (entry: { command: Command } | undefined) => {
    if (!entry) return;
    const { command } = entry;
    if (!command.keep) onClose();
    if (command.to) navigate(command.to);
    else await command.run?.();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey)) {
      event.preventDefault();
      setCursor(current => (visible.length ? (current + 1) % visible.length : 0));
    } else if (event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)) {
      event.preventDefault();
      setCursor(current => (visible.length ? (current - 1 + visible.length) % visible.length : 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void launch(visible[cursor]);
    }
  };

  let lastGroup = '';

  return createPortal(
    <div className="pal-backdrop"
         onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Recherche rapide"
           onKeyDown={onKeyDown}>
        <div className="pal-head">
          <Icon name="search" />
          <input className="pal-input" ref={inputRef} type="text" autoComplete="off"
                 spellCheck={false} placeholder="Aller à une page, lancer une action…"
                 role="combobox" aria-expanded="true"
                 value={query} onChange={event => setQuery(event.target.value)} />
          <kbd>Échap</kbd>
        </div>

        <div className="pal-list" ref={listRef} role="listbox">
          {visible.length === 0 && (
            <p className="dim small" style={{ padding: '22px 12px', textAlign: 'center' }}>
              Aucune page, action ni client ne correspond à « {query} ».
            </p>
          )}
          {visible.map((entry, index) => {
            const header = entry.group !== lastGroup ? entry.group : null;
            lastGroup = entry.group;
            const sub = typeof entry.command.sub === 'function'
              ? entry.command.sub() : entry.command.sub;

            return (
              <div key={`${entry.group}-${entry.command.label}`}>
                {header && <p className="pal-group">{header}</p>}
                <button className="pal-item" role="option" type="button"
                        aria-selected={index === cursor}
                        onMouseMove={() => setCursor(index)}
                        onClick={() => void launch(entry)}>
                  <Icon name={entry.command.icon} />
                  <span className="pi-text">
                    {entry.command.label}
                    {sub && <span className="pi-sub">{sub}</span>}
                  </span>
                  <Icon name="arrowUpRight" className="pi-go" />
                </button>
              </div>
            );
          })}
        </div>

        <div className="pal-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> naviguer</span>
          <span><kbd>Entrée</kbd> ouvrir</span>
          <span><kbd>Ctrl</kbd><kbd>K</kbd> rappeler</span>
        </div>
      </div>
    </div>,
    document.body);
}
