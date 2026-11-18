/**
 * @file connect.js
 * @description Manages MongoDB connection via Mongoose with event logging,
 * exponential backoff retries, and a non-blocking fallback to memory-only mode.
 *
 * Interview Decision Notes:
 * 1. Non-blocking initialization: Server starts listening for WebSocket & HTTP clients
 *    immediately even if MongoDB is slow or unreachable.
 * 2. readyState checking: isDbConnected() inspects mongoose.connection.readyState === 1
 *    so callers can skip DB operations without waiting on timeouts.
 * 3. Graceful degradation: Connection failures log warnings instead of throwing errors.
 */

import mongoose from 'mongoose';

const INITIAL_RETRY_DELAY_MS = 2000;
const MAX_RETRY_DELAY_MS = 30000;

let retryTimer = null;
let currentRetryDelay = INITIAL_RETRY_DELAY_MS;
let isConfigured = false;

/**
 * Checks whether MongoDB is actively connected and ready for queries.
 * readyState: 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
 *
 * @returns {boolean} True if connected and ready.
 */
export function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

/**
 * Returns the current database status string.
 *
 * @returns {'connected' | 'disconnected' | 'disabled'}
 */
export function getDbStatus() {
  if (!isConfigured) return 'disabled';
  return isDbConnected() ? 'connected' : 'disconnected';
}

/**
 * Connects to MongoDB using process.env.MONGODB_URI with automatic retries and backoff.
 * This function returns a promise that resolves immediately without blocking server startup.
 *
 * @param {string} [uri] - Optional URI override (for testing).
 * @returns {Promise<boolean>} Resolves to true if initial attempt succeeded, false otherwise.
 */
export async function connectDb(uri) {
  const connectionUri = uri || process.env.MONGODB_URI;

  if (!connectionUri) {
    console.warn('[MongoDB] MONGODB_URI is not set. Operating in memory-only mode.');
    isConfigured = false;
    return false;
  }

  isConfigured = true;

  // Set up connection event listeners once
  if (mongoose.connection.listenerCount('connected') === 0) {
    mongoose.connection.on('connected', () => {
      console.log('[MongoDB] Connected successfully.');
      currentRetryDelay = INITIAL_RETRY_DELAY_MS;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    });

    mongoose.connection.on('error', (err) => {
      console.warn(`[MongoDB] Connection error: ${err.message}. Running in memory-only mode.`);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('[MongoDB] Disconnected. Running in memory-only mode.');
      scheduleRetry(connectionUri);
    });
  }

  try {
    await mongoose.connect(connectionUri, {
      serverSelectionTimeoutMS: 5000,
    });
    return true;
  } catch (err) {
    console.warn(`[MongoDB] Initial connection failed: ${err.message}. Running in memory-only mode.`);
    scheduleRetry(connectionUri);
    return false;
  }
}

/**
 * Schedules an automatic retry with exponential backoff.
 *
 * @param {string} uri
 */
function scheduleRetry(uri) {
  if (retryTimer || !isConfigured) return;

  retryTimer = setTimeout(async () => {
    retryTimer = null;
    console.log(`[MongoDB] Retrying connection (delay: ${currentRetryDelay / 1000}s)...`);
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    } catch {
      currentRetryDelay = Math.min(currentRetryDelay * 2, MAX_RETRY_DELAY_MS);
      scheduleRetry(uri);
    }
  }, currentRetryDelay);
}

/**
 * Closes the active database connection and clears retry timers (useful in test teardown).
 */
export async function closeDb() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  isConfigured = false;
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
