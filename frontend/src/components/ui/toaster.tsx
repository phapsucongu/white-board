import { useEffect, useState, type ReactNode } from 'react';

type ToastType = 'info' | 'success' | 'error' | 'warning';

type Toast = {
  id: string;
  type: ToastType;
  message: string;
  exiting?: boolean;
};

let toastListeners: Array<(toasts: Toast[]) => void> = [];
let toastId = 0;
let toasts: Toast[] = [];

function notifyListeners() {
  for (const listener of toastListeners) {
    listener([...toasts]);
  }
}

function addToast(type: ToastType, message: string) {
  const id = `toast-${++toastId}`;
  toasts = [...toasts, { id, type, message }];
  notifyListeners();

  setTimeout(() => {
    toasts = toasts.map((t) => (t.id === id ? { ...t, exiting: true } : t));
    notifyListeners();

    setTimeout(() => {
      toasts = toasts.filter((t) => t.id !== id);
      notifyListeners();
    }, 300);
  }, 4000);
}

export function toast(message: string, type: ToastType = 'info') {
  addToast(type, message);
}

export const toastService = {
  success: (message: string) => toast(message, 'success'),
  error: (message: string) => toast(message, 'error'),
  warning: (message: string) => toast(message, 'warning'),
  info: (message: string) => toast(message, 'info')
};

const borderColors: Record<ToastType, string> = {
  success: 'border-l-tertiary',
  error: 'border-l-error',
  warning: 'border-l-secondary',
  info: 'border-l-primary'
};

const iconNames: Record<ToastType, string> = {
  success: 'check_circle',
  error: 'error',
  warning: 'warning',
  info: 'info'
};

const iconColors: Record<ToastType, string> = {
  success: 'text-tertiary',
  error: 'text-error',
  warning: 'text-secondary',
  info: 'text-primary'
};

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);

  useEffect(() => {
    const listener = (next: Toast[]) => setItems(next);
    toastListeners = [...toastListeners, listener];
    return () => {
      toastListeners = toastListeners.filter((l) => l !== listener);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-3 pointer-events-none">
      {items.map((item) => (
        <ToastItem key={item.id} toast={item} />
      ))}
    </div>
  );
}

function ToastItem({ toast: item }: { toast: Toast }) {
  const exiting = item.exiting ?? false;

  return (
    <div
      className={`glass-panel rounded-lg p-4 flex items-start gap-3 shadow-lg border-l-2 ${borderColors[item.type]} pointer-events-auto max-w-sm transition-all duration-300 ${exiting ? 'opacity-0 translate-x-4 scale-95' : 'opacity-100 toast-enter'}`}
      role="alert"
    >
      <span className={`material-symbols-outlined text-lg ${iconColors[item.type]}`}>
        {iconNames[item.type]}
      </span>
      <p className="text-body-sm text-on-surface flex-1">{item.message}</p>
      <button
        className="text-on-surface-variant hover:text-on-surface transition-colors -mt-0.5"
        onClick={() => {
          toasts = toasts.map((t) => (t.id === item.id ? { ...t, exiting: true } : t));
          notifyListeners();
          setTimeout(() => {
            toasts = toasts.filter((t) => t.id !== item.id);
            notifyListeners();
          }, 300);
        }}
        type="button"
        aria-label="Dismiss"
      >
        <span className="material-symbols-outlined text-base">close</span>
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
