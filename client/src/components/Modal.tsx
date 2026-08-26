import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

interface ModalProps {
  title: string;
  sub?: string;
  wide?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
}

/**
 * Boîte de dialogue modale. Ferme à Échap et au clic sur le fond ; le premier
 * champ reçoit le focus, sans quoi il faudrait cliquer avant de pouvoir taper.
 */
export function Modal({ title, sub, wide, children, footer, onClose }: ModalProps) {
  const backdrop = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const first = dialog.current?.querySelector<HTMLElement>('input, textarea, select');
    const timer = window.setTimeout(() => first?.focus(), 60);

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(timer);
    };
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop" ref={backdrop}
         onMouseDown={event => { if (event.target === backdrop.current) onClose(); }}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" ref={dialog}>
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {sub && <p className="sub">{sub}</p>}
          </div>
          <button className="icon-btn" aria-label="Fermer" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body);
}
