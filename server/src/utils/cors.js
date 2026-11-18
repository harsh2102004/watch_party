/**
 * @file cors.js
 * @description Centralized CORS configuration utility for Express and Socket.IO.
 *
 * Interview Decision Notes:
 * 1. Multi-Origin Support:
 *    CLIENT_URL supports comma-separated origins (e.g., local dev + production Vercel).
 * 2. Normalization & Trailing Slash Stripping:
 *    URLs in headers often differ by a trailing slash (e.g. "https://app.vercel.app/").
 *    Stripping slashes and trimming prevents false rejection.
 * 3. Headless / Server-to-Server Requests (No Origin):
 *    Requests from curl, Render internal health checkers, or native tools do not send
 *    an Origin header. Allowing `!origin` ensures monitoring endpoints function reliably.
 * 4. Dynamic Vercel Preview Deployments:
 *    When ALLOW_VERCEL_PREVIEWS=true, branch preview URLs (*.vercel.app) are allowed
 *    automatically without updating production environment variables on every PR.
 * 5. Security & Visibility:
 *    Blocked origins log an explicit warning in server console logs to aid troubleshooting.
 */

/**
 * Parses and normalizes the CLIENT_URL environment variable into an array of allowed origins.
 *
 * @param {string} [clientUrlEnv] - Raw CLIENT_URL environment string.
 * @returns {string[]} List of trimmed, lowercase origins with trailing slashes removed.
 */
export function parseAllowedOrigins(clientUrlEnv = process.env.CLIENT_URL) {
  if (!clientUrlEnv || typeof clientUrlEnv !== 'string') {
    return ['http://localhost:5173'];
  }

  return clientUrlEnv
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/**
 * Checks whether an incoming origin is permitted by the CORS policy.
 *
 * @param {string|undefined} origin - Origin header from incoming HTTP or WebSocket request.
 * @returns {boolean} True if allowed, false if blocked.
 */
export function isOriginAllowed(origin) {
  // Allow requests with no Origin header (health checks, curl, server-to-server, mobile)
  if (!origin) {
    return true;
  }

  const normalized = origin.trim().replace(/\/+$/, '');
  const allowedOrigins = parseAllowedOrigins();

  // Check explicit matches (including wildcard '*')
  if (allowedOrigins.includes('*') || allowedOrigins.includes(normalized)) {
    return true;
  }

  // Check Vercel Preview deployments when enabled
  const allowVercelPreviews = process.env.ALLOW_VERCEL_PREVIEWS === 'true';
  if (allowVercelPreviews) {
    const isVercelPreview = /^https:\/\/[a-zA-Z0-9_.-]+\.vercel\.app$/i.test(normalized);
    if (isVercelPreview) {
      return true;
    }
  }

  // Log warning for unauthorized origins to assist debugging
  console.warn(`[CORS] Blocked request from unauthorized origin: "${origin}"`);
  return false;
}

/**
 * Reusable CORS origin delegate for Express and Socket.IO.
 *
 * @param {string|undefined} origin - Origin from request.
 * @param {(err: Error|null, allow?: boolean) => void} callback - Express/Socket.IO callback.
 */
export function corsOriginDelegate(origin, callback) {
  if (isOriginAllowed(origin)) {
    return callback(null, true);
  }
  return callback(new Error(`[CORS] Origin "${origin}" not allowed by CORS policy.`), false);
}

/**
 * Express CORS middleware options.
 */
export const expressCorsOptions = {
  origin: corsOriginDelegate,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

/**
 * Socket.IO CORS options.
 */
export const socketCorsOptions = {
  origin: corsOriginDelegate,
  methods: ['GET', 'POST'],
  credentials: true,
};
