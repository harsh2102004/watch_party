/**
 * @file Room.js
 * @description Represents a watch party room and manages video playback state and participants.
 */

import { randomUUID } from 'crypto';
import { Role } from './role.js';
import { Participant } from './Participant.js';

/**
 * @typedef {'play' | 'pause' | 'seek' | 'change_video'} RequestType
 */

/**
 * @typedef {Object} PendingRequest
 * @property {string} id - Unique identifier for the pending request.
 * @property {RequestType} type - Action type ('play' | 'pause' | 'seek' | 'change_video').
 * @property {any} [payload] - Optional payload for the request (e.g. { time } or { videoId }).
 * @property {string} requesterId - User ID of the participant who submitted the request.
 * @property {string} requesterName - Username of the participant who submitted the request.
 * @property {number} createdAt - Epoch milliseconds when the request was created.
 */

/**
 * @typedef {'playing' | 'paused'} PlayState
 */

/**
 * Manages the state, video playback, and connected participants for a room.
 */
export class Room {
  /**
   * @param {Object} options
   * @param {string} options.roomId - Unique identifier for the room.
   * @param {string} [options.videoId] - Initial video ID (e.g. YouTube video ID). Defaults to null or empty string.
   * @param {number} [options.currentTime] - Starting playback position in seconds.
   * @param {PlayState} [options.playState] - Starting playback state ('playing' or 'paused').
   */
  constructor({ roomId, videoId = null, currentTime = 0, playState = 'paused' }) {
    /** @type {string} Unique room identifier */
    this.roomId = roomId;

    /** @type {string|null} Current video ID */
    this.videoId = videoId;

    /** @type {PlayState} Current playback state */
    this.playState = playState;

    /** @type {number} Playback timestamp in seconds when state was last updated */
    this.currentTime = currentTime;

    /** @type {number} Milliseconds timestamp (Date.now()) when currentTime and playState were last recorded */
    this.lastUpdatedAt = Date.now();

    /** @type {Map<string, Participant>} Map of participants keyed by userId */
    this.participants = new Map();

    /** @type {Map<string, any>} Map of pending requests (e.g. role promotions, join requests) keyed by identifier */
    this.pendingRequests = new Map();

    /** @type {NodeJS.Timeout|null} Active sweeper interval timer for expiring pending requests */
    this.sweeperTimer = null;

    /** @type {Array<{ id: string, userId: string, username: string, role: string, text: string, timestamp: number }>} Last 50 messages for late joiners */
    this.chatHistory = [];

    /** @type {Map<string, { userId: string, username: string, role: string, disconnectedAt: number }>} Map of disconnected participants for role restoration */
    this.disconnectedParticipants = new Map();
  }

  /**
   * Computes the current playback timestamp.
   * If currently playing, extrapolates based on milliseconds elapsed since lastUpdatedAt.
   *
   * @returns {number} Current playback time in seconds.
   */
  getComputedTime() {
    if (this.playState === 'playing') {
      const elapsedSeconds = (Date.now() - this.lastUpdatedAt) / 1000;
      return this.currentTime + elapsedSeconds;
    }
    return this.currentTime;
  }

  /**
   * Updates playback state and synchronizes timestamps.
   *
   * @param {PlayState} state - 'playing' or 'paused'
   * @param {number} [time] - Current playback timestamp in seconds. If omitted, uses computed time.
   */
  setPlaybackState(state, time) {
    this.currentTime = typeof time === 'number' ? time : this.getComputedTime();
    this.playState = state;
    this.lastUpdatedAt = Date.now();
  }

  /**
   * Updates current video ID and resets playback timing.
   *
   * @param {string} videoId - The new video ID.
   */
  setVideo(videoId) {
    this.videoId = videoId;
    this.currentTime = 0;
    this.playState = 'paused';
    this.lastUpdatedAt = Date.now();
  }

  /**
   * Starts playback from current computed time.
   */
  play() {
    this.setPlaybackState('playing', this.getComputedTime());
  }

  /**
   * Pauses playback at current computed time.
   */
  pause() {
    this.setPlaybackState('paused', this.getComputedTime());
  }

  /**
   * Seeks to a specific timestamp in seconds.
   *
   * @param {number} time - Non-negative target timestamp.
   */
  seek(time) {
    this.setPlaybackState(this.playState, time);
  }

