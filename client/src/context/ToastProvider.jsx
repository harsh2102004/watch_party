import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { ToastContext } from './ToastContext.js';
import styles from '../components/common/Toast.module.css';

/**
 * Toast item display card.
 */
function ToastItemCard({ toast, onRemove }) {
  const getIcon = () => {
    switch (toast.type) {
      case 'success':
        return '✓';
      case 'error':
        return '✕';
      case 'warning':
        return '⚠';
      case 'info':
      default:
        return 'ℹ';
    }
  };

  return (
    <div
      className={`${styles.toast} ${styles[toast.type] || styles.info}`}
      role="status"
      aria-live="polite"
    >
      <span className={styles.icon}>{getIcon()}</span>
      <div className={styles.content}>
        <p className={styles.message}>{toast.message}</p>
      </div>
      <button
        type="button"
        className={styles.closeButton}
        onClick={() => onRemove(toast.id)}
        aria-label="Close notification"
      >
        &times;
      </button>
    </div>
  );
}

/**
 * Toast Container rendering active toasts in fixed viewport space.
 */
function ToastContainer({ toasts, onRemove }) {
  if (toasts.length === 0) return null;

  return (
    <div className={styles.container}>
      {toasts.map((toast) => (
        <ToastItemCard key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  );
}

/**
 * ToastProvider manages toast notifications and auto-dismissal.
 * Exposes both `showToast` and a convenience `toast` helper object (like react-hot-toast).
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map());

  const removeToast = useCallback((id) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message, type = 'info', duration = 4000) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const newToast = { id, message, type, duration };

      setToasts((prev) => [...prev, newToast]);

      if (duration > 0) {
        const timer = setTimeout(() => {
          removeToast(id);
        }, duration);
        timersRef.current.set(id, timer);
      }

      return id;
    },
    [removeToast]
  );

  // Convenience methods matching react-hot-toast style
  const toastHelpers = useMemo(
    () => ({
      show: (msg, type = 'info', dur = 4000) => showToast(msg, type, dur),
      success: (msg, dur = 4000) => showToast(msg, 'success', dur),
      error: (msg, dur = 5000) => showToast(msg, 'error', dur),
      warning: (msg, dur = 4500) => showToast(msg, 'warning', dur),
      info: (msg, dur = 3500) => showToast(msg, 'info', dur),
    }),
    [showToast]
  );

  // Cleanup all timers on unmount
  useEffect(() => {
    const currentTimers = timersRef.current;
    return () => {
      currentTimers.forEach((timer) => clearTimeout(timer));
      currentTimers.clear();
    };
  }, []);

  const value = useMemo(
    () => ({
      toasts,
      showToast,
      toast: toastHelpers,
      removeToast,
    }),
    [toasts, showToast, toastHelpers, removeToast]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

export default ToastProvider;
