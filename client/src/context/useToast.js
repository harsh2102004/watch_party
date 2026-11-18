import { useContext } from 'react';
import { ToastContext } from './ToastContext.js';

/**
 * Custom hook to consume the active Toast notifications context.
 * Throws a descriptive error if called outside of `<ToastProvider>`.
 *
 * @returns {import('./ToastContext.js').ToastContextValue}
 */
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a <ToastProvider>');
  }
  return context;
}
