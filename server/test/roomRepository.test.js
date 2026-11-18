import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { RoomRepository, roomRepository } from '../src/services/RoomRepository.js';
import { RoomDoc } from '../src/db/models/RoomDoc.js';
import { Message } from '../src/db/models/Message.js';
import { RoomManager } from '../src/models/RoomManager.js';
import { MessageHandler } from '../src/handlers/MessageHandler.js';
import { Role } from '../src/models/role.js';
import * as connectModule from '../src/db/connect.js';

function makeMockSocket(id = 'mock-sock') {
  const events = {};
  return {
    id,
    data: {},
    emit: vi.fn(),
    join: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn().mockResolvedValue(undefined),
    to: vi.fn().mockReturnValue({ emit: vi.fn() }),
    on: (event, cb) => {
      events[event] = cb;
    },
    trigger: async (event, data) => {
      return events[event]?.(data);
    },
  };
}

describe('Mongoose RoomRepository & MongoDB Persistence Lifecycle', () => {
  let roomManager;

  beforeEach(() => {
    roomManager = new RoomManager();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('DB Connected Path (Live Mongoose Operations)', () => {
    it('should save room and update video using RoomDoc model', async () => {
      vi.spyOn(connectModule, 'isDbConnected').mockReturnValue(true);

      const findOneAndUpdateSpy = vi.spyOn(RoomDoc, 'findOneAndUpdate').mockReturnValue({
        exec: vi.fn().mockResolvedValue({ roomId: 'TEST01', videoId: 'vid-1' }),
      });

      const updateOneSpy = vi.spyOn(RoomDoc, 'updateOne').mockReturnValue({
        exec: vi.fn().mockResolvedValue({ acknowledged: true }),
      });

      // 1. saveRoom
      roomRepository.saveRoom({ roomId: 'TEST01', videoId: 'vid-1' });
      expect(findOneAndUpdateSpy).toHaveBeenCalledWith(
        { roomId: 'TEST01' },
        expect.objectContaining({
          $setOnInsert: expect.objectContaining({ roomId: 'TEST01' }),
          $set: expect.objectContaining({ videoId: 'vid-1' }),
        }),
        expect.any(Object)
      );

      // 2. updateVideo
      roomRepository.updateVideo('TEST01', 'vid-2');
      expect(updateOneSpy).toHaveBeenCalledWith(
        { roomId: 'TEST01' },
        expect.objectContaining({
          $set: expect.objectContaining({ videoId: 'vid-2' }),
        }),
        expect.any(Object)
      );

      // 3. touchRoom
      roomRepository.touchRoom('TEST01');
      expect(updateOneSpy).toHaveBeenCalledTimes(2);
    });

    it('should find room and restore it into memory with videoId and chat history', async () => {
      vi.spyOn(connectModule, 'isDbConnected').mockReturnValue(true);

      // Mock RoomDoc.findOne
      vi.spyOn(RoomDoc, 'findOne').mockReturnValue({
        maxTimeMS: vi.fn().mockReturnThis(),
        lean: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue({
          roomId: 'REST01',
          videoId: 'persisted-video-id',
          createdAt: new Date(),
          lastActiveAt: new Date(),
        }),
      });

      // Mock Message.find
      vi.spyOn(Message, 'find').mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maxTimeMS: vi.fn().mockReturnThis(),
        lean: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          {
            _id: 'msg-1',
            userId: 'user-bob',
            username: 'Bob',
            text: 'Hello world',
            timestamp: 1700000000000,
          },
        ]),
      });

      const io = {
        to: vi.fn().mockReturnValue({ emit: vi.fn() }),
      };
      const handler = new MessageHandler(io, roomManager);

      // Join room that is not currently in memory
      const aliceSocket = makeMockSocket('alice-sock');
      handler.register(aliceSocket);
      await aliceSocket.trigger('join_room', { roomId: 'REST01', username: 'Alice' });

      // Join call received room_joined
      const joinCall = aliceSocket.emit.mock.calls.find(([e]) => e === 'room_joined');
      expect(joinCall).toBeDefined();

      // Alice should be HOST because nobody was present in restored room
      expect(joinCall[1].role).toBe(Role.HOST);
      expect(joinCall[1].sync_state.videoId).toBe('persisted-video-id');
      expect(joinCall[1].sync_state.playState).toBe('paused');
      expect(joinCall[1].sync_state.currentTime).toBe(0);

      // Chat history should be restored
      expect(joinCall[1].chat_history).toHaveLength(1);
      expect(joinCall[1].chat_history[0].text).toBe('Hello world');

      // Verify room is now active in RoomManager
      const restoredRoom = roomManager.getRoom('REST01');
      expect(restoredRoom).toBeDefined();
      expect(restoredRoom.getHost().username).toBe('Alice');
    });

    it('should save chat message to Message model', async () => {
      vi.spyOn(connectModule, 'isDbConnected').mockReturnValue(true);
      const createSpy = vi.spyOn(Message, 'create').mockResolvedValue({});

      roomRepository.saveMessage('ROOM01', {
        userId: 'u1',
        username: 'Alice',
        text: 'Test message',
        timestamp: 12345,
      });

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          roomId: 'ROOM01',
          userId: 'u1',
          username: 'Alice',
          text: 'Test message',
        })
      );
    });
  });

  describe('DB Disabled / Disconnected Path (Memory-Only Mode)', () => {
    it('should return null or [] immediately when db is disconnected without throwing', async () => {
      vi.spyOn(connectModule, 'isDbConnected').mockReturnValue(false);

      expect(() => roomRepository.saveRoom({ roomId: 'DISC01' })).not.toThrow();
      expect(() => roomRepository.updateVideo('DISC01', 'vid')).not.toThrow();
      expect(() => roomRepository.touchRoom('DISC01')).not.toThrow();
      expect(() => roomRepository.saveMessage('DISC01', { text: 'hi' })).not.toThrow();

      const found = await roomRepository.findRoom('DISC01');
      expect(found).toBeNull();

      const messages = await roomRepository.getRecentMessages('DISC01');
      expect(messages).toEqual([]);
    });

    it('should return ROOM_NOT_FOUND if room not in memory and db is disconnected', async () => {
      vi.spyOn(connectModule, 'isDbConnected').mockReturnValue(false);

      const io = { to: vi.fn().mockReturnValue({ emit: vi.fn() }) };
      const handler = new MessageHandler(io, roomManager);

      const socket = makeMockSocket('test-sock');
      handler.register(socket);

      await socket.trigger('join_room', { roomId: 'NONEXISTENT', username: 'Bob' });

      const errCall = socket.emit.mock.calls.find(([e]) => e === 'error_event');
      expect(errCall).toBeDefined();
      expect(errCall[1].code).toBe('ROOM_NOT_FOUND');
    });
  });

  describe('Fault Tolerance & Non-Blocking Isolation', () => {
    it('should never break socket handlers if repository function throws or rejects', async () => {
      vi.spyOn(connectModule, 'isDbConnected').mockReturnValue(true);

      // Simulate a repository method rejecting unexpectedly
      vi.spyOn(RoomDoc, 'findOne').mockImplementation(() => {
        throw new Error('Simulated MongoNetworkTimeoutError');
      });

      const io = { to: vi.fn().mockReturnValue({ emit: vi.fn() }) };
      const handler = new MessageHandler(io, roomManager);

      const socket = makeMockSocket('safe-sock');
      handler.register(socket);

      // Handler must catch gracefully and emit ROOM_NOT_FOUND instead of crashing
      await expect(socket.trigger('join_room', { roomId: 'FAIL01', username: 'Alice' })).resolves.not.toThrow();

      const errCall = socket.emit.mock.calls.find(([e]) => e === 'error_event');
      expect(errCall).toBeDefined();
      expect(errCall[1].code).toBe('ROOM_NOT_FOUND');
    });

    it('should perform writes as fire-and-forget without delaying socket flow', async () => {
      vi.spyOn(connectModule, 'isDbConnected').mockReturnValue(true);

      // Simulate a slow database write that takes 2000ms
      let writeFinished = false;
      vi.spyOn(RoomDoc, 'findOneAndUpdate').mockReturnValue({
        exec: () =>
          new Promise((resolve) => {
            setTimeout(() => {
              writeFinished = true;
              resolve({});
            }, 2000);
          }),
      });

      const startTime = Date.now();
      roomRepository.saveRoom({ roomId: 'FAST01', videoId: null });
      const elapsed = Date.now() - startTime;

      // saveRoom must return synchronously in less than 50ms without awaiting the 2000ms promise
      expect(elapsed).toBeLessThan(50);
      expect(writeFinished).toBe(false);
    });
  });
});
