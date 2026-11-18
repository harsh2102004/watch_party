/**
 * @file socketAuth.js
 * @description Socket.IO handshake authentication middleware.
 *
 * Interview Decision Notes:
 * 1. Token in Handshake Auth:
 *    Socket.IO supports an `auth` object on the handshake (`socket.handshake.auth.token`).
 *    This avoids exposing tokens in query string URL logs or WebSocket upgrade paths.
 * 2. Strict Identity Enforcement:
 *    Once verified, `socket.data.user` stores the authenticated { userId, username }.
 *    Subsequent socket events (create_room, join_room) read identity from `socket.data.user`,
 *    preventing malicious clients from impersonating other users.
 * 3. Configurable Guest Fallback:
 *    When `ALLOW_GUESTS=true` (or not explicitly set to 'false'), unauthenticated users
 *    receive a transient guest identity. When `ALLOW_GUESTS=false`, unauthenticated
 *    sockets are rejected with a clear error during handshake.
 */

import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../routes/auth.js';

/**
 * Socket.IO authentication middleware.
 *
 * @param {import('socket.io').Socket} socket - Incoming client socket.
 * @param {(err?: Error) => void} next - Callback to proceed or reject handshake.
 */
export function socketAuthMiddleware(socket, next) {
  const token = socket.handshake.auth?.token;
  // Guests are allowed unless ALLOW_GUESTS is explicitly configured as 'false'
  const allowGuests = process.env.ALLOW_GUESTS !== 'false';

  if (token) {
    try {
      const decoded = jwt.verify(token, getJwtSecret());
      socket.data.user = {
        userId: decoded.userId,
        username: decoded.username,
        isGuest: false,
      };
      return next();
    } catch (err) {
      return next(new Error('AUTHENTICATION_FAILED: Invalid or expired token.'));
    }
  }

  // No token provided: check if guest mode is enabled
  if (allowGuests) {
    const rawGuestName = socket.handshake.auth?.username || socket.handshake.auth?.guestName;
    let validatedGuestName = null;

    if (rawGuestName) {
      if (typeof rawGuestName !== 'string') {
        return next(new Error('INVALID_USERNAME: Guest name must be a string.'));
      }
      const trimmed = rawGuestName.trim();
      if (trimmed.length < 1 || trimmed.length > 20) {
        return next(new Error('INVALID_USERNAME: Guest name must be between 1 and 20 characters.'));
      }
      validatedGuestName = trimmed;
    }

    socket.data.user = {
      userId: `guest_${socket.id.slice(0, 8)}`,
      username: validatedGuestName,
      isGuest: true,
    };
    return next();
  }

  // Guests are forbidden and no valid token was supplied
  return next(new Error('AUTHENTICATION_REQUIRED: Guest access is disabled. Please log in.'));
}