  /**
   * Changes the video ID and pauses at position 0.
   *
   * @param {string} videoId - New video ID.
   */
  changeVideo(videoId) {
    this.setVideo(videoId);
  }

  /**
   * Executes a playback action on the room state.
   * Shared by direct event handlers and request approvals.
   *
   * @param {RequestType} type - 'play' | 'pause' | 'seek' | 'change_video'
   * @param {any} [payload] - Optional payload for action
   */
  applyAction(type, payload = {}) {
    switch (type) {
      case 'play':
        this.play();
        break;
      case 'pause':
        this.pause();
        break;
      case 'seek':
        this.seek(payload.time);
        break;
      case 'change_video':
        this.changeVideo(payload.videoId);
        break;
      default:
        throw new Error(`Unsupported action type "${type}".`);
    }
  }

  /**
   * Adds a participant to the room.
   *
   * @param {Participant} participant - The participant instance to add.
   * @returns {Participant}
   */
  addParticipant(participant) {
    this.participants.set(participant.userId, participant);
    return participant;
  }

  /**
   * Removes a participant from the room by their userId.
   *
   * @param {string} userId - The participant's userId.
   * @returns {boolean} True if participant was found and removed, false otherwise.
   */
  removeParticipant(userId) {
    return this.participants.delete(userId);
  }

  /**
   * Retrieves a participant by their userId.
   *
   * @param {string} userId - The participant's userId.
   * @returns {Participant|undefined}
   */
  getParticipant(userId) {
    return this.participants.get(userId);
  }

  /**
   * Finds a participant by their Socket.IO socketId.
   *
   * @param {string} socketId - The socketId to search for.
   * @returns {Participant|undefined}
   */
  getParticipantBySocket(socketId) {
    for (const participant of this.participants.values()) {
      if (participant.socketId === socketId) {
        return participant;
      }
    }
    return undefined;
  }

  /**
   * Updates the role of a participant.
   *
   * @param {string} userId - Target participant's userId.
   * @param {string} newRole - Value from Role enum.
   * @returns {Participant|null} Updated participant or null if not found.
   */
  setRole(userId, newRole) {
    const participant = this.getParticipant(userId);
    if (!participant) {
      return null;
    }
    participant.setRole(newRole);
    return participant;
  }

  /**
   * Finds the HOST of the room.
   *
   * @returns {Participant|undefined}
   */
  getHost() {
    for (const participant of this.participants.values()) {
      if (participant.role === Role.HOST) {
        return participant;
      }
    }
    return undefined;
  }

  /**
   * Returns a list of participant objects safe for sending to clients (toJSON).
   *
   * @returns {Array<import('./Participant.js').ParticipantJSON>}
   */
  getParticipantsList() {
    return Array.from(this.participants.values()).map((p) => p.toJSON());
  }

  /**
   * Checks if a username is already taken by an active participant in this room (case-insensitive).
   *
   * @param {string} username - Username to verify.
   * @param {string} [excludeUserId] - Optional userId to ignore (for reconnecting users).
   * @returns {boolean} True if taken, false if available.
   */
  isUsernameTaken(username, excludeUserId = null) {
    const normalized = username.trim().toLowerCase();
    for (const participant of this.participants.values()) {
      if (excludeUserId && participant.userId === excludeUserId) {
        continue;
      }
      if (participant.username.trim().toLowerCase() === normalized) {
        return true;
      }
    }
    return false;
  }

  /**
   * Caches a participant's role upon disconnect for role restoration if they reconnect.
   *
   * @param {Participant} participant
   */
  saveDisconnectedParticipant(participant) {
    if (participant && participant.userId) {
      this.disconnectedParticipants.set(participant.userId, {
        userId: participant.userId,
        username: participant.username,
        role: participant.role,
        disconnectedAt: Date.now(),
      });
    }
  }

  /**
   * Retrieves previous role of a disconnected user.
   *
   * @param {string} userId
   * @returns {string|undefined}
   */
  getDisconnectedRole(userId) {
    if (!userId) return undefined;
    return this.disconnectedParticipants.get(userId)?.role;
  }

  /**
   * Removes disconnected participant record once restored.
   *
   * @param {string} userId
   */
  clearDisconnectedParticipant(userId) {
    if (userId) {
      this.disconnectedParticipants.delete(userId);
    }
  }

  /**
   * Checks if the room has no connected participants.
   *
   * @returns {boolean}
   */
  isEmpty() {
    return this.participants.size === 0;
  }

