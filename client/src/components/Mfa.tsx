import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import type { TotpEnrollment } from '@/api/types';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { BusyButton } from './Ui';
import { useToast } from './Toast';
import { useSession } from '@/lib/session';
import { copyText } from '@/lib/clipboard';

/**
 * Second facteur — enrôlement, désactivation, codes de récupération.
 *
 * Un composant unique partagé par la page « Sécurité » et le panneau du compte :
 * deux points d'entrée qui conduiraient à deux dialogues distincts finiraient
 * toujours par diverger.
 */
export type MfaAction = 'enroll' | 'disable' | 'regenerate' | null;

interface MfaDialogsProps {
  action: MfaAction;
  onClose: () => void;
  /** Appelée après une opération réussie, une fois les codes refermés. */
  onDone?: () => void;
}

export function MfaDialogs({ action, onClose, onDone }: MfaDialogsProps) {
  const [codes, setCodes] = useState<string[] | null>(null);
  const [firstTime, setFirstTime] = useState(false);

  const finish = (newCodes: string[], isFirstTime: boolean) => {
    setCodes(newCodes);
    setFirstTime(isFirstTime);
    onClose();
  };

  return (
    <>
      {action === 'enroll' && (
        <EnrollDialog onClose={onClose} onActivated={c => finish(c, true)} />
      )}
      {action === 'disable' && <DisableDialog onClose={onClose} onDone={onDone} />}
      {action === 'regenerate' && (
        <RegenerateDialog onClose={onClose} onRegenerated={c => finish(c, false)} />
      )}
      {codes && (
        <RecoveryCodesDialog codes={codes} firstTime={firstTime}
                             onClose={() => { setCodes(null); onDone?.(); }} />
      )}
    </>
  );
}

// --------------------------------------------------------------------------
// Enrôlement
// --------------------------------------------------------------------------

