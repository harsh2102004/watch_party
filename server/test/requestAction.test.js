import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageHandler } from '../src/handlers/MessageHandler.js';
import { roomManager } from '../src/models/RoomManager.js';
import { Role } from '../src/models/role.js';

function makeMockSocket(id = 'mock-sock') {
  const events = {};
  return {
    id,
    emit: vi.fn(),
    join: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn().mockResolvedValue(undefined),
    to: vi.fn().mockReturnValue({ emit: vi.fn() }),
    on: (event, cb) => { events[event] = cb; },
    trigger: (event, data) => events[event]?.(data),
  };
}

describe('request_action event', () => {
  let io, handler, hostSocket, modSocket, participantSocket, viewerSocket, otherPartSocket;
  let hostUser, modUser, participantUser, viewerUser, otherPartUser, room;
  let socketMap;

  beforeEach(async () => {
    roomManager.rooms.clear();

    socketMap = new Map();

    io = {
      to: vi.fn().mockReturnValue({ emit: vi.fn() }),
      sockets: {
        sockets: socketMap,
      },
    };
    handler = new MessageHandler(io, roomManager);

    // 1. Host creates room
    hostSocket = makeMockSocket('host-sock');
    socketMap.set(hostSocket.id, hostSocket);
    handler.register(hostSocket);
    await hostSocket.trigger('create_room', { username: 'Alice' });

    const createCall = hostSocket.emit.mock.calls.find(([e]) => e === 'room_created');
    const roomId = createCall[1].roomId;
    room = roomManager.getRoom(roomId);
    hostUser = room.getHost();

    // 2. Moderator joins
    modSocket = makeMockSocket('mod-sock');
    socketMap.set(modSocket.id, modSocket);
    handler.register(modSocket);
    await modSocket.trigger('join_room', { roomId, username: 'Bob' });
    modUser = room.getParticipantBySocket(modSocket.id);
    room.setRole(modUser.userId, Role.MODERATOR);

    // 3. Participant joins
    participantSocket = makeMockSocket('part-sock');
    socketMap.set(participantSocket.id, participantSocket);
    handler.register(participantSocket);
    await participantSocket.trigger('join_room', { roomId, username: 'Charlie' });
    participantUser = room.getParticipantBySocket(participantSocket.id);

    // 4. Viewer joins
    viewerSocket = makeMockSocket('viewer-sock');
    socketMap.set(viewerSocket.id, viewerSocket);
    handler.register(viewerSocket);
    await viewerSocket.trigger('join_room', { roomId, username: 'Dave' });
    viewerUser = room.getParticipantBySocket(viewerSocket.id);
    room.setRole(viewerUser.userId, Role.VIEWER);

    // 5. Another participant joins
    otherPartSocket = makeMockSocket('other-part-sock');
    socketMap.set(otherPartSocket.id, otherPartSocket);
    handler.register(otherPartSocket);
    await otherPartSocket.trigger('join_room', { roomId, username: 'Eve' });
    otherPartUser = room.getParticipantBySocket(otherPartSocket.id);
  });

  describe('Role-based permissions', () => {
    it('should allow PARTICIPANT to submit request_action', async () => {
      await participantSocket.trigger('request_action', {
        type: 'play',
      });

      expect(participantSocket.emit).toHaveBeenCalledWith('request_queued', expect.objectContaining({
        requestId: expect.any(String),
      }));
      expect(room.pendingRequests.size).toBe(1);
    });

    it('should allow VIEWER to submit request_action', async () => {
      await viewerSocket.trigger('request_action', {
        type: 'pause',
      });

      expect(viewerSocket.emit).toHaveBeenCalledWith('request_queued', expect.objectContaining({
        requestId: expect.any(String),
      }));
      expect(room.pendingRequests.size).toBe(1);
    });

    it('should reject HOST attempting request_action with FORBIDDEN', async () => {
      await hostSocket.trigger('request_action', {
        type: 'play',
      });

      expect(hostSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
        code: 'FORBIDDEN',
      }));
    });

    it('should reject MODERATOR attempting request_action with FORBIDDEN', async () => {
      await modSocket.trigger('request_action', {
        type: 'play',
      });

      expect(modSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
        code: 'FORBIDDEN',
      }));
    });
  });

  describe('Validation', () => {
    it('should reject invalid or missing action types', async () => {
      await participantSocket.trigger('request_action', {});
      expect(participantSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
        code: 'INVALID_REQUEST',
      }));

      await participantSocket.trigger('request_action', { type: 'kick_user' });
      expect(participantSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
        code: 'INVALID_REQUEST',
      }));
    });

    it('should validate seek payload (require non-negative number)', async () => {
      await participantSocket.trigger('request_action', {
        type: 'seek',
        payload: { time: -10 },
      });
      expect(participantSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
        code: 'INVALID_REQUEST',
      }));

      await participantSocket.trigger('request_action', {
        type: 'seek',
        payload: { time: 'ten' },
      });
      expect(participantSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
        code: 'INVALID_REQUEST',
      }));
    });

    it('should validate change_video payload (require valid YouTube videoId or URL)', async () => {
      await participantSocket.trigger('request_action', {
        type: 'change_video',
        payload: {},
      });
      expect(participantSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
        code: 'INVALID_VIDEO',
      }));

      await participantSocket.trigger('request_action', {
        type: 'change_video',
        payload: { videoId: 'invalid-url-format' },
      });
      expect(participantSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
        code: 'INVALID_VIDEO',
      }));
    });

    it('should accept valid seek and valid change_video with extracted videoId', async () => {
      await participantSocket.trigger('request_action', {
        type: 'seek',
        payload: { time: 42 },
      });
      expect(participantSocket.emit).toHaveBeenCalledWith('request_queued', expect.anything());

      await participantSocket.trigger('request_action', {
        type: 'change_video',
        payload: { videoId: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      });
      expect(participantSocket.emit).toHaveBeenCalledWith('request_queued', expect.anything());

      const requests = room.getPendingList();
      const changeReq = requests.find((r) => r.type === 'change_video');
      expect(changeReq.payload.videoId).toBe('dQw4w9WgXcQ');
    });
  });

  describe('Rate limiting (3 pending requests per user)', () => {
    it('should enforce a limit of 3 pending requests per user and allow other users their own quota', async () => {
      // 1. Charlie makes 3 valid requests
      await participantSocket.trigger('request_action', { type: 'play' });
      await participantSocket.trigger('request_action', { type: 'pause' });
      await participantSocket.trigger('request_action', { type: 'seek', payload: { time: 30 } });

      expect(room.pendingRequests.size).toBe(3);

      // 2. Charlie makes a 4th request -> rejected
      await participantSocket.trigger('request_action', { type: 'play' });
      expect(participantSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
        code: 'REQUEST_LIMIT_REACHED',
      }));
      expect(room.pendingRequests.size).toBe(3);

      // 3. Dave (Viewer) can still submit requests within his quota
      await viewerSocket.trigger('request_action', { type: 'play' });
      expect(viewerSocket.emit).toHaveBeenCalledWith('request_queued', expect.anything());
      expect(room.pendingRequests.size).toBe(4);
    });
  });

  describe('Notifications to HOST & MODERATOR only', () => {
    it('should emit action_requested only to HOST and MODERATOR sockets, not to participants/viewers or requester', async () => {
      await participantSocket.trigger('request_action', {
        type: 'change_video',
        payload: { videoId: 'https://youtu.be/dQw4w9WgXcQ' },
      });

      // 1. Requester receives request_queued
      expect(participantSocket.emit).toHaveBeenCalledWith('request_queued', expect.objectContaining({
        requestId: expect.any(String),
      }));

      // Requester does NOT receive action_requested
      const partActionRequested = participantSocket.emit.mock.calls.find(([ev]) => ev === 'action_requested');
      expect(partActionRequested).toBeUndefined();

      // 2. Host receives action_requested
      expect(hostSocket.emit).toHaveBeenCalledWith('action_requested', expect.objectContaining({
        type: 'change_video',
        payload: { videoId: 'dQw4w9WgXcQ' },
        requesterId: participantUser.userId,
        requesterName: 'Charlie',
      }));

      // 3. Moderator receives action_requested
      expect(modSocket.emit).toHaveBeenCalledWith('action_requested', expect.objectContaining({
        type: 'change_video',
        payload: { videoId: 'dQw4w9WgXcQ' },
        requesterId: participantUser.userId,
        requesterName: 'Charlie',
      }));

      // 4. Other participants and viewers do NOT receive action_requested
      const viewerActionCalls = viewerSocket.emit.mock.calls.find(([ev]) => ev === 'action_requested');
      expect(viewerActionCalls).toBeUndefined();

      const otherPartActionCalls = otherPartSocket.emit.mock.calls.find(([ev]) => ev === 'action_requested');
      expect(otherPartActionCalls).toBeUndefined();
    });
  });
});
