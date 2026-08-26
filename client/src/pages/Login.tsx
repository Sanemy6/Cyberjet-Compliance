import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api } from '@/api/client';
import type { LoginResult, MfaVerifyResult } from '@/api/types';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Ui';
import { useToast } from '@/components/Toast';
import { useSession } from '@/lib/session';
import '@/styles/auth.css';

type Screen = 'loading' | 'setup' | 'login' | 'mfa';

/**
 * Connexion, création du compte administrateur initial, et second facteur.
 *
 * Écran volontairement toujours en thème clair : le thème est une préférence de
 * compte, et personne n'est encore identifié ici.
 */
export function LoginPage() {
  const { status, refresh } = useSession();
  const [screen, setScreen] = useState<Screen>('loading');

  useEffect(() => {
    const root = document.documentElement;

    const lock = () => { if (root.dataset.theme !== 'light') root.dataset.theme = 'light'; };
    lock();
    document.body.classList.add('auth-body');

    // Un simple réglage au montage ne suffit pas : le statut de session porte
    // les préférences du compte, et sa relecture pendant qu'on est encore sur
    // cet écran (juste après la saisie du mot de passe, par exemple) réapplique
    // le thème enregistré — sombre, si c'est celui du compte — par-dessus le
    // clair forcé ici. Un observateur reverrouille l'attribut à chaque
    // tentative de le changer, tant que cet écran reste affiché.
    const observer = new MutationObserver(lock);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });

    return () => {
      observer.disconnect();
      document.body.classList.remove('auth-body');
    };
  }, []);

  useEffect(() => {
    if (!status) return;
    if (status.needsSetup) setScreen('setup');
    else if (status.mfaPending) setScreen('mfa');
    else setScreen('login');
  }, [status]);

  return (
    <>
      <BrandPanel />
      <div className="auth-formside">
        <div className="auth-form">
          <div className="auth-form-mark">
            <img src="/cyberjet-logo.png" alt="Cyberjet" />
          </div>

          {screen === 'loading' && <Loader />}
          {screen === 'setup' && <CredentialsForm mode="setup" onDone={refresh} />}
          {screen === 'login' && (
            <CredentialsForm mode="login" onDone={refresh}
                             onMfaRequired={() => setScreen('mfa')} />
          )}
          {screen === 'mfa' && (
            <MfaForm onDone={refresh} onCancel={() => setScreen('login')} />
          )}
        </div>
      </div>
    </>
  );
}

// --------------------------------------------------------------------------
// Panneau de marque
//
// Les trois arguments avancés sont vérifiables dans le produit : les cinq
// référentiels sont chargés au démarrage, le moteur n'émet aucune requête
// sortante, et le journal d'audit est consultable. Rien d'autre n'y figure —
// un écran de connexion qui promet plus que l'outil ne tient se paie ensuite.
// --------------------------------------------------------------------------

function BrandPanel() {
  return (
    <aside className="auth-brandside">
      <div className="auth-logo">
        <img src="/cyberjet-logo-white.png" alt="" />
        <b>
          Cyberjet
          <span>Compliance</span>
        </b>
      </div>

      <div className="auth-pitch">
        <h1>Vos réponses de conformité, réutilisées automatiquement.</h1>
        <p>
          Chaque questionnaire sécurité reçu d’un client est confronté à votre base
          de réponses de référence et aux configurations techniques du dossier. Vous
          relisez, vous ajustez, vous exportez le fichier du client complété.
        </p>

        <ul className="auth-points">
          <Point icon="shieldCheck">
            <b>5 référentiels pré-chargés</b> — EASA Part-IS, ISO/IEC 27001,
            NIS 2, DORA et SOC 2, soit 173 contrôles servant d’ancrage aux réponses.
          </Point>
          <Point icon="lock">
            <b>Moteur de rapprochement hors ligne</b> — aucune requête sortante,
            aucun service tiers. Les dossiers clients sont cloisonnés entre eux.
          </Point>
          <Point icon="history">
            <b>Journal d’audit</b> — connexions, changements de droits, modifications
            et exports, conservés un an et exportables en CSV.
          </Point>
        </ul>
      </div>

      <p className="auth-legal">
        Accès réservé aux personnes autorisées. Les tentatives de connexion sont
        journalisées.
      </p>
    </aside>
  );
}