function EnrollDialog({ onClose, onActivated }: {
  onClose: () => void;
  onActivated: (codes: string[]) => void;
}) {
  const toast = useToast();
  const { refresh } = useSession();
  const [setup, setSetup] = useState<TotpEnrollment | null>(null);
  const [code, setCode] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.post<TotpEnrollment>('/api/auth/mfa/totp/init')
      .then(result => { if (!cancelled) setSetup(result); })
      .catch(error => {
        toast('Impossible de démarrer la configuration', error.message, 'error');
        onClose();
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activate = async () => {
    if (!setup) return;
    try {
      const result = await api.post<{ recoveryCodes: string[] }>(
        '/api/auth/mfa/totp/activate', { code });
      await refresh();
      onActivated(result.recoveryCodes);
    } catch (error) {
      toast('Code refusé', (error as Error).message, 'error');
      setCode('');
      setFailed(true);
    }
  };

  return (
    <Modal title="Activer la vérification en deux étapes"
           sub="Étape 1 sur 2 — associer votre application"
           wide onClose={onClose}
           footer={
             <>
               <button className="btn" onClick={onClose}>Annuler</button>
               <BusyButton className="btn primary" disabled={code.length !== 6} onClick={activate}>
                 <Icon name="check" />Vérifier et activer
               </BusyButton>
             </>
           }>
      {!setup
        ? <div className="loader"><span className="spinner" /></div>
        : (
          <div className="enroll">
            {/* Le QR vient du serveur, généré à partir du secret : aucune donnée
                utilisateur n'y transite. */}
            <div className="enroll-qr" dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />
            <div className="enroll-steps">
              <p><b>1.</b> Ouvrez votre application d’authentification (Google
                 Authenticator, Microsoft Authenticator, Authy, 1Password…).</p>
              <p className="mt-1"><b>2.</b> Scannez ce QR code.</p>

              <details className="mt-1">
                <summary className="small muted" style={{ cursor: 'pointer' }}>
                  Impossible de scanner ?
                </summary>
                <p className="small muted mt-1">
                  Saisissez cette clé manuellement dans l’application :
                </p>
                <div className="secret-box mt-1">
                  <span className="mono">{setup.secret}</span>
                  <button className="icon-btn sm" title="Copier"
                          onClick={() => copyText(setup.secret.replace(/\s/g, ''), toast)}>
                    <Icon name="copy" />
                  </button>
                </div>
              </details>

              <p className="mt-2"><b>3.</b> Saisissez le code à 6 chiffres affiché :</p>
              <div className="field mt-1">
                <input className="input code-input" inputMode="numeric" autoComplete="one-time-code"
                       maxLength={6} placeholder="000000" autoFocus
                       value={code}
                       onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} />
                {failed && (
                  <span className="err">Code incorrect. Vérifiez l’heure de votre téléphone.</span>
                )}
              </div>
            </div>
          </div>
        )}
    </Modal>
  );
}

// --------------------------------------------------------------------------
// Codes de récupération
// --------------------------------------------------------------------------

function RecoveryCodesDialog({ codes, firstTime, onClose }: {
  codes: string[];
  firstTime: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const { status } = useSession();
  const text = codes.join('\n');

  const downloadCodes = () => {
    const header = 'Codes de récupération — Cyberjet Compliance\n'
      + `Compte : ${status?.username ?? ''}\n`
      + 'Chaque code ne fonctionne qu\'une seule fois.\n\n';
    const blob = new Blob([header + text + '\n'], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), {
      href: url, download: 'codes-recuperation-cyberjet.txt',
    });
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <Modal title={firstTime ? 'Vérification activée' : 'Nouveaux codes de récupération'}
           sub="Étape 2 sur 2 — conservez ces codes maintenant"
           onClose={onClose}
           footer={
             <>
               <button className="btn" onClick={() => copyText(text, toast)}>
                 <Icon name="copy" />Copier
               </button>
               <button className="btn" onClick={downloadCodes}>
                 <Icon name="download" />Télécharger
               </button>
               <button className="btn primary" onClick={onClose}>J’ai conservé mes codes</button>
             </>
           }>
      <div className="callout danger">
        <Icon name="alert" />
        <div>
          <p><b>Ces codes ne seront plus jamais affichés.</b></p>
          <p className="muted small mt-1">
            Seules leurs empreintes sont conservées : personne, pas même un administrateur,
            ne peut les retrouver. Sans eux et sans votre téléphone, votre accès devra être
            rétabli par un administrateur.
          </p>
        </div>
      </div>
      <div className="recovery-grid">
        {codes.map(code => <span className="recovery-code mono" key={code}>{code}</span>)}
      </div>
      <p className="muted small">
        Chaque code ne fonctionne qu’une seule fois. Rangez-les dans votre gestionnaire de
        mots de passe, ou imprimez-les et conservez-les hors de cet ordinateur.
      </p>
    </Modal>
  );
}

// --------------------------------------------------------------------------
// Opérations confirmées par mot de passe
//
// Une session ouverte ne doit pas suffire à retirer ou contourner le second
// facteur : c'est précisément la protection qu'un jeton volé cherche à lever.
// --------------------------------------------------------------------------

interface PasswordPromptProps {
  title: string;
  message: string;
  confirmLabel: string;
  endpoint: string;
  danger?: boolean;
  onClose: () => void;
  onSuccess: (result: any) => void | Promise<void>;
}

export function PasswordPrompt({
  title, message, confirmLabel, endpoint, danger, onClose, onSuccess,
}: PasswordPromptProps) {
  const toast = useToast();
  const [password, setPassword] = useState('');

  const submit = async () => {
    try {
      const result = await api.post<unknown>(endpoint, { password });
      await onSuccess(result);
    } catch (error) {
      toast('Refusé', (error as Error).message, 'error');
      setPassword('');
    }
  };

  return (
    <Modal title={title} onClose={onClose}
           footer={
             <>
               <button className="btn" onClick={onClose}>Annuler</button>
               <BusyButton className={`btn ${danger ? 'danger' : 'primary'}`} onClick={submit}>
                 {confirmLabel}
               </BusyButton>
             </>
           }>
      <p className="muted">{message}</p>
      <div className="field">
        <label htmlFor="pw-confirm">Confirmez avec votre mot de passe</label>
        <input className="input" id="pw-confirm" type="password" autoComplete="current-password"
               value={password}
               onChange={event => setPassword(event.target.value)}
               onKeyDown={event => { if (event.key === 'Enter') void submit(); }} />
      </div>
    </Modal>
  );
}

function DisableDialog({ onClose, onDone }: { onClose: () => void; onDone?: () => void }) {
  const toast = useToast();
  const { refresh } = useSession();

  return (
    <PasswordPrompt
      title="Désactiver la vérification en deux étapes ?"
      message="Votre compte ne sera plus protégé que par son mot de passe. Vos codes de récupération seront supprimés."
      confirmLabel="Désactiver"
      endpoint="/api/auth/mfa/disable"
      danger
      onClose={onClose}
      onSuccess={async () => {
        toast('Vérification désactivée',
              'Le compte n’est plus protégé que par son mot de passe.', 'warn', 6000);
        await refresh();
        onClose();
        onDone?.();
      }} />
  );
}

function RegenerateDialog({ onClose, onRegenerated }: {
  onClose: () => void;
  onRegenerated: (codes: string[]) => void;
}) {
  const { refresh } = useSession();

  return (
    <PasswordPrompt
      title="Régénérer les codes de récupération"
      message="Vos codes actuels seront immédiatement invalidés et remplacés par dix nouveaux."
      confirmLabel="Régénérer"
      endpoint="/api/auth/mfa/recovery/regenerate"
      onClose={onClose}
      onSuccess={async (result: { recoveryCodes: string[] }) => {
        await refresh();
        onRegenerated(result.recoveryCodes);
      }} />
  );
}
