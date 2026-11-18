import { describe, it, expect, beforeEach } from 'vitest';
import { roomManager } from '../src/models/RoomManager.js';

describe('RoomManager', () => {
  beforeEach(() => {
    // Clear manager internal state between tests
    roomManager.rooms.clear();
  });

  describe('Code format and uniqueness', () => {
    it('should generate a 6-character uppercase alphanumeric room code', () => {
      const room = roomManager.createRoom();
      expect(room.roomId).toMatch(/^[A-Z0-9]{6}$/);
    });

    it('should generate unique codes across multiple room creations', () => {
      const generatedCodes = new Set();
      const numRooms = 100;

      for (let i = 0; i < numRooms; i++) {
        const room = roomManager.createRoom();
        expect(room.roomId).toMatch(/^[A-Z0-9]{6}$/);
        expect(generatedCodes.has(room.roomId)).toBe(false);
        generatedCodes.add(room.roomId);
      }

      expect(generatedCodes.size).toBe(numRooms);
      expect(roomManager.rooms.size).toBe(numRooms);
    });

    it('should retrieve rooms case-insensitively and handle deletions', () => {
      const room = roomManager.createRoom();
      const code = room.roomId;

      expect(roomManager.getRoom(code)).toBe(room);
      expect(roomManager.getRoom(code.toLowerCase())).toBe(room);

      expect(roomManager.deleteIfEmpty(code)).toBe(true);
      expect(roomManager.getRoom(code)).toBeUndefined();
    });
  });
});
