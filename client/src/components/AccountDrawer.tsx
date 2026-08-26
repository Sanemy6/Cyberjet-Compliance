import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { api } from '@/api/client';
import type { Account } from '@/api/types';
import { Icon, type IconName } from './Icon';
import { Modal } from './Modal';
import { BusyButton, Loader, Segmented } from './Ui';
import { MfaDialogs, PasswordPrompt, type MfaAction } from './Mfa';
import { useToast } from './Toast';
import { useSession } from '@/lib/session';
import { ACCENTS, usePrefs } from '@/lib/prefs';
import { fmtDate, fmtRelative, initials, plural } from '@/lib/format';

export type AccountTab = 'profil' | 'securite' | 'apparence' | 'sessions';

const TABS: { id: AccountTab; label: string; icon: IconName }[] = [
  { id: 'profil', label: 'Ma fiche', icon: 'idCard' },
  { id: 'securite', label: 'Connexion & sécurité', icon: 'lock' },
  { id: 'apparence', label: 'Apparence', icon: 'palette' },
  { id: 'sessions', label: 'Appareils connectés', icon: 'devices' },
];

const ACCOUNT_KEY = ['account'] as const;

/**
 * Panneau du compte — un seul endroit pour tout ce qui concerne la personne
 * connectée. Le panneau latéral est préféré à une modale : on y vient pour
 * parcourir et ajuster plusieurs onglets, pas pour répondre à une question
 * fermée.
 */
