import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

interface IdleWarningProps {
  /** Secondes restantes avant la fermeture de session. */
  secondsLeft: number;
  onStay: () => void;
  onLogout: () => void;
}

/**
 * Avertissement avant fermeture pour inactivité.
 *
 * Volontairement pas bâti sur <Modal> : celui-ci se ferme à Échap et au clic
 * sur le fond, deux gestes qu'on ne peut pas interpréter comme « je suis
 * revenu ». Rester connecté doit être un choix explicite, sans quoi un clic
 * distrait suffirait à rouvrir un poste que la personne a quitté.
 */
export function IdleWarning({ secondsLeft, onStay, onLogout }: IdleWarningProps) {
  const stayButton = useRef<HTMLButtonElement>(null);

  useEffect(() => { stayButton.current?.focus(); }, []);

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const countdown = minutes > 0
    ? `${minutes} min ${String(seconds).padStart(2, '0')} s`
    : `${seconds} seconde${seconds > 1 ? 's' : ''}`;

  return createPortal(
    <div className="modal-backdrop">
      <div className="modal idle-warning" role="alertdialog" aria-modal="true"
           aria-labelledby="idle-title" aria-describedby="idle-text">
        <div className="modal-head">
          <div>
            <h2 id="idle-title">
              <Icon name="clock" /> Votre session va expirer
            </h2>
          </div>
        </div>

        <div className="modal-body">
          <p id="idle-text">
            Faute d’activité, vous allez être déconnecté dans{' '}
            {/* aria-live sur le seul compte à rebours : annoncer la phrase
                entière chaque seconde rendrait le lecteur d'écran inaudible. */}
            <strong className="idle-countdown" aria-live="polite" aria-atomic="true">
              {countdown}
            </strong>.
          </p>
          <p className="dim small">
            Les modifications non enregistrées seraient perdues.
          </p>
        </div>

        <div className="modal-foot">
          <button className="btn ghost" type="button" onClick={onLogout}>
            <Icon name="logOut" /> Se déconnecter
          </button>
          <button className="btn primary" type="button" ref={stayButton} onClick={onStay}>
            <Icon name="check" /> Rester connecté
          </button>
        </div>
      </div>
    </div>,
    document.body);
}
