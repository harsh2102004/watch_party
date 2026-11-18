import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageHandler } from '../src/handlers/MessageHandler.js';
import { ChatHandler, stripAndEscapeHtml } from '../src/handlers/ChatHandler.js';
import { roomManager } from '../src/models/RoomManager.js';

function makeMockSocket(id = 'chat-sock-1') {
  const events = {};
  return {
    id,
    emit: vi.fn(),
    join: vi.fn().mockResolvedValue(undefined),
    to: vi.fn().mockReturnValue({ emit: vi.fn() }),
    on: (event, cb) => { events[event] = cb; },
    trigger: (event, data) => events[event]?.(data),
  };
}

describe('ChatHandler & chat_message Event', () => {
  let io, ioRoomEmit, handler, hostSocket, participantSocket, room, hostUser, bobUser;

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
    hostUser = room.getHost();

    // Participant Bob joins room
    participantSocket = makeMockSocket('part-sock');
    handler.register(participantSocket);
    await participantSocket.trigger('join_room', { roomId, username: 'Bob' });
    bobUser = room.getParticipantBySocket(participantSocket.id);
  });

  describe('stripAndEscapeHtml utility', () => {
    it('should strip HTML tags and escape HTML entities', () => {
      expect(stripAndEscapeHtml('Hello <b>world</b>')).toBe('Hello world');
      expect(stripAndEscapeHtml('<script>alert("xss")</script>Test')).toBe('alert(&quot;xss&quot;)Test');
      expect(stripAndEscapeHtml('5 > 3 & 2 < 4')).toBe('5 &gt; 3 &amp; 2 &lt; 4');
      expect(stripAndEscapeHtml("It's a 'quote'")).toBe('It&#039;s a &#039;quote&#039;');
      expect(stripAndEscapeHtml('')).toBe('');
      expect(stripAndEscapeHtml(null)).toBe('');
    });
  });

  describe('Validation & Room Membership', () => {
    it('should reject chat_message if user is not in a room', async () => {
      const lonelySocket = makeMockSocket('lonely-sock');
      handler.register(lonelySocket);

      await lonelySocket.trigger('chat_message', { text: 'Hello outside' });

      expect(lonelySocket.emit).toHaveBeenCalledWith('error_event', {
        code: 'NOT_IN_ROOM',
        message: 'You are not in a room.',
      });
    });

    it('should reject empty or whitespace-only messages', async () => {
      await participantSocket.trigger('chat_message', { text: '   ' });

      expect(participantSocket.emit).toHaveBeenCalledWith('error_event', {
        code: 'INVALID_MESSAGE',
        message: 'Message text cannot be empty.',
      });
    });

    it('should reject messages exceeding 300 characters', async () => {
      const longText = 'a'.repeat(301);
      await participantSocket.trigger('chat_message', { text: longText });

      expect(participantSocket.emit).toHaveBeenCalledWith('error_event', {
        code: 'MESSAGE_TOO_LONG',
        message: 'Message cannot exceed 300 characters.',
      });
    });

    it('should reject messages that become empty after stripping HTML tags', async () => {
      await participantSocket.trigger('chat_message', { text: '<div><b></b></div>' });

      expect(participantSocket.emit).toHaveBeenCalledWith('error_event', {
        code: 'INVALID_MESSAGE',
        message: 'Message cannot be empty.',
      });
    });
  });

  describe('Broadcast & Room Model Caching', () => {
    it('should broadcast sanitized chat_message to the room with required schema', async () => {
      await participantSocket.trigger('chat_message', { text: '  Hello <em>team</em>! & welcome  ' });

      expect(io.to).toHaveBeenCalledWith(room.roomId);
      expect(ioRoomEmit).toHaveBeenCalledWith('chat_message', expect.objectContaining({
        id: expect.any(String),
        userId: bobUser.userId,
        username: 'Bob',
        role: 'PARTICIPANT',
        text: 'Hello team! &amp; welcome',
        timestamp: expect.any(Number),
      }));

      // Stored in room history
      const history = room.getChatHistory();
      expect(history.length).toBe(1);
      expect(history[0].text).toBe('Hello team! &amp; welcome');
    });

    it('should cap room chat history at 50 messages, shifting oldest on overflow', async () => {
      for (let i = 1; i <= 60; i++) {
        room.addChatMessage({
          id: `msg-${i}`,
          userId: 'user-1',
          username: 'Alice',
          role: 'HOST',
          text: `Message ${i}`,
          timestamp: Date.now() + i,
        });
      }

      const history = room.getChatHistory();
      expect(history.length).toBe(50);
      expect(history[0].id).toBe('msg-11');
      expect(history[49].id).toBe('msg-60');
    });

    it('should deliver cached chat history to late joiners on room_joined', async () => {
      // Send a few messages
      await hostSocket.trigger('chat_message', { text: 'Welcome to the watch party!' });
      await participantSocket.trigger('chat_message', { text: 'Glad to be here!' });

      // Late joiner Charlie arrives
      const charlieSocket = makeMockSocket('charlie-sock');
      handler.register(charlieSocket);
      await charlieSocket.trigger('join_room', { roomId: room.roomId, username: 'Charlie' });

      const joinCall = charlieSocket.emit.mock.calls.find(([e]) => e === 'room_joined');
      expect(joinCall).toBeDefined();
      expect(joinCall[1].chat_history).toBeDefined();
      expect(joinCall[1].chat_history.length).toBe(2);
      expect(joinCall[1].chat_history[0].text).toBe('Welcome to the watch party!');
      expect(joinCall[1].chat_history[1].text).toBe('Glad to be here!');
    });
  });

  describe('Rate Limiting (5 messages per 10 seconds per user)', () => {
    it('should allow up to 5 messages within 10 seconds and reject the 6th with RATE_LIMITED', async () => {
      // Send 5 messages within limit
      for (let i = 1; i <= 5; i++) {
        await participantSocket.trigger('chat_message', { text: `Message ${i}` });
      }

      expect(ioRoomEmit).toHaveBeenCalledTimes(5);

      // Attempt 6th message immediately
      await participantSocket.trigger('chat_message', { text: 'Sixth rapid message' });

      expect(participantSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
        code: 'RATE_LIMITED',
        message: expect.stringContaining('Rate limit exceeded'),
      }));
      // Should still have only 5 broadcasts
      expect(ioRoomEmit).toHaveBeenCalledTimes(5);
    });

    it('should track rate limits per user independently', async () => {
      // Bob exhausts his 5 messages
      for (let i = 1; i <= 5; i++) {
        await participantSocket.trigger('chat_message', { text: `Bob msg ${i}` });
      }

      expect(participantSocket.emit).not.toHaveBeenCalledWith('error_event', expect.objectContaining({ code: 'RATE_LIMITED' }));

      // Alice can still send messages normally
      await hostSocket.trigger('chat_message', { text: 'Alice message 1' });
      expect(hostSocket.emit).not.toHaveBeenCalledWith('error_event', expect.objectContaining({ code: 'RATE_LIMITED' }));
      expect(ioRoomEmit).toHaveBeenCalledTimes(6);
    });
  });
});
