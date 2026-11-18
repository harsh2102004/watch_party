/**
 * @file ReactionHandler.js
 * @description Dedicated handler module for real-time room emoji reactions.
 * Enforces an authoritative whitelist of 6 emojis, sliding-window rate limiting
 * per user, and broadcasts valid reactions to all connected room members.
 */

import { emitError } from './MessageHandler.js';

/**
 * Authoritative whitelist of allowed reaction emojis.
 * @readonly
 */
export const ALLOWED_REACTIONS = Object.freeze([
  '❤️',
  '🔥',
  '😂',
  '🎉',
  '😮',
  '👏',
]);

/**
 * ReactionHandler manages socket event subscriptions and validation for room emoji reactions.
 */
export class ReactionHandler {
  /**
   * @param {import('socket.io').Server} io - The Socket.IO server instance.
   * @param {import('../models/RoomManager.js').RoomManager} roomManager - Shared RoomManager singleton.
   * @param {Object} [options]
   * @param {string[]} [options.allowedReactions] - Custom allowed emojis whitelist.
   * @param {number} [options.rateLimitMax=10] - Maximum reactions allowed in the rate limit window.
   * @param {number} [options.rateLimitWindowMs=5000] - Duration of the rate limit window in milliseconds (5s).
   */
  constructor(io, roomManager, options = {}) {
    this.io = io;
    this.roomManager = roomManager;
    this.allowedReactions = new Set(options.allowedReactions ?? ALLOWED_REACTIONS);
    this.rateLimitMax = options.rateLimitMax ?? 10;
    this.rateLimitWindowMs = options.rateLimitWindowMs ?? 5000;

    /** @type {Map<string, Array<number>>} Map of userId -> array of reaction timestamps (ms) */
    this.userTimestamps = new Map();
  }

  /**
   * Registers the "reaction" event listener on the given socket.
   *
   * @param {import('socket.io').Socket} socket
   */
  register(socket) {
    socket.on('reaction', (data) => this.handleReaction(socket, data));
  }

  /**
   * Resolves the room and participant matching the current socket connection.
   *
   * @private
   * @param {import('socket.io').Socket} socket
   * @param {any} [data]
   * @returns {{ room: import('../models/Room.js').Room|null, participant: import('../models/Participant.js').Participant|null }}
   */
  #getRoomAndParticipant(socket, data) {
    if (data?.roomId) {
      const room = this.roomManager.getRoom(data.roomId);
      if (room) {
        const participant = room.getParticipantBySocket(socket.id);
        if (participant) return { room, participant };
      }
    }

    if (this.roomManager.rooms) {
      for (const [, room] of this.roomManager.rooms) {
        const participant = room.getParticipantBySocket(socket.id);
        if (participant) return { room, participant };
      }
    }

    return { room: null, participant: null };
  }

  /**
   * Evaluates and updates the sliding-window rate limit for a user.
   *
   * @private
   * @param {string} userId - User identifier.
   * @returns {boolean} True if allowed; false if rate limited.
   */
  #checkRateLimit(userId) {
    const now = Date.now();
    const windowStart = now - this.rateLimitWindowMs;

    let timestamps = this.userTimestamps.get(userId);
    if (!timestamps) {
      timestamps = [];
      this.userTimestamps.set(userId, timestamps);
    }

    // Filter out timestamps outside current sliding window
    timestamps = timestamps.filter((t) => t > windowStart);
    this.userTimestamps.set(userId, timestamps);

    if (timestamps.length >= this.rateLimitMax) {
      return false;
    }

    timestamps.push(now);
    return true;
  }

  /**
   * Handles incoming "reaction" event from a socket.
   *
   * @param {import('socket.io').Socket} socket
   * @param {{ emoji: string, roomId?: string }} data
   */
  handleReaction(socket, data) {
    // 1. Enforce room membership
    const { room, participant } = this.#getRoomAndParticipant(socket, data);
    if (!room || !participant) {
      return emitError(socket, 'NOT_IN_ROOM', 'You are not in a room.');
    }

    // 2. Validate emoji payload
    const rawEmoji = typeof data === 'string' ? data : data?.emoji;
    if (typeof rawEmoji !== 'string' || !rawEmoji.trim()) {
      return emitError(socket, 'INVALID_REACTION', 'Reaction emoji cannot be empty.');
    }

    const emoji = rawEmoji.trim();
    if (!this.allowedReactions.has(emoji)) {
      return emitError(
        socket,
        'INVALID_REACTION',
        `Emoji "${emoji}" is not in the allowed reaction whitelist.`
      );
    }

    // 3. Enforce sliding-window rate limit (10 reactions per 5s)
    if (!this.#checkRateLimit(participant.userId)) {
      return emitError(
        socket,
        'RATE_LIMITED',
        `Reaction rate limit exceeded: Maximum ${this.rateLimitMax} reactions per ${this.rateLimitWindowMs / 1000} seconds allowed.`
      );
    }

    // 4. Construct reaction broadcast payload
    const reactionPayload = {
      emoji,
      userId: participant.userId,
      username: participant.username,
      timestamp: Date.now(),
    };

    // 5. Broadcast reaction event to the entire room
    this.io.to(room.roomId).emit('reaction', reactionPayload);
  }

  /**
   * Clears the in-memory rate limiting map.
   */
  resetRateLimits() {
    this.userTimestamps.clear();
  }
}

export default ReactionHandler;