function Point({ icon, children }: { icon: 'shieldCheck' | 'lock' | 'history'; children: ReactNode }) {
  return <li><Icon name={icon} />{<span>{children}</span>}</li>;
}

// --------------------------------------------------------------------------
// Identifiant et mot de passe
// --------------------------------------------------------------------------

function CredentialsForm({ mode, onDone, onMfaRequired }: {
  mode: 'login' | 'setup';
  onDone: () => Promise<void>;
  onMfaRequired?: () => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const isSetup = mode === 'setup';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api.post<LoginResult>(
        isSetup ? '/api/auth/setup' : '/api/auth/login',
        { username: username.trim(), password });

      if (result?.mfaRequired) {
        // Le statut doit refléter la session à demi ouverte avant que l'écran
        // du second facteur ne s'affiche.
        await onDone();
        onMfaRequired?.();
        return;
      }
      await onDone();
    } catch (caught) {
      // Le bandeau du formulaire (juste au-dessus) porte déjà l'erreur : un
      // toast en plus ne ferait que la répéter, et s'empilerait à chaque
      // tentative ratée — cinq essais, cinq notifications identiques à l'écran.
      const message = (caught as Error).message;
      setError(message);
      setBusy(false);
    }
  };

  return (
    <>
      <h2>{isSetup ? 'Créer le compte administrateur' : 'Connexion'}</h2>
      <p className="auth-sub">
        {isSetup
          ? <>Première ouverture de l’application : créez le compte qui administrera
              les accès. Vous ajouterez vos collègues ensuite, depuis <span
              className="mono">Comptes</span>.</>
          : 'Connectez-vous pour accéder à vos dossiers de conformité.'}
      </p>

      {error && <Alert>{error}</Alert>}

      <form onSubmit={submit} noValidate>
        <div className="auth-field">
          <label htmlFor="auth-user">Identifiant</label>
          <input className="auth-input" id="auth-user" autoComplete="username" required autoFocus
                 minLength={isSetup ? 3 : undefined} spellCheck={false}
                 placeholder={isSetup ? 'prenom.nom' : ''}
                 value={username} onChange={event => setUsername(event.target.value)} />
        </div>

        <PasswordField id="auth-pass" label="Mot de passe" value={password}
                       onChange={setPassword}
                       autoComplete={isSetup ? 'new-password' : 'current-password'}
                       minLength={isSetup ? 8 : undefined}
                       help={isSetup
                         ? '8 caractères minimum. Une phrase longue vaut mieux qu’un mot court et tordu.'
                         : undefined} />

        <button className="auth-submit" type="submit" disabled={busy}>
          {busy
            ? <span className="auth-spinner" />
            : <><Icon name={isSetup ? 'shieldCheck' : 'key'} />
                {isSetup ? 'Créer le compte et continuer' : 'Se connecter'}</>}
        </button>
      </form>
    </>
  );
}

// --------------------------------------------------------------------------
// Second facteur
// --------------------------------------------------------------------------

