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

describe('approve_request and reject_request events', () => {
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
    let req;
    beforeEach(() => {
      req = room.addRequest({
        type: 'play',
        requesterId: participantUser.userId,
        requesterName: 'Charlie',
      });
    });

    it('should reject PARTICIPANT from approving with FORBIDDEN', async () => {
      await participantSocket.trigger('approve_request', { requestId: req.id });
      expect(participantSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
        code: 'FORBIDDEN',
      }));
    });

    it('should reject PARTICIPANT from rejecting with FORBIDDEN', async () => {
      await participantSocket.trigger('reject_request', { requestId: req.id });
      expect(participantSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
        code: 'FORBIDDEN',
      }));
    });

    it('should reject VIEWER from approving with FORBIDDEN', async () => {
      await viewerSocket.trigger('approve_request', { requestId: req.id });
      expect(viewerSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
        code: 'FORBIDDEN',
      }));
    });

    it('should allow HOST to approve request', async () => {
      await hostSocket.trigger('approve_request', { requestId: req.id });
      expect(room.pendingRequests.has(req.id)).toBe(false);
    });

    it('should allow MODERATOR to approve request', async () => {
      await modSocket.trigger('approve_request', { requestId: req.id });
      expect(room.pendingRequests.has(req.id)).toBe(false);
    });
  });

  describe('Validation', () => {
    it('should reject missing or non-string requestId', async () => {
      await hostSocket.trigger('approve_request', {});
      expect(hostSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
        code: 'INVALID_REQUEST',
      }));

      await hostSocket.trigger('reject_request', { requestId: 12345 });
      expect(hostSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
        code: 'INVALID_REQUEST',
      }));
    });

    it('should reject non-existent requestId with REQUEST_NOT_FOUND', async () => {
      await hostSocket.trigger('approve_request', { requestId: 'non-existent-id' });
      expect(hostSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
        code: 'REQUEST_NOT_FOUND',
      }));

      await hostSocket.trigger('reject_request', { requestId: 'non-existent-id' });
      expect(hostSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
        code: 'REQUEST_NOT_FOUND',
      }));
    });
  });

  describe('approve_request flow', () => {
    it('should execute seek action, remove request, broadcast sync_state, and notify host/moderators and requester with request_resolved', async () => {
      // Charlie requests seek to 75s
      const req = room.addRequest({
        type: 'seek',
        payload: { time: 75 },
        requesterId: participantUser.userId,
        requesterName: 'Charlie',
      });

      expect(room.currentTime).toBe(0);

      // Moderator approves request
      await modSocket.trigger('approve_request', { requestId: req.id });

      // 1. Authoritative room state mutated
      expect(room.currentTime).toBe(75);
      expect(room.pendingRequests.has(req.id)).toBe(false);

      // 2. sync_state broadcast to whole room
      expect(io.to).toHaveBeenCalledWith(room.roomId);
      const roomBroadcast = io.to(room.roomId).emit;
      expect(roomBroadcast).toHaveBeenCalledWith('sync_state', expect.objectContaining({
        currentTime: 75,
      }));

      // 3. request_resolved sent to HOST, MODERATOR, and requester
      expect(hostSocket.emit).toHaveBeenCalledWith('request_resolved', {
        requestId: req.id,
        status: 'approved',
      });
      expect(modSocket.emit).toHaveBeenCalledWith('request_resolved', {
        requestId: req.id,
        status: 'approved',
      });
      expect(participantSocket.emit).toHaveBeenCalledWith('request_resolved', {
        requestId: req.id,
        status: 'approved',
      });

      // 4. Other uninvolved participant does NOT receive request_resolved
      const otherCalls = otherPartSocket.emit.mock.calls.find(([ev]) => ev === 'request_resolved');
      expect(otherCalls).toBeUndefined();
    });

    it('should execute change_video action on approve', async () => {
      const req = room.addRequest({
        type: 'change_video',
        payload: { videoId: 'dQw4w9WgXcQ' },
        requesterId: participantUser.userId,
        requesterName: 'Charlie',
      });

      await hostSocket.trigger('approve_request', { requestId: req.id });

      expect(room.videoId).toBe('dQw4w9WgXcQ');
      expect(room.currentTime).toBe(0);
      expect(room.playState).toBe('paused');
      expect(room.pendingRequests.has(req.id)).toBe(false);
    });
  });

  describe('reject_request flow', () => {
    it('should remove request, leave room state untouched, notify requester with request_rejected, and broadcast request_resolved to host/moderators and requester', async () => {
      const initialTime = room.currentTime;
      const initialPlayState = room.playState;

      const req = room.addRequest({
        type: 'seek',
        payload: { time: 120 },
        requesterId: participantUser.userId,
        requesterName: 'Charlie',
      });

      // Host rejects request with reason
      await hostSocket.trigger('reject_request', {
        requestId: req.id,
        reason: 'Too far ahead in video',
      });

      // 1. Request removed from room
      expect(room.pendingRequests.has(req.id)).toBe(false);

      // 2. Room state unchanged
      expect(room.currentTime).toBe(initialTime);
      expect(room.playState).toBe(initialPlayState);

      // 3. Requester notified with "request_rejected"
      expect(participantSocket.emit).toHaveBeenCalledWith('request_rejected', {
        requestId: req.id,
        reason: 'Too far ahead in video',
      });

      // 4. Host, moderator, and requester notified with request_resolved { status: 'rejected' }
      expect(hostSocket.emit).toHaveBeenCalledWith('request_resolved', {
        requestId: req.id,
        status: 'rejected',
      });
      expect(modSocket.emit).toHaveBeenCalledWith('request_resolved', {
        requestId: req.id,
        status: 'rejected',
      });
      expect(participantSocket.emit).toHaveBeenCalledWith('request_resolved', {
        requestId: req.id,
        status: 'rejected',
      });

      // 5. Unrelated participant does NOT receive request_resolved
      const otherCalls = otherPartSocket.emit.mock.calls.find(([ev]) => ev === 'request_resolved');
      expect(otherCalls).toBeUndefined();
    });
  });
});