export function AccountDrawer({ initialTab, onClose }: {
  initialTab: AccountTab;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<AccountTab>(initialTab);
  const [closing, setClosing] = useState(false);

  // L'animation de sortie doit se voir : démonter d'un coup donne l'impression
  // d'un panneau qui disparaît par accident.
  const dismiss = useCallback(() => {
    setClosing(true);
    window.setTimeout(onClose, 180);
  }, [onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [dismiss]);

  return createPortal(
    <div className={`drawer-backdrop${closing ? ' closing' : ''}`}
         onMouseDown={event => { if (event.target === event.currentTarget) dismiss(); }}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Mon compte">
        <header className="drawer-head">
          <div className="grow">
            <h2>Mon compte</h2>
            <p className="sub">Fiche, connexion et préférences d’affichage</p>
          </div>
          <button className="icon-btn" aria-label="Fermer" onClick={dismiss}>
            <Icon name="x" />
          </button>
        </header>

        <div className="drawer-main">
          <nav className="drawer-tabs" role="tablist">
            {TABS.map(entry => (
              <button key={entry.id} className={`drawer-tab${tab === entry.id ? ' active' : ''}`}
                      role="tab" aria-selected={tab === entry.id}
                      onClick={() => setTab(entry.id)}>
                <Icon name={entry.icon} /><span>{entry.label}</span>
              </button>
            ))}
          </nav>

          <div className="drawer-panel" role="tabpanel">
            {tab === 'profil' && <ProfileTab />}
            {tab === 'securite' && <SecurityTab onLeave={dismiss} />}
            {tab === 'apparence' && <AppearanceTab />}
            {tab === 'sessions' && <SessionsTab />}
          </div>
        </div>
      </aside>
    </div>,
    document.body);
}

function useAccount() {
  return useQuery({
    queryKey: ACCOUNT_KEY,
    queryFn: () => api.get<Account>('/api/account'),
    staleTime: 5_000,
  });
}

// --------------------------------------------------------------------------
// Ma fiche
// --------------------------------------------------------------------------

function ProfileTab() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { refresh } = useSession();
  const { data: account, isLoading } = useAccount();

  const [form, setForm] = useState({
    firstName: '', lastName: '', jobTitle: '', email: '', phone: '',
  });

  useEffect(() => {
    if (!account) return;
    setForm({
      firstName: account.firstName ?? '',
      lastName: account.lastName ?? '',
      jobTitle: account.jobTitle ?? '',
      email: account.email ?? '',
      phone: account.phone ?? '',
    });
  }, [account]);

  if (isLoading || !account) return <Loader />;

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      setForm(current => ({ ...current, [key]: event.target.value })),
  });

  const save = async () => {
    try {
      await api.patch('/api/account', form);
      await queryClient.invalidateQueries({ queryKey: ACCOUNT_KEY });
      // La barre supérieure porte le nom et l'avatar : elle doit suivre
      // immédiatement, sans attendre un rechargement de page.
      await refresh();
      toast('Fiche enregistrée', '', 'ok');
    } catch (error) {
      toast('Enregistrement impossible', (error as Error).message, 'error');
    }
  };

  return (
    <>
      <div className="id-banner">
        <span className="avatar">{initials(account.fullName, account.username)}</span>
        <div className="ib-text">
          <b>{account.fullName || account.username}</b>
          <small>
            {account.jobTitle || (account.isAdmin ? 'Administrateur' : 'Membre')}
            {' · compte créé le '}{fmtDate(account.createdAt)}
          </small>
        </div>
      </div>

      <p className="muted small mt-2 mb-2">
        Ces informations servent à savoir qui contacter au sein de l’équipe. Elles ne sont
        utilisées ni pour se connecter, ni pour envoyer quoi que ce soit : l’application
        n’émet ni courriel ni SMS.
      </p>

      <div className="grid cols-2" style={{ gap: 15 }}>
        <IconField id="ac-first" label="Prénom" icon="user">
          <input className="input" id="ac-first" maxLength={80} autoComplete="given-name"
                 placeholder="Camille" {...field('firstName')} />
        </IconField>
        <IconField id="ac-last" label="Nom" icon="user">
          <input className="input" id="ac-last" maxLength={80} autoComplete="family-name"
                 placeholder="Martin" {...field('lastName')} />
        </IconField>
        <IconField id="ac-job" label="Intitulé de poste" icon="briefcase">
          <input className="input" id="ac-job" maxLength={120} autoComplete="organization-title"
                 placeholder="RSSI" {...field('jobTitle')} />
        </IconField>
        <IconField id="ac-mail" label="Adresse électronique" icon="mail">
          <input className="input" id="ac-mail" type="email" maxLength={200} autoComplete="email"
                 placeholder="prenom.nom@exemple.fr" {...field('email')} />
        </IconField>
        <IconField id="ac-phone" label="Téléphone" icon="phone">
          <input className="input" id="ac-phone" type="tel" maxLength={40} autoComplete="tel"
                 placeholder="+33 6 12 34 56 78" {...field('phone')} />
        </IconField>
      </div>

      <p className="help mt-2">Tous ces champs sont facultatifs : laisser vide n’associe rien.</p>

      <div className="flex between mt-3" style={{ gap: 12, flexWrap: 'wrap' }}>
        <span className="dim small">
          {account.lastLoginAt
            ? `Dernière connexion ${fmtRelative(account.lastLoginAt)}`
            : 'Première session'}
        </span>
        <BusyButton className="btn primary" onClick={save}>
          <Icon name="save" />Enregistrer la fiche
        </BusyButton>
      </div>
    </>
  );
}

