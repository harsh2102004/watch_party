/**
 * @file RoomManager.js
 * @description In-memory manager for watch party rooms.
 */

import { Room } from './Room.js';

const CODE_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const CODE_LENGTH = 6;
const MAX_COLLISION_RETRIES = 100;

/**
 * Generates a random 6-character uppercase alphanumeric code.
 * @returns {string}
 */
function generateRoomCode() {
  let result = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    const randomIndex = Math.floor(Math.random() * CODE_CHARACTERS.length);
    result += CODE_CHARACTERS[randomIndex];
  }
  return result;
}

/**
 * Singleton class to manage active rooms in the server.
 */
export class RoomManager {
  constructor() {
    /** @type {Map<string, Room>} Map of rooms keyed by roomId */
    this.rooms = new Map();
  }

  /**
   * Creates a new Room with a unique 6-character uppercase alphanumeric code.
   * Retries on collision up to MAX_COLLISION_RETRIES.
   *
   * @param {Object} [initialOptions={}] - Optional initial parameters for Room.
   * @returns {Room} The newly created room instance.
   * @throws {Error} If a unique code could not be generated within maximum attempts.
   */
  createRoom(initialOptions = {}) {
    let roomId = '';
    let attempts = 0;

    do {
      if (attempts >= MAX_COLLISION_RETRIES) {
        throw new Error('Failed to generate a unique room code after maximum retries');
      }
      roomId = generateRoomCode();
      attempts++;
    } while (this.rooms.has(roomId));

    const room = new Room({ ...initialOptions, roomId });
    this.rooms.set(roomId, room);
    return room;
  }

  /**
   * Retrieves a room by its roomId.
   *
   * @param {string} roomId - The unique room code.
   * @returns {Room|undefined} The room instance if found, otherwise undefined.
   */
  getRoom(roomId) {
    if (!roomId) return undefined;
    return this.rooms.get(roomId.toUpperCase());
  }

  /**
   * Deletes a room by its roomId and clears active timers.
   *
   * @param {string} roomId - The unique room code.
   * @returns {boolean} True if the room was found and deleted, otherwise false.
   */
  deleteRoom(roomId) {
    if (!roomId) return false;
    const room = this.rooms.get(roomId.toUpperCase());
    if (room) {
      if (typeof room.clearTimers === 'function') {
        room.clearTimers();
      }
      return this.rooms.delete(roomId.toUpperCase());
    }
    return false;
  }

  /**
   * Clears all rooms and their active timers.
   */
  clear() {
    for (const room of this.rooms.values()) {
      if (typeof room.clearTimers === 'function') {
        room.clearTimers();
      }
    }
    this.rooms.clear();
  }

  /**
   * Checks if a room exists and is empty; if so, removes it.
   *
   * @param {string} roomId - The unique room code.
   * @returns {boolean} True if the room existed and was deleted because it was empty, false otherwise.
   */
  deleteIfEmpty(roomId) {
    const room = this.getRoom(roomId);
    if (room && room.isEmpty()) {
      return this.deleteRoom(roomId);
    }
    return false;
  }
}

/**
 * Export a single shared singleton instance.
 */
export const roomManager = new RoomManager();
export default roomManager;