  // ---------------------------------------------------------------------------
  // Pending request management
  // ---------------------------------------------------------------------------

  /**
   * Adds a pending request to the room.
   *
   * @param {Object} request
   * @param {string} [request.id] - Optional ID; generated if omitted.
   * @param {RequestType} request.type - One of 'play'|'pause'|'seek'|'change_video'.
   * @param {any} [request.payload] - Payload associated with the action.
   * @param {string} request.requesterId - User ID of the requester.
   * @param {string} request.requesterName - Username of the requester.
   * @param {number} [request.createdAt] - Creation timestamp in ms (defaults to Date.now()).
   * @returns {PendingRequest} The stored request object.
   */
  addRequest(request) {
    if (!request || typeof request !== 'object') {
      throw new Error('Request must be an object.');
    }

    const validTypes = ['play', 'pause', 'seek', 'change_video'];
    if (!validTypes.includes(request.type)) {
      throw new Error(`Invalid request type "${request.type}". Must be one of: ${validTypes.join(', ')}`);
    }

    const id = typeof request.id === 'string' && request.id.trim() ? request.id.trim() : randomUUID();
    const newRequest = {
      id,
      type: request.type,
      payload: request.payload ?? {},
      requesterId: request.requesterId,
      requesterName: request.requesterName,
      createdAt: typeof request.createdAt === 'number' ? request.createdAt : Date.now(),
    };

    this.pendingRequests.set(id, newRequest);
    return newRequest;
  }

  /**
   * Retrieves a pending request by ID.
   *
   * @param {string} id - The request ID.
   * @returns {PendingRequest|undefined}
   */
  getRequest(id) {
    return this.pendingRequests.get(id);
  }

  /**
   * Removes a pending request by ID.
   *
   * @param {string} id - The request ID.
   * @returns {boolean} True if removed, false if not found.
   */
  removeRequest(id) {
    return this.pendingRequests.delete(id);
  }

  /**
   * Returns a list of all currently pending requests in this room.
   *
   * @returns {Array<PendingRequest>}
   */
  getPendingList() {
    return Array.from(this.pendingRequests.values());
  }

  /**
   * Removes pending requests older than ttlMs milliseconds.
   *
   * @param {number} [ttlMs=60000] - Time-to-live threshold in milliseconds.
   * @returns {Array<PendingRequest>} List of expired requests that were removed.
   */
  cleanExpired(ttlMs = 60000) {
    if (typeof ttlMs !== 'number' || ttlMs <= 0) return [];
    const now = Date.now();
    const removed = [];

    for (const [id, req] of this.pendingRequests) {
      if (now - req.createdAt >= ttlMs) {
        removed.push(req);
        this.pendingRequests.delete(id);
      }
    }

    return removed;
  }

  /**
   * Clears any active timer associated with this room.
   */
  clearTimers() {
    if (this.sweeperTimer) {
      clearInterval(this.sweeperTimer);
      this.sweeperTimer = null;
    }
  }

  /**
   * Destroys room resources and clears active timers.
   */
  destroy() {
    this.clearTimers();
  }

  /**
   * Appends a chat message to room history, keeping at most 50 messages.
   *
   * @param {Object} message
   * @param {string} message.id
   * @param {string} message.userId
   * @param {string} message.username
   * @param {string} message.role
   * @param {string} message.text
   * @param {number} message.timestamp
   * @returns {Object} Stored message
   */
  addChatMessage(message) {
    if (!message || typeof message !== 'object') {
      throw new Error('Message must be an object.');
    }
    this.chatHistory.push(message);
    while (this.chatHistory.length > 50) {
      this.chatHistory.shift();
    }
    return message;
  }

  /**
   * Returns a copy of the cached chat history for late joiners (up to 50 messages).
   *
   * @returns {Array<{ id: string, userId: string, username: string, role: string, text: string, timestamp: number }>}
   */
  getChatHistory() {
    return [...this.chatHistory];
  }

  /**
   * Returns a JSON-serializable representation of the room state for clients.
   *
   * @returns {Object}
   */
  toJSON() {
    return {
      roomId: this.roomId,
      videoId: this.videoId,
      playState: this.playState,
      currentTime: this.getComputedTime(),
      lastUpdatedAt: this.lastUpdatedAt,
      participants: this.getParticipantsList(),
      chatHistory: this.getChatHistory(),
    };
  }
}
