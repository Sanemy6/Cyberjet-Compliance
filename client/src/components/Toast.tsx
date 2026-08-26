import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';

export type ToastKind = 'ok' | 'error' | 'warn' | 'info';

interface ToastItem {
  id: number;
  title: string;
  message: string;
  kind: ToastKind;
}

const TOAST_ICON: Record<ToastKind, IconName> = {
  ok: 'checkCircle',
  error: 'xCircle',
  warn: 'alert',
  info: 'info',
};

type ToastFn = (title: string, message?: string, kind?: ToastKind, duration?: number) => void;

const ToastContext = createContext<ToastFn | null>(null);

export function useToast(): ToastFn {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error('useToast doit être utilisé sous <ToastProvider>.');
  return toast;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems(current => current.filter(item => item.id !== id));
  }, []);

  const toast = useCallback<ToastFn>((title, message = '', kind = 'info', duration = 4200) => {
    const id = nextId.current++;
    setItems(current => [...current, { id, title, message, kind }]);
    if (duration > 0) window.setTimeout(() => dismiss(id), duration);
  }, [dismiss]);

  // La fonction est stable : la passer telle quelle évite de re-rendre tout
  // l'arbre à chaque notification.
  const value = useMemo(() => toast, [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="toast-root">
          {items.map(item => (
            <div className={`toast ${item.kind}`} key={item.id} role="status">
              <Icon name={TOAST_ICON[item.kind]} />
              <div className="t-body">
                <div className="t-title">{item.title}</div>
                {item.message && <div className="t-msg">{item.message}</div>}
              </div>
              <button className="icon-btn sm" aria-label="Fermer"
                      onClick={() => dismiss(item.id)}>
                <Icon name="x" />
              </button>
            </div>
          ))}
        </div>,
        document.body)}
    </ToastContext.Provider>
  );
}
