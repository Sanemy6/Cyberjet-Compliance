import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/api/client';
import { keys } from '@/api/queries';
import type { PublicUser, Settings } from '@/api/types';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { BusyButton, EmptyState, Loader } from '@/components/Ui';
import { useToast } from '@/components/Toast';
import { useDialogs } from '@/components/Dialogs';
import { PageMeta } from '@/components/layout/Shell';
import { useSession } from '@/lib/session';
import { fmtDate, initials } from '@/lib/format';

/**
 * Gestion des comptes — réservée aux administrateurs.
 *
 * Toute personne connectée peut consulter et modifier les dossiers clients ;
 * seuls les administrateurs décident qui a accès.
 */
export function UsersPage() {
  const toast = useToast();
  const { confirm } = useDialogs();
  const { status } = useSession();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<PublicUser | null>(null);
  const [creating, setCreating] = useState(false);

  const isAdmin = status?.isAdmin ?? false;

  const { data: users = [], isLoading } = useQuery({
    queryKey: keys.users,
    queryFn: () => api.get<PublicUser[]>('/api/users'),
    enabled: isAdmin,
    // Le délai de verrouillage s'écoule pendant qu'on regarde l'écran : sans
    // rafraîchissement, la pastille resterait affichée après la levée du
    // blocage. On ne sonde que tant qu'un compte est concerné — cette liste
    // est par ailleurs immobile, la relire en boucle ne servirait à rien.
    refetchInterval: query =>
      query.state.data?.some(user => user.lockedForMinutes !== null) ? 30_000 : false,
  });

  const reload = () => queryClient.invalidateQueries({ queryKey: keys.users });

  // Arrivée depuis la palette de commandes, qui vise la section directement.
  // React Router ne défile pas de lui-même vers un fragment d'URL ; et la
  // cible n'existe qu'une fois les comptes chargés, d'où l'attente d'une
  // frame plutôt qu'un défilement immédiat.
  const { hash } = useLocation();
  useEffect(() => {
    if (hash !== '#fermeture-sessions') return;
    const timer = window.setTimeout(() => {
      document.getElementById('fermeture-sessions')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [hash, isLoading]);

  if (!isAdmin) {
    return (
      <>
        <PageMeta crumb={[{ label: 'Comptes' }]} />
        <div className="card">
          <EmptyState icon="lock" title="Accès réservé"
            text="Seuls les administrateurs peuvent gérer les comptes qui accèdent à l’application." />
        </div>
      </>
    );
  }

  const resetMfa = async (target: PublicUser) => {
    const ok = await confirm({
      title: 'Réinitialiser le second facteur ?',
      message: `${target.username} ne sera plus protégé que par son mot de passe et devra `
             + 'reconfigurer son application d’authentification. À n’utiliser que si la '
             + 'personne a perdu son téléphone et ses codes de récupération — et après avoir '
             + 'vérifié son identité autrement. L’opération est journalisée.',
      confirmLabel: 'Réinitialiser',
      danger: true,
    });
    if (!ok) return;

    try {
      await api.post(`/api/users/${target.id}/mfa/reset`);
      toast('Second facteur réinitialisé', target.username, 'ok');
      await reload();
    } catch (error) {
      toast('Réinitialisation impossible', (error as Error).message, 'error');
    }
  };

  // Pas de confirmation : le geste ne détruit rien et se rejoue sans dommage.
  // Une modale de plus n'ajouterait ici que de la friction, alors qu'on
  // débloque justement quelqu'un qui attend au téléphone.
  const unlock = async (target: PublicUser) => {
    try {
      await api.post(`/api/users/${target.id}/unlock`);
      toast('Compte débloqué', `${target.username} peut se reconnecter.`, 'ok');
      await reload();
    } catch (error) {
      toast('Déblocage impossible', (error as Error).message, 'error');
    }
  };

  const remove = async (target: PublicUser) => {
    const ok = await confirm({
      title: 'Supprimer ce compte ?',
      message: `${target.username} ne pourra plus se connecter à l’application.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;

    try {
      await api.del(`/api/users/${target.id}`);
      toast('Compte supprimé', target.username, 'ok');
      await reload();
    } catch (error) {
      toast('Suppression impossible', (error as Error).message, 'error');
    }
  };

  const actions = (
    <button className="btn primary" onClick={() => setCreating(true)}>
      <Icon name="plus" /><span className="nowrap">Nouveau compte</span>
    </button>
  );

  return (
    <>
      <PageMeta crumb={[{ label: 'Comptes' }]} actions={actions} />

      <div className="page-head">
        <div>
          <p className="eyebrow"><Icon name="users" />Administration</p>
          <h1>Comptes</h1>
          <p className="sub">
            Qui peut se connecter à l’application. Toute personne connectée peut consulter
            et modifier les dossiers clients ; seuls les administrateurs gèrent les comptes.
          </p>
        </div>
      </div>

      <div className="card">
        {isLoading ? <Loader /> : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Personne</th><th>Adresse</th><th>Rôle</th><th>Statut</th>
                  <th>Second facteur</th><th>Dernière connexion</th><th />
                </tr>
              </thead>
              <tbody>
                {users.map(user => {
                  const isMe = user.username === status?.username;
                  return (
                    <tr key={user.id}>
                      <td>
                        <div className="flex" style={{ gap: 10 }}>
                          <span className="avatar sm">
                            {initials(user.fullName, user.username)}
                          </span>
                          <div style={{ minWidth: 0 }}>
                            {/* Le badge est en inline-flex : un espace écrit à
                                l'intérieur y serait absorbé, d'où la gouttière
                                portée par le conteneur. */}
                            <div className="flex" style={{ gap: 7 }}>
                              <strong>{user.fullName || user.username}</strong>
                              {isMe && <span className="badge outline">vous</span>}
                            </div>
                            <div className="dim" style={{ fontSize: '.75rem' }}>
                              {user.username}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="small">
                        {user.email
                          ? <a href={`mailto:${user.email}`}>{user.email}</a>
                          : <span className="dim">—</span>}
                      </td>
                      <td>
                        {user.isAdmin
                          ? <span className="badge accent">Administrateur</span>
                          : <span className="badge">Membre</span>}
                      </td>
                      <td>
                        {/* Le verrouillage prime sur « actif » : c'est ce qui
                            empêche la personne d'entrer, et donc ce qu'un
                            administrateur cherche du regard quand on l'appelle. */}
                        {!user.active ? (
                          <span className="badge outline">Désactivé</span>
                        ) : user.lockedForMinutes ? (
                          <span className="badge danger"
                                title={`Trop de tentatives de connexion. Déblocage automatique dans ${user.lockedForMinutes} minute${user.lockedForMinutes > 1 ? 's' : ''}.`}>
                            <Icon name="lock" />Bloqué · {user.lockedForMinutes} min
                          </span>
                        ) : (
                          <span className="badge ok">Actif</span>
                        )}
                      </td>
                      <td>
                        {user.mfaEnabled ? (
                          <span className="badge ok"
                                title={user.mfaEnabledAt
                                  ? `Activé le ${fmtDate(user.mfaEnabledAt)}` : undefined}>
                            <Icon name="shieldCheck" />Activé
                          </span>
                        ) : (
                          <span className="badge warn">Non activé</span>
                        )}
                      </td>
                      <td className="dim small" title={`Compte créé le ${fmtDate(user.createdAt)}`}>
                        {user.lastLoginAt ? fmtDate(user.lastLoginAt, true) : 'jamais'}
                      </td>
                      <td className="actions">
                        {user.lockedForMinutes !== null && (
                          <button className="icon-btn sm unlock" onClick={() => unlock(user)}
                                  title="Débloquer maintenant (sans attendre la fin du verrouillage)">
                            <Icon name="unlock" />
                          </button>
                        )}
                        {user.mfaEnabled && (
                          <button className="icon-btn sm" onClick={() => resetMfa(user)}
                                  title="Réinitialiser le second facteur (téléphone perdu)">
                            <Icon name="refresh" />
                          </button>
                        )}
                        <button className="icon-btn sm" title="Modifier"
                                onClick={() => setEditing(user)}>
                          <Icon name="edit" />
                        </button>
                        <button className="icon-btn sm" title="Supprimer" disabled={isMe}
                                onClick={() => remove(user)}>
                          <Icon name="trash" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <SessionTimeoutCard />

      {(creating || editing) && (
        <UserForm user={editing} currentUsername={status?.username ?? null}
                  onClose={() => { setCreating(false); setEditing(null); }}
                  onSaved={reload} />
      )}
    </>
  );
}

// --------------------------------------------------------------------------
// Délai d'inactivité
// --------------------------------------------------------------------------

/** Valeurs courantes proposées d'un clic. Le champ reste libre : ces choix
 *  couvrent l'usage habituel sans interdire une valeur intermédiaire. */
const TIMEOUT_PRESETS = [15, 30, 60, 120, 480];

function SessionTimeoutCard() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { refresh } = useSession();
  const [draft, setDraft] = useState<string | null>(null);

  const { data: settings, isLoading } = useQuery({
    queryKey: keys.settings,
    queryFn: () => api.get<Settings>('/api/settings'),
  });

  if (isLoading || !settings) return null;

  const current = settings.sessionIdleTimeoutMinutes;
  // Tant que rien n'a été saisi, le champ suit la valeur du serveur.
  const value = draft ?? String(current);
  const parsed = Number(value);

  const invalid = !Number.isInteger(parsed) || parsed < 0
    || (parsed !== 0 && (parsed < settings.minIdleTimeoutMinutes
                      || parsed > settings.maxIdleTimeoutMinutes));

  const save = async () => {
    await api.put('/api/settings/session-idle-timeout', { minutes: parsed });
    await queryClient.invalidateQueries({ queryKey: keys.settings });
    // Le délai voyage aussi dans /api/auth/status, que la coquille lit pour
    // armer son propre compte à rebours : sans ce rafraîchissement, l'écran
    // continuerait de compter sur l'ancienne valeur jusqu'au prochain
    // rechargement de page.
    await refresh();
    setDraft(null);
    toast(parsed === 0
      ? 'Fermeture automatique désactivée.'
      : `Délai d’inactivité réglé sur ${parsed} minutes.`);
  };

  const dirty = draft !== null && parsed !== current;
  const options = [...TIMEOUT_PRESETS.map(m => ({ value: m, label: formatMinutes(m) })),
                   { value: 0, label: 'Désactivé' }];

  return (
    // L'ancre est la cible du raccourci de la palette de commandes : sans
    // elle, on arriverait en haut de la page, la section étant sous le tableau.
    <div className="card timeout-card" id="fermeture-sessions">
      <div className="card-head">
        <h2>Fermeture automatique des sessions</h2>
        <span className={`badge${current === 0 ? ' warn' : ' ok'}`}>
          {current === 0 ? 'Désactivée' : formatMinutes(current)}
        </span>
      </div>

      <div className="card-body timeout-body">
        <p className="timeout-lede">
          Passé ce délai sans activité, la session se ferme et il faut se reconnecter.
          Le réglage vaut pour toute l’organisation et prend effet immédiatement ;
          un avertissement s’affiche deux minutes avant l’échéance.
        </p>

        {/* Le sélecteur segmenté du projet : les options sont exclusives, et
            son cadre commun le dit mieux qu'une rangée de boutons séparés. */}
        <div className="segmented" role="group" aria-label="Délai d’inactivité">
          {options.map(option => (
            <button key={option.value} type="button"
                    className={`seg${parsed === option.value ? ' active' : ''}`}
                    aria-pressed={parsed === option.value}
                    onClick={() => setDraft(String(option.value))}>
              {option.label}
            </button>
          ))}
        </div>

        <div className="timeout-custom">
          <div className="field timeout-field">
            <label htmlFor="idle-minutes">Valeur personnalisée</label>
            <div className="suffixed">
              <input id="idle-minutes" className="input" type="number" inputMode="numeric"
                     min={0} max={settings.maxIdleTimeoutMinutes}
                     aria-describedby="idle-hint"
                     value={value}
                     onChange={event => setDraft(event.target.value)} />
              <span className="suffix">min</span>
            </div>
          </div>

          <div className="timeout-actions">
            <BusyButton className="btn primary" disabled={invalid || !dirty} onClick={save}>
              <Icon name="check" /> Enregistrer
            </BusyButton>
            {dirty && (
              <button className="btn ghost" type="button" onClick={() => setDraft(null)}>
                Annuler
              </button>
            )}
          </div>
        </div>

        <p id="idle-hint" className={`small timeout-hint${invalid ? ' invalid' : ''}`}>
          {invalid ? (
            <>
              <Icon name="alert" />
              Indiquez une valeur entre {settings.minIdleTimeoutMinutes} et{' '}
              {settings.maxIdleTimeoutMinutes} minutes, ou 0 pour désactiver.
            </>
          ) : current === 0 ? (
            <>
              <Icon name="alert" />
              Aucune fermeture automatique : une session ouverte le reste jusqu’à la
              déconnexion ou son échéance de 30 jours.
            </>
          ) : (
            <>De {settings.minIdleTimeoutMinutes} minutes à{' '}
            {formatMinutes(settings.maxIdleTimeoutMinutes)}, ou 0 pour désactiver.</>
          )}
        </p>
      </div>
    </div>
  );
}

function formatMinutes(minutes: number): string {
  if (minutes === 0) return 'désactivée';
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} h` : `${minutes} min`;
}

// --------------------------------------------------------------------------
// Formulaire de compte
// --------------------------------------------------------------------------

function UserForm({ user, currentUsername, onClose, onSaved }: {
  user: PublicUser | null;
  currentUsername: string | null;
  onClose: () => void;
  onSaved: () => void | Promise<unknown>;
}) {
  const toast = useToast();
  const isEdit = Boolean(user?.id);
  const isSelf = isEdit && user!.username === currentUsername;

  const [form, setForm] = useState({
    username: user?.username ?? '',
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
    email: user?.email ?? '',
    password: '',
    isAdmin: user?.isAdmin ?? false,
    active: user?.active ?? true,
  });

  const set = (patch: Partial<typeof form>) => setForm(current => ({ ...current, ...patch }));

  const save = async () => {
    try {
      if (isEdit) {
        // Chaîne vide transmise volontairement : c'est ainsi qu'on efface une
        // adresse ou un nom, le serveur la convertit en valeur nulle.
        const payload: Record<string, unknown> = {
          email: form.email, firstName: form.firstName, lastName: form.lastName,
        };
        if (!isSelf) {
          payload.isAdmin = form.isAdmin;
          payload.active = form.active;
        }
        if (form.password) payload.password = form.password;
        await api.patch(`/api/users/${user!.id}`, payload);
      } else {
        if (form.username.trim().length < 3 || form.password.length < 8) {
          toast('Champs invalides',
                'Identifiant (3 caractères min.) et mot de passe (8 caractères min.) requis.',
                'warn');
          return;
        }
        await api.post('/api/users', {
          username: form.username.trim(),
          password: form.password,
          isAdmin: form.isAdmin,
          email: form.email,
          firstName: form.firstName,
          lastName: form.lastName,
        });
      }
      onClose();
      toast(isEdit ? 'Compte mis à jour' : 'Compte créé', '', 'ok');
      await onSaved();
    } catch (error) {
      toast('Enregistrement impossible', (error as Error).message, 'error');
    }
  };

  const lockedStyle = isSelf ? { opacity: .5, pointerEvents: 'none' as const } : undefined;

  return (
    <Modal title={isEdit ? 'Modifier le compte' : 'Nouveau compte'}
           sub={isEdit ? user!.username : 'Donnez accès à un collègue.'}
           onClose={onClose}
           footer={
             <>
               <button className="btn" onClick={onClose}>Annuler</button>
               <BusyButton className="btn primary" onClick={save}>
                 <Icon name="save" />{isEdit ? 'Enregistrer' : 'Créer le compte'}
               </BusyButton>
             </>
           }>
      <div className="field">
        <label htmlFor="uf-name">Identifiant de connexion{isEdit ? '' : ' *'}</label>
        <input className="input" id="uf-name" minLength={3} disabled={isEdit}
               value={form.username} onChange={event => set({ username: event.target.value })} />
        {isEdit && (
          <span className="help">Non modifiable : il sert de clé dans le journal d’audit.</span>
        )}
      </div>

      <div className="grid cols-2" style={{ gap: 15 }}>
        <div className="field">
          <label htmlFor="uf-first">Prénom</label>
          <input className="input" id="uf-first" maxLength={80} placeholder="Camille"
                 value={form.firstName} onChange={event => set({ firstName: event.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="uf-last">Nom</label>
          <input className="input" id="uf-last" maxLength={80} placeholder="Martin"
                 value={form.lastName} onChange={event => set({ lastName: event.target.value })} />
        </div>
      </div>

      <div className="field">
        <label htmlFor="uf-mail">Adresse électronique</label>
        <input className="input" id="uf-mail" type="email" maxLength={200}
               placeholder="prenom.nom@exemple.fr"
               value={form.email} onChange={event => set({ email: event.target.value })} />
      </div>

      <p className="help" style={{ marginTop: -6 }}>
        Nom et adresse servent à savoir qui contacter ; la personne complète ensuite sa
        fiche elle-même (poste, téléphone). Aucun courriel n’est envoyé par l’application.
      </p>

      <div className="field">
        <label htmlFor="uf-pass">
          {isEdit ? 'Nouveau mot de passe (laisser vide pour ne pas changer)' : 'Mot de passe *'}
        </label>
        <input className="input" id="uf-pass" type="password" minLength={8}
               autoComplete="new-password"
               value={form.password} onChange={event => set({ password: event.target.value })} />
        <span className="help">8 caractères minimum.</span>
      </div>

      <label className="switch" style={lockedStyle}>
        <input type="checkbox" checked={form.isAdmin} disabled={isSelf}
               onChange={event => set({ isAdmin: event.target.checked })} />
        <span className="track" />
        <span>Administrateur (peut gérer les comptes)</span>
      </label>

      {isEdit && (
        <label className="switch" style={lockedStyle}>
          <input type="checkbox" checked={form.active} disabled={isSelf}
                 onChange={event => set({ active: event.target.checked })} />
          <span className="track" />
          <span>Compte actif</span>
        </label>
      )}

      {isSelf && (
        <p className="dim small">
          Vous ne pouvez pas modifier vos propres droits ou désactiver votre propre compte.
        </p>
      )}
    </Modal>
  );
}
