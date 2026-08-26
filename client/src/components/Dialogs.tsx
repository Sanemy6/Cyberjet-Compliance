import {
  createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode,
} from 'react';
import { Modal } from './Modal';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

interface ConfirmByTypingOptions {
  title: string;
  sub?: string;
  /** Encart d'avertissement affiché au-dessus du champ — il porte le détail de
   *  ce qui va être perdu. */
  warning?: ReactNode;
  /** Libellé exact que la personne doit ressaisir. */
  expected: string;
  confirmLabel: string;
}

interface Dialogs {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  confirmByTyping: (options: ConfirmByTypingOptions) => Promise<boolean>;
}

const DialogContext = createContext<Dialogs | null>(null);

export function useDialogs(): Dialogs {
  const dialogs = useContext(DialogContext);
  if (!dialogs) throw new Error('useDialogs doit être utilisé sous <DialogProvider>.');
  return dialogs;
}

type Pending =
  | { kind: 'confirm'; options: ConfirmOptions }
  | { kind: 'typing'; options: ConfirmByTypingOptions };

/**
 * Confirmations exposées sous forme de promesse. L'alternative — un composant
 * `<ConfirmDialog>` monté par chaque appelant — obligerait chaque écran à porter
 * un état « dialogue ouvert » et à découper son geste en deux moitiés.
 */
export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [typed, setTyped] = useState('');
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const settle = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setPending(null);
    setTyped('');
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => {
    setPending({ kind: 'confirm', options });
    return new Promise<boolean>(resolve => { resolver.current = resolve; });
  }, []);

  const confirmByTyping = useCallback((options: ConfirmByTypingOptions) => {
    setTyped('');
    setPending({ kind: 'typing', options });
    return new Promise<boolean>(resolve => { resolver.current = resolve; });
  }, []);

  const value = useMemo<Dialogs>(() => ({ confirm, confirmByTyping }), [confirm, confirmByTyping]);

  return (
    <DialogContext.Provider value={value}>
      {children}

      {pending?.kind === 'confirm' && (
        <Modal
          title={pending.options.title}
          onClose={() => settle(false)}
          footer={
            <>
              <button className="btn" onClick={() => settle(false)}>Annuler</button>
              <button className={`btn ${pending.options.danger ? 'danger' : 'primary'}`}
                      onClick={() => settle(true)}>
                {pending.options.confirmLabel ?? 'Confirmer'}
              </button>
            </>
          }>
          <p className="muted">{pending.options.message}</p>
        </Modal>
      )}

      {pending?.kind === 'typing' && (
        <Modal
          title={pending.options.title}
          sub={pending.options.sub}
          onClose={() => settle(false)}
          footer={
            <>
              <button className="btn" onClick={() => settle(false)}>Annuler</button>
              <button className="btn danger"
                      disabled={typed.trim() !== pending.options.expected}
                      onClick={() => settle(true)}>
                {pending.options.confirmLabel}
              </button>
            </>
          }>
          {pending.options.warning}
          <div className="field">
            <label htmlFor="ct-input">
              Saisissez <b>{pending.options.expected}</b> pour confirmer
            </label>
            <input className="input" id="ct-input" autoComplete="off" spellCheck={false}
                   value={typed}
                   onChange={event => setTyped(event.target.value)}
                   onKeyDown={event => {
                     if (event.key === 'Enter' && typed.trim() === pending.options.expected)
                       settle(true);
                   }} />
          </div>
        </Modal>
      )}
    </DialogContext.Provider>
  );
}
