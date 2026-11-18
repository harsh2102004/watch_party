/**
 * @file Participant.js
 * @description Represents a user connected to a watch party room.
 */

import { randomUUID } from 'crypto';
import { Role } from './role.js';

/**
 * @typedef {Object} ParticipantJSON
 * @property {string} userId     - Unique identifier for the participant.
 * @property {string} username   - Display name chosen by the participant.
 * @property {string} role       - The participant's role in the room (see Role).
 * @property {string} joinedAt   - ISO 8601 timestamp of when the participant joined.
 */

/**
 * Represents a participant in a watch party room.
 * The socketId is kept private and excluded from JSON serialization to prevent
 * it from being leaked to other clients.
 */
export class Participant {
  /**
   * @param {Object} options
   * @param {string}  options.username  - Display name for the participant.
   * @param {string}  options.socketId  - Socket.IO socket ID for the connection.
   * @param {string}  [options.role]    - Initial role; defaults to Role.VIEWER.
   * @param {string}  [options.userId]  - Optional pre-assigned UUID; generated if omitted.
   */
  constructor({ username, socketId, role = Role.VIEWER, userId }) {
    /** @type {string} Unique participant identifier (UUID v4). */
    this.userId = userId ?? randomUUID();

    /** @type {string} Display name. */
    this.username = username;

    /**
     * Socket.IO connection ID.
     * Not included in toJSON() — keep off-limits from client payloads.
     * @type {string}
     */
    this.socketId = socketId;

    /** @type {string} Role within the room (see Role enum). */
    this.role = role;

    /** @type {string} ISO 8601 timestamp of when the participant joined. */
    this.joinedAt = new Date().toISOString();
  }

  /**
   * Updates the participant's role.
   * @param {string} newRole - A value from the Role enum.
   * @returns {Participant} This instance (for chaining).
   */
  setRole(newRole) {
    this.role = newRole;
    return this;
  }

  /**
   * Updates the participant's socket ID (e.g. after a reconnect).
   * @param {string} socketId - The new Socket.IO socket ID.
   * @returns {Participant} This instance (for chaining).
   */
  setSocketId(socketId) {
    this.socketId = socketId;
    return this;
  }

  /**
   * Returns a client-safe plain object representation of the participant.
   * Explicitly omits `socketId` to prevent leaking internal connection details.
   *
   * @returns {ParticipantJSON}
   */
  toJSON() {
    return {
      userId: this.userId,
      username: this.username,
      role: this.role,
      joinedAt: this.joinedAt,
    };
  }
}
