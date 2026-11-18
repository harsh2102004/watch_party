/**
 * @file ChatHandler.js
 * @description Dedicated handler module for real-time room chat messages.
 * Enforces text trimming, 300 character maximum, HTML stripping and escaping,
 * sliding-window rate limiting (5 messages per 10 seconds per user), message history
 * caching (up to 50 messages), and broadcasting to the room channel.
 */

import { randomUUID } from 'crypto';
import { emitError } from './MessageHandler.js';
import { roomRepository } from '../services/RoomRepository.js';

/**
 * Strips HTML tags and escapes HTML entities to prevent Cross-Site Scripting (XSS).
 *
 * @param {string} text - Raw input string.
 * @returns {string} Sanitized string safe for client rendering.
 */
export function stripAndEscapeHtml(text) {
  if (typeof text !== 'string') return '';
  // 1. Strip all HTML opening/closing tags and comments
  const stripped = text.replace(/<[a-zA-Z\/!][^>]*>/g, '');
  // 2. Escape special HTML entities
  return stripped
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * ChatHandler manages socket event subscriptions and validation for room chat.
 */
export class ChatHandler {
  /**
   * @param {import('socket.io').Server} io - The Socket.IO server instance.
   * @param {import('../models/RoomManager.js').RoomManager} roomManager - Shared RoomManager singleton.
   * @param {Object} [options]
   * @param {number} [options.maxMessageLength=300] - Maximum message character limit.
   * @param {number} [options.rateLimitMax=5] - Maximum messages allowed in the rate limit window.
   * @param {number} [options.rateLimitWindowMs=10000] - Duration of the rate limit window in milliseconds (10s).
   */
  constructor(io, roomManager, options = {}) {
    this.io = io;
    this.roomManager = roomManager;
    this.maxMessageLength = options.maxMessageLength ?? 300;
    this.rateLimitMax = options.rateLimitMax ?? 5;
    this.rateLimitWindowMs = options.rateLimitWindowMs ?? 10000;

    /** @type {Map<string, Array<number>>} Map of userId -> array of message send epoch timestamps (ms) */
    this.userTimestamps = new Map();
  }

  /**
   * Registers the "chat_message" event listener on the given socket.
   *
   * @param {import('socket.io').Socket} socket
   */
  register(socket) {
    socket.on('chat_message', (data) => this.handleChatMessage(socket, data));
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

    for (const [, room] of this.roomManager.rooms) {
      const participant = room.getParticipantBySocket(socket.id);
      if (participant) return { room, participant };
    }

    return { room: null, participant: null };
  }

  /**
   * Checks whether the user is within the rate limit (5 messages per 10 seconds).
   *
   * @private
   * @param {string} userId
   * @returns {boolean} True if within limit, false if rate limited.
   */
  #checkRateLimit(userId) {
    const now = Date.now();
    const windowStart = now - this.rateLimitWindowMs;
    const history = (this.userTimestamps.get(userId) || []).filter((t) => t > windowStart);

    if (history.length >= this.rateLimitMax) {
      return false;
    }

    history.push(now);
    this.userTimestamps.set(userId, history);
    return true;
  }

  /**
   * Handles "chat_message" event.
   * Validates room membership, enforces sliding-window rate limit, validates message length,
   * strips and escapes HTML tags, stores in room history, and broadcasts to room members.
   *
   * @param {import('socket.io').Socket} socket
   * @param {{ text: string, roomId?: string }} data
   */
  handleChatMessage(socket, data) {
    // 1. Enforce room membership
    const { room, participant } = this.#getRoomAndParticipant(socket, data);
    if (!room || !participant) {
      return emitError(socket, 'NOT_IN_ROOM', 'You are not in a room.');
    }

    // 2. Enforce per-user rate limit (5 messages per 10 seconds)
    if (!this.#checkRateLimit(participant.userId)) {
      return emitError(
        socket,
        'RATE_LIMITED',
        `Rate limit exceeded: Maximum ${this.rateLimitMax} messages per ${this.rateLimitWindowMs / 1000} seconds allowed.`
      );
    }

    // 3. Validate text payload
    const rawText = typeof data === 'string' ? data : data?.text;
    if (typeof rawText !== 'string' || !rawText.trim()) {
      return emitError(socket, 'INVALID_MESSAGE', 'Message text cannot be empty.');
    }

    const trimmed = rawText.trim();
    if (trimmed.length > this.maxMessageLength) {
      return emitError(
        socket,
        'MESSAGE_TOO_LONG',
        `Message cannot exceed ${this.maxMessageLength} characters.`
      );
    }

    // 4. Strip and escape HTML to prevent XSS
    const sanitizedText = stripAndEscapeHtml(trimmed);
    if (!sanitizedText.trim()) {
      return emitError(socket, 'INVALID_MESSAGE', 'Message cannot be empty.');
    }

    // 5. Build authoritative chat message payload
    const chatMessage = {
      id: randomUUID(),
      userId: participant.userId,
      username: participant.username,
      role: participant.role,
      text: sanitizedText,
      timestamp: Date.now(),
    };

    // 6. Cache in Room model (keeps last 50 messages for late joiners)
    room.addChatMessage(chatMessage);

    // 7. Persist message to MongoDB (fire-and-forget, non-blocking)
    roomRepository.saveMessage(room.roomId, chatMessage);

    // 8. Broadcast chat_message event to the entire room
    this.io.to(room.roomId).emit('chat_message', chatMessage);
  }

  /**
   * Clears the in-memory rate limiting map.
   */
  resetRateLimits() {
    this.userTimestamps.clear();
  }
}

export default ChatHandler;