function MfaForm({ onDone, onCancel }: { onDone: () => Promise<void>; onCancel: () => void }) {
  const toast = useToast();
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api.post<MfaVerifyResult>('/api/auth/mfa/verify', { code: code.trim() });
      if (result.recoveryCodesRemaining <= 2) {
        toast('Codes de récupération presque épuisés',
              `Il ne vous reste que ${result.recoveryCodesRemaining} code(s). `
              + 'Régénérez-en un jeu depuis la page Sécurité.', 'warn', 9000);
      }
      await onDone();
    } catch (caught) {
      setError((caught as Error).message);
      setCode('');
      setBusy(false);
    }
  };

  const cancel = async () => {
    try { await api.post('/api/auth/mfa/cancel'); } catch { /* on repart de zéro */ }
    // Le statut porte encore `mfaPending` : il faut le rafraîchir avant de
    // réafficher l'écran de connexion, sinon on y revient aussitôt.
    await onDone();
    onCancel();
  };

  return (
    <>
      <h2>Vérification en deux étapes</h2>
      <p className="auth-sub">
        {useRecovery
          ? 'Saisissez l’un de vos codes de récupération. Chaque code ne sert qu’une fois.'
          : 'Saisissez le code à 6 chiffres affiché par votre application d’authentification.'}
      </p>

      {error && <Alert>{error}</Alert>}

      <form onSubmit={submit} noValidate>
        <div className="auth-field">
          <label htmlFor="auth-code">
            {useRecovery ? 'Code de récupération' : 'Code à 6 chiffres'}
          </label>
          <input className={`auth-input ${useRecovery ? 'mono' : 'auth-code'}`} id="auth-code"
                 required autoFocus autoComplete="one-time-code" spellCheck={false}
                 inputMode={useRecovery ? 'text' : 'numeric'}
                 placeholder={useRecovery ? 'XXXX-XXXX-XXXX' : '000000'}
                 maxLength={useRecovery ? 14 : 6}
                 value={code}
                 onChange={event => setCode(useRecovery
                   ? event.target.value.toUpperCase()
                   : event.target.value.replace(/\D/g, '').slice(0, 6))} />
        </div>

        <button className="auth-submit" type="submit" disabled={busy}>
          {busy ? <span className="auth-spinner" />
                : <><Icon name="shieldCheck" />Vérifier</>}
        </button>
      </form>

      <div className="auth-alt">
        <button type="button"
                onClick={() => { setUseRecovery(current => !current); setCode(''); setError(''); }}>
          {useRecovery
            ? 'Utiliser mon application d’authentification'
            : 'Je n’ai pas accès à mon téléphone'}
        </button>
        <button type="button" onClick={cancel}>Annuler et changer de compte</button>
      </div>
    </>
  );
}

// --------------------------------------------------------------------------
// Briques communes
// --------------------------------------------------------------------------

function Alert({ children }: { children: ReactNode }) {
  return (
    <div className="auth-alert" role="alert">
      <Icon name="alert" />
      <span>{children}</span>
    </div>
  );
}

/**
 * Champ mot de passe, avec bascule d'affichage et avertissement de verrouillage
 * majuscules — la première cause de « mon mot de passe ne marche plus ».
 */
function PasswordField({ id, label, value, onChange, autoComplete, minLength, help }: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  minLength?: number;
  help?: string;
}) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      {/* Le bouton « afficher » vit à côté du champ, pas dedans : posé dans
          le coin du champ, il se disputerait la même place que l'icône native
          qu'un gestionnaire de mots de passe y superpose — Chrome, Firefox,
          1Password, Bitwarden… tous se calent sur ce coin sans qu'aucun CSS
          ne puisse le leur faire éviter. Les séparer élimine le
          chevauchement quel que soit le gestionnaire installé. */}
      <div className="auth-secret">
        <input className="auth-input" id={id} required
               type={visible ? 'text' : 'password'}
               autoComplete={autoComplete} minLength={minLength}
               value={value}
               onChange={event => onChange(event.target.value)}
               onKeyUp={event => setCapsLock(event.getModifierState?.('CapsLock') ?? false)}
               onBlur={() => setCapsLock(false)} />
        <button className="auth-reveal" type="button" tabIndex={-1}
                aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                onClick={() => setVisible(current => !current)}>
          <Icon name={visible ? 'eyeOff' : 'eye'} />
        </button>
      </div>

      {capsLock && (
        <span className="auth-hint">
          <Icon name="alert" />Verrouillage des majuscules activé
        </span>
      )}
      {help && <span className="auth-help">{help}</span>}
    </div>
  );
}
