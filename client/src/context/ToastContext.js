import { createContext } from 'react';

/**
 * @typedef {'info' | 'success' | 'warning' | 'error'} ToastType
 */

/**
 * @typedef {Object} ToastItem
 * @property {string} id - Unique identifier for the toast.
 * @property {string} message - Notification text.
 * @property {ToastType} type - Notification severity level.
 * @property {number} duration - Auto-dismiss timeout in ms.
 */

/**
 * @typedef {Object} ToastHelpers
 * @property {(message: string, duration?: number) => string} success - Displays a success toast.
 * @property {(message: string, duration?: number) => string} error - Displays an error toast.
 * @property {(message: string, duration?: number) => string} warning - Displays a warning toast.
 * @property {(message: string, duration?: number) => string} info - Displays an info toast.
 * @property {(message: string, type?: ToastType, duration?: number) => string} show - Displays a toast with custom type.
 */

/**
 * @typedef {Object} ToastContextValue
 * @property {ToastItem[]} toasts - List of currently active toasts.
 * @property {(message: string, type?: ToastType, duration?: number) => string} showToast - Displays a new toast.
 * @property {ToastHelpers} toast - Convenience helper methods for triggering toasts.
 * @property {(id: string) => void} removeToast - Dismisses an existing toast by ID.
 */

/** @type {import('react').Context<ToastContextValue | null>} */
export const ToastContext = createContext(null);
