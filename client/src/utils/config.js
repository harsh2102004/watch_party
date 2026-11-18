/**
 * @file config.js
 * @description Centralized client configuration utility for resolving the backend server URL.
 *
 * Interview Decision Notes:
 * 1. Production Strictness vs. Dev Convenience:
 *    In development (`import.meta.env.DEV`), missing `VITE_SERVER_URL` falls back to `http://localhost:4000`.
 *    In production builds, falling back to localhost or window.location causes silent failed
 *    WebSocket handshakes on Vercel. We return null so the app renders a clear Configuration Error screen.
 * 2. URL Normalization:
 *    Trims whitespace and strips any trailing slashes to ensure socket and fetch calls remain consistent.
 */

/**
 * Returns the resolved server URL string, or null if unconfigured in production.
 *
 * @returns {string|null}
 */
export function getServerUrl() {
  const envUrl = import.meta.env.VITE_SERVER_URL;
  if (typeof envUrl === 'string' && envUrl.trim()) {
    return envUrl.trim().replace(/\/+$/, '');
  }

  // Fall back to localhost:4000 ONLY in development mode
  if (import.meta.env.DEV) {
    return 'http://localhost:4000';
  }

  return null;
}

/**
 * Validates whether the environment configuration is complete for this build.
 *
 * @returns {boolean}
 */
export function isConfigValid() {
  return getServerUrl() !== null;
}