function IconField({ id, label, icon, children }: {
  id: string; label: string; icon: IconName; children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="input-ico"><Icon name={icon} />{children}</div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Connexion & sécurité
// --------------------------------------------------------------------------

function SecurityTab({ onLeave }: { onLeave: () => void }) {
  const queryClient = useQueryClient();
  const { data: account, isLoading } = useAccount();
  const [mfaAction, setMfaAction] = useState<MfaAction>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);

  if (isLoading || !account) return <Loader />;

  const { mfaEnabled, recoveryCodesRemaining: remaining } = account;
  const low = mfaEnabled && remaining <= 2;
  const reload = () => { void queryClient.invalidateQueries({ queryKey: ACCOUNT_KEY }); };

  return (
    <>
      <div className={`callout ${mfaEnabled && !low ? 'ok' : 'warn'}`}>
        <Icon name={mfaEnabled && !low ? 'shieldCheck' : 'alert'} />
        <div>
          <p><b>
            {mfaEnabled
              ? (low
                ? `Second facteur actif, mais plus que ${remaining} ${plural(remaining, 'code')} de récupération`
                : 'Ce compte est protégé par une vérification en deux étapes')
              : 'Ce compte n’est protégé que par son mot de passe'}
          </b></p>
          <p className="muted small mt-1">
            {mfaEnabled
              ? 'Un code temporaire vous est demandé à chaque nouvelle connexion.'
              : 'Un mot de passe volé suffirait à entrer. La vérification en deux étapes ajoute un code généré par votre téléphone, hors ligne.'}
          </p>
        </div>
      </div>

      <div className="setting mt-2">
        <div className="setting-text">
          <b>Vérification en deux étapes</b>
          <p>
            {mfaEnabled
              ? `Application d’authentification associée${account.mfaEnabledAt ? ` le ${fmtDate(account.mfaEnabledAt)}` : ''}. `
                + `${remaining} ${plural(remaining, 'code')} de récupération ${plural(remaining, 'restant')}.`
              : 'Vous décidez de l’activer : rien ne vous y oblige, mais c’est vivement recommandé pour un outil qui contient les configurations de sécurité de vos clients.'}
          </p>
        </div>
        <div className="setting-control flex" style={{ gap: 8, flexWrap: 'wrap' }}>
          {mfaEnabled ? (
            <>
              <button className="btn" onClick={() => setMfaAction('regenerate')}>
                <Icon name="refresh" />Nouveaux codes
              </button>
              <button className="btn danger" onClick={() => setMfaAction('disable')}>
                <Icon name="slash" />Désactiver
              </button>
            </>
          ) : (
            <button className="btn primary" onClick={() => setMfaAction('enroll')}>
              <Icon name="lock" />Activer
            </button>
          )}
        </div>
      </div>

      <div className="setting">
        <div className="setting-text">
          <b>Mot de passe</b>
          <p>
            Le mot de passe actuel est demandé, et vos autres sessions sont fermées :
            un accès resté ouvert ailleurs ne doit pas survivre au changement.
          </p>
        </div>
        <div className="setting-control">
          <button className="btn" onClick={() => setPasswordOpen(true)}>
            <Icon name="key" />Changer le mot de passe
          </button>
        </div>
      </div>

      <div className="setting">
        <div className="setting-text">
          <b>Détail et méthodes disponibles</b>
          <p>Applications compatibles, codes de récupération, clés d’accès.</p>
        </div>
        <div className="setting-control">
          <Link className="btn ghost" to="/security" onClick={onLeave}>
            Ouvrir la page Sécurité <Icon name="chevronRight" />
          </Link>
        </div>
      </div>

      <MfaDialogs action={mfaAction} onClose={() => setMfaAction(null)} onDone={reload} />
      {passwordOpen && (
        <PasswordChangeDialog onClose={() => setPasswordOpen(false)} onDone={reload} />
      )}
    </>
  );
}

/** Saisie en double du nouveau mot de passe : elle évite d'enfermer quelqu'un
 *  dehors sur une faute de frappe. */
function PasswordChangeDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');

  const mismatch = repeat.length > 0 && repeat !== next;

  const submit = async () => {
    if (next.length < 8) {
      toast('Mot de passe trop court', '8 caractères minimum.', 'warn');
      return;
    }
    if (next !== repeat) return;

    try {
      const result = await api.post<{ revokedSessions: number }>(
        '/api/account/password', { currentPassword: current, newPassword: next });
      toast('Mot de passe changé',
            result.revokedSessions
              ? `${result.revokedSessions} autre(s) session(s) fermée(s).`
              : 'Aucune autre session n’était ouverte.',
            'ok');
      onClose();
      onDone();
    } catch (error) {
      toast('Changement refusé', (error as Error).message, 'error');
      setCurrent('');
    }
  };

  return (
    <Modal title="Changer le mot de passe" sub="Vos autres sessions seront fermées"
           onClose={onClose}
           footer={
             <>
               <button className="btn" onClick={onClose}>Annuler</button>
               <BusyButton className="btn primary" onClick={submit}>
                 <Icon name="save" />Changer le mot de passe
               </BusyButton>
             </>
           }>
      <div className="field">
        <label htmlFor="pw-old">Mot de passe actuel</label>
        <input className="input" id="pw-old" type="password" autoComplete="current-password"
               value={current} onChange={event => setCurrent(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="pw-new">Nouveau mot de passe</label>
        <input className="input" id="pw-new" type="password" autoComplete="new-password"
               minLength={8} value={next} onChange={event => setNext(event.target.value)} />
        <span className="help">
          8 caractères minimum. Une phrase longue vaut mieux qu’un mot court et tordu.
        </span>
      </div>
      <div className="field">
        <label htmlFor="pw-rep">Confirmer le nouveau mot de passe</label>
        <input className="input" id="pw-rep" type="password" autoComplete="new-password"
               value={repeat} onChange={event => setRepeat(event.target.value)} />
        {mismatch && <span className="err">Les deux saisies diffèrent.</span>}
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------------------
// Apparence
//
// Seul onglet à ne rien demander au serveur pour s'afficher : les préférences
// sont déjà en mémoire, et chaque réglage s'applique immédiatement.
// --------------------------------------------------------------------------

function AppearanceTab() {
  const { prefs, setPrefs } = usePrefs();

  return (
    <>
      <p className="muted small mb-2">
        Ces réglages sont enregistrés sur votre compte : vous les retrouverez sur
        n’importe quel poste, sans les refaire.
      </p>

      <div className="setting">
        <div className="setting-text">
          <b>Thème</b>
          <p>« Automatique » suit le réglage clair/sombre de votre système d’exploitation.</p>
        </div>
        <div className="setting-control">
          <Segmented value={prefs.theme} onChange={theme => setPrefs({ theme })}
                     options={[
                       { value: 'auto', label: 'Auto', icon: 'monitor' },
                       { value: 'light', label: 'Clair', icon: 'sun' },
                       { value: 'dark', label: 'Sombre', icon: 'moon' },
                     ]} />
        </div>
      </div>

      <div className="setting">
        <div className="setting-text">
          <b>Teinte de l’interface</b>
          <p>
            Boutons, liens et éléments actifs. Les couleurs des graphiques ne changent pas :
            une valeur ne doit pas changer de sens parce qu’on a changé de teinte.
          </p>
        </div>
        <div className="setting-control">
          <div className="swatches">
            {ACCENTS.map(accent => (
              <button type="button" key={accent.value} title={accent.label}
                      aria-label={accent.label}
                      aria-pressed={accent.value === prefs.accent}
                      className={`swatch${accent.value === prefs.accent ? ' active' : ''}`}
                      style={{ '--sw-1': accent.from, '--sw-2': accent.to } as React.CSSProperties}
                      onClick={() => setPrefs({ accent: accent.value })}>
                <i />
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="setting">
        <div className="setting-text">
          <b>Densité</b>
          <p>« Compact » resserre les marges et réduit légèrement le texte : plus de lignes visibles d’un coup.</p>
        </div>
        <div className="setting-control">
          <Segmented value={prefs.density} onChange={density => setPrefs({ density })}
                     options={[
                       { value: 'confort', label: 'Confort', icon: 'rows' },
                       { value: 'compact', label: 'Compact', icon: 'sliders' },
                     ]} />
        </div>
      </div>

      <div className="setting">
        <div className="setting-text">
          <b>Animations</b>
          <p>
            « Réduites » supprime transitions et apparitions. Le réglage système
            « mouvement réduit » est de toute façon respecté.
          </p>
        </div>
        <div className="setting-control">
          <Segmented value={prefs.motion} onChange={motion => setPrefs({ motion })}
                     options={[
                       { value: 'full', label: 'Complètes', icon: 'waves' },
                       { value: 'reduced', label: 'Réduites', icon: 'slash' },
                     ]} />
        </div>
      </div>

      <div className="setting">
        <div className="setting-text">
          <b>Barre latérale</b>
          <p>Réduite, elle ne montre que les icônes ; le libellé apparaît au survol.</p>
        </div>
        <div className="setting-control">
          <Segmented value={prefs.sidebar} onChange={sidebar => setPrefs({ sidebar })}
                     options={[
                       { value: 'expanded', label: 'Déployée', icon: 'panelRight' },
                       { value: 'collapsed', label: 'Réduite', icon: 'panelLeft' },
                     ]} />
        </div>
      </div>
    </>
  );
}

// --------------------------------------------------------------------------
// Appareils connectés
// --------------------------------------------------------------------------

function SessionsTab() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: account, isLoading } = useAccount();
  const [revokeOpen, setRevokeOpen] = useState(false);

  if (isLoading || !account) return <Loader />;

  const others = account.sessions.filter(session => !session.current).length;
  const total = account.sessions.length;

  return (
    <>
      <p className="muted small mb-2">
        Une session est ouverte par navigateur et par poste. L’application n’enregistre
        ni le nom de l’appareil ni son adresse : seules les dates de la session sont
        connues — annoncer un « iPhone à Paris » serait une invention.
      </p>

      <div className="card">
        <div className="card-head">
          <h2>{total} {plural(total, 'session')} {plural(total, 'ouverte')}</h2>
          {others > 0
            ? <span className="badge warn">{others} ailleurs</span>
            : <span className="badge ok">Celle-ci uniquement</span>}
        </div>
        <div className="card-body" style={{ paddingTop: 4, paddingBottom: 4 }}>
          {total === 0 && <p className="dim small">Aucune session.</p>}
          {account.sessions.map(session => (
            <div className={`session-row${session.current ? ' current' : ''}`}
                 key={session.createdAt + session.expiresAt}>
              <span className="sr-ico">
                <Icon name={session.current ? 'monitor' : 'devices'} />
              </span>
              <div className="sr-main">
                <div className="row-title" style={{ fontSize: '.875rem' }}>
                  {session.current ? 'Cet appareil' : 'Autre appareil'}
                  {session.current && (
                    <span className="badge accent" style={{ marginLeft: 6 }}>session courante</span>
                  )}
                </div>
                <div className="dim small">
                  Ouverte {fmtRelative(session.createdAt)}
                  {' · expire le '}{fmtDate(session.expiresAt, true)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="setting mt-2">
        <div className="setting-text">
          <b>Fermer les autres sessions</b>
          <p>
            Utile après une connexion sur un poste partagé. La session courante reste
            ouverte ; toutes les autres devront se reconnecter.
          </p>
        </div>
        <div className="setting-control">
          <button className="btn danger" disabled={others === 0}
                  onClick={() => setRevokeOpen(true)}>
            <Icon name="logOut" />Déconnecter les autres appareils
          </button>
        </div>
      </div>

      {revokeOpen && (
        <PasswordPrompt
          title="Déconnecter les autres appareils ?"
          message={`${others} ${plural(others, 'session')} ${others > 1 ? 'seront fermées' : 'sera fermée'}. Cette session-ci reste ouverte.`}
          confirmLabel="Déconnecter"
          endpoint="/api/account/sessions/revoke"
          danger
          onClose={() => setRevokeOpen(false)}
          onSuccess={async (result: { revokedSessions: number }) => {
            toast('Sessions fermées', `${result.revokedSessions} session(s) déconnectée(s).`, 'ok');
            setRevokeOpen(false);
            await queryClient.invalidateQueries({ queryKey: ACCOUNT_KEY });
          }} />
      )}
    </>
  );
}
