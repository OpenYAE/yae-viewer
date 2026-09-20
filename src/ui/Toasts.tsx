import type { ReactElement } from 'react';
import { useViewer } from '../state/store';
import { CloseIcon } from './icons';

export function Toasts(): ReactElement | null {
  const toasts = useViewer((s) => s.toasts);
  const dismiss = useViewer((s) => s.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.level}`}>
          <span style={{ flexGrow: 1 }}>{toast.text}</span>
          <button type="button" className="toast__close" aria-label="Dismiss" onClick={() => dismiss(toast.id)}>
            <CloseIcon size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
