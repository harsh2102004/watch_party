import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageHandler } from '../src/handlers/MessageHandler.js';
import { roomManager } from '../src/models/RoomManager.js';
import { ALLOWED_REACTIONS, ReactionHandler } from '../src/handlers/ReactionHandler.js';

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

describe('ReactionHandler & reaction Event', () => {
  let io, ioRoomEmit, handler, hostSocket, participantSocket, room;

  beforeEach(async () => {
    roomManager.rooms.clear();

    ioRoomEmit = vi.fn();
    io = {
      to: vi.fn().mockReturnValue({ emit: ioRoomEmit }),
    };

    handler = new MessageHandler(io, roomManager);

    // Host Alice creates room
    hostSocket = makeMockSocket('host-sock');
    handler.register(hostSocket);
    await hostSocket.trigger('create_room', { username: 'Alice' });

    const createCall = hostSocket.emit.mock.calls.find(([e]) => e === 'room_created');
    const roomId = createCall[1].roomId;
    room = roomManager.getRoom(roomId);

    // Participant Bob joins room
    participantSocket = makeMockSocket('part-sock');
    handler.register(participantSocket);
    await participantSocket.trigger('join_room', { roomId, username: 'Bob' });
  });

  describe('Whitelist Validation', () => {
    it('should export standard 6 emojis in ALLOWED_REACTIONS', () => {
      expect(ALLOWED_REACTIONS).toHaveLength(6);
      expect(ALLOWED_REACTIONS).toEqual(['❤️', '🔥', '😂', '🎉', '😮', '👏']);
    });

    it('should reject reactions if not in a room', async () => {
      const lonelySocket = makeMockSocket('lonely-sock');
      handler.register(lonelySocket);

      await lonelySocket.trigger('reaction', { emoji: '🔥' });
      const errCall = lonelySocket.emit.mock.calls.find(([e]) => e === 'error_event');
      expect(errCall).toBeDefined();
      expect(errCall[1].code).toBe('NOT_IN_ROOM');
    });

    it('should reject emojis not in the allowed whitelist', async () => {
      await participantSocket.trigger('reaction', { emoji: '💩' });
      const errCall = participantSocket.emit.mock.calls.find(([e]) => e === 'error_event');
      expect(errCall).toBeDefined();
      expect(errCall[1].code).toBe('INVALID_REACTION');
      expect(errCall[1].message).toContain('not in the allowed reaction whitelist');
    });

    it('should reject empty emoji payload', async () => {
      await participantSocket.trigger('reaction', { emoji: '   ' });
      const errCall = participantSocket.emit.mock.calls.find(([e]) => e === 'error_event');
      expect(errCall).toBeDefined();
      expect(errCall[1].code).toBe('INVALID_REACTION');
    });
  });

  describe('Broadcasting & Payload Structure', () => {
    it('should broadcast valid reaction to the entire room', async () => {
      await participantSocket.trigger('reaction', { emoji: '🎉' });

      expect(io.to).toHaveBeenCalledWith(room.roomId);
      expect(ioRoomEmit).toHaveBeenCalledWith('reaction', expect.objectContaining({
        emoji: '🎉',
        username: 'Bob',
      }));

      const lastCall = ioRoomEmit.mock.calls[ioRoomEmit.mock.calls.length - 1];
      expect(lastCall[0]).toBe('reaction');
      expect(lastCall[1].emoji).toBe('🎉');
      expect(lastCall[1].username).toBe('Bob');
      expect(typeof lastCall[1].userId).toBe('string');
      expect(typeof lastCall[1].timestamp).toBe('number');
    });

    it('should allow string payload directly (e.g. socket.emit("reaction", "❤️"))', async () => {
      await hostSocket.trigger('reaction', '❤️');

      expect(io.to).toHaveBeenCalledWith(room.roomId);
      const lastCall = ioRoomEmit.mock.calls[ioRoomEmit.mock.calls.length - 1];
      expect(lastCall[0]).toBe('reaction');
      expect(lastCall[1].emoji).toBe('❤️');
      expect(lastCall[1].username).toBe('Alice');
    });
  });

  describe('Rate Limiting', () => {
    it('should rate limit user after exceeding rateLimitMax reactions in window', async () => {
      const customReactionHandler = new ReactionHandler(io, roomManager, {
        rateLimitMax: 3,
        rateLimitWindowMs: 5000,
      });

      const testSock = makeMockSocket('rate-sock');
      customReactionHandler.register(testSock);

      // Put sock in room
      const charlie = room.addParticipant({ socketId: testSock.id, username: 'Charlie' });
      testSock.data = { roomId: room.roomId, userId: charlie.userId };

      // Send 3 allowed reactions
      for (let i = 0; i < 3; i++) {
        await testSock.trigger('reaction', { emoji: '🔥' });
      }

      // 4th reaction within window should be rate limited
      await testSock.trigger('reaction', { emoji: '🔥' });

      const errCall = testSock.emit.mock.calls.find(
        ([e, data]) => e === 'error_event' && data.code === 'RATE_LIMITED'
      );
      expect(errCall).toBeDefined();
      expect(errCall[1].message).toContain('Reaction rate limit exceeded');
    });
  });
});
