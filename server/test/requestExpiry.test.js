import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

describe('Pending Request 60s Expiry & Sweeper Lifecycle', () => {
  let io, handler, hostSocket, modSocket, participantSocket, spectatorSocket;
  let room, hostUser, modUser, partUser, specUser;
  let socketMap;

  beforeEach(async () => {
    vi.useFakeTimers();
    roomManager.clear();

    socketMap = new Map();
    io = {
      to: vi.fn().mockReturnValue({ emit: vi.fn() }),
      sockets: {
        sockets: socketMap,
      },
    };

    handler = new MessageHandler(io, roomManager, {
      requestTtlMs: 60000,
      sweeperIntervalMs: 1000,
    });

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

    // 3. Requester (Participant) joins
    participantSocket = makeMockSocket('part-sock');
    socketMap.set(participantSocket.id, participantSocket);
    handler.register(participantSocket);
    await participantSocket.trigger('join_room', { roomId, username: 'Charlie' });
    partUser = room.getParticipantBySocket(participantSocket.id);

    // 4. Spectator (unrelated participant) joins
    spectatorSocket = makeMockSocket('spec-sock');
    socketMap.set(spectatorSocket.id, spectatorSocket);
    handler.register(spectatorSocket);
    await spectatorSocket.trigger('join_room', { roomId, username: 'Dave' });
    specUser = room.getParticipantBySocket(spectatorSocket.id);
  });

  afterEach(() => {
    handler.clearAllSweepers();
    roomManager.clear();
    vi.useRealTimers();
  });

  it('should automatically expire stale request after 60s and emit request_resolved { status: "expired" }', async () => {
    await participantSocket.trigger('request_action', { type: 'play' });

    const queuedCall = participantSocket.emit.mock.calls.find(([e]) => e === 'request_queued');
    expect(queuedCall).toBeTruthy();
    const requestId = queuedCall[1].requestId;

    expect(room.getPendingList().length).toBe(1);

    // Advance 30s: request is still pending
    vi.advanceTimersByTime(30000);
    expect(room.getPendingList().length).toBe(1);
    expect(hostSocket.emit).not.toHaveBeenCalledWith('request_resolved', expect.anything());

    // Advance to 60s total: request should expire
    vi.advanceTimersByTime(30000);

    expect(room.getPendingList().length).toBe(0);

    // Host receives request_resolved
    expect(hostSocket.emit).toHaveBeenCalledWith('request_resolved', {
      requestId,
      status: 'expired',
    });

    // Moderator receives request_resolved
    expect(modSocket.emit).toHaveBeenCalledWith('request_resolved', {
      requestId,
      status: 'expired',
    });

    // Requester receives request_resolved
    expect(participantSocket.emit).toHaveBeenCalledWith('request_resolved', {
      requestId,
      status: 'expired',
    });

    // Spectator does NOT receive request_resolved
    expect(spectatorSocket.emit).not.toHaveBeenCalledWith('request_resolved', expect.anything());
  });

  it('should not emit expired for a request approved before 60s', async () => {
    await participantSocket.trigger('request_action', { type: 'pause' });
    const queuedCall = participantSocket.emit.mock.calls.find(([e]) => e === 'request_queued');
    const requestId = queuedCall[1].requestId;

    // Advance 10s and approve
    vi.advanceTimersByTime(10000);
    await modSocket.trigger('approve_request', { requestId });

    // Mod socket was notified with status: 'approved'
    expect(modSocket.emit).toHaveBeenCalledWith('request_resolved', {
      requestId,
      status: 'approved',
    });

    // Advance past 60s
    vi.advanceTimersByTime(60000);

    // Ensure status: 'expired' was NEVER emitted
    expect(modSocket.emit).not.toHaveBeenCalledWith('request_resolved', {
      requestId,
      status: 'expired',
    });
    expect(hostSocket.emit).not.toHaveBeenCalledWith('request_resolved', {
      requestId,
      status: 'expired',
    });
    expect(participantSocket.emit).not.toHaveBeenCalledWith('request_resolved', {
      requestId,
      status: 'expired',
    });
  });

  it('should not emit expired for a request rejected before 60s', async () => {
    await participantSocket.trigger('request_action', { type: 'seek', payload: { time: 45 } });
    const queuedCall = participantSocket.emit.mock.calls.find(([e]) => e === 'request_queued');
    const requestId = queuedCall[1].requestId;

    // Advance 15s and reject
    vi.advanceTimersByTime(15000);
    await hostSocket.trigger('reject_request', { requestId });

    expect(hostSocket.emit).toHaveBeenCalledWith('request_resolved', {
      requestId,
      status: 'rejected',
    });

    // Advance past 60s
    vi.advanceTimersByTime(60000);

    expect(hostSocket.emit).not.toHaveBeenCalledWith('request_resolved', {
      requestId,
      status: 'expired',
    });
  });

  it('should reject approval with REQUEST_NOT_FOUND after request has expired', async () => {
    await participantSocket.trigger('request_action', { type: 'play' });
    const queuedCall = participantSocket.emit.mock.calls.find(([e]) => e === 'request_queued');
    const requestId = queuedCall[1].requestId;

    // Advance 60s so it expires
    vi.advanceTimersByTime(60000);
    expect(room.getRequest(requestId)).toBeUndefined();

    // Mod tries to approve expired request
    modSocket.emit.mockClear();
    await modSocket.trigger('approve_request', { requestId });

    expect(modSocket.emit).toHaveBeenCalledWith('error_event', {
      code: 'REQUEST_NOT_FOUND',
      message: 'Request not found.',
    });
  });

  it('should expire multiple requests staggered according to their creation times', async () => {
    // Request 1 at t=0
    await participantSocket.trigger('request_action', { type: 'play' });
    const reqId1 = participantSocket.emit.mock.calls.find(([e]) => e === 'request_queued')[1].requestId;

    // Advance 25s
    vi.advanceTimersByTime(25000);

    // Request 2 at t=25s
    await participantSocket.trigger('request_action', { type: 'pause' });
    const reqId2 = participantSocket.emit.mock.calls.filter(([e]) => e === 'request_queued')[1][1].requestId;

    // Advance to t=60s (35s more): reqId1 should expire, reqId2 should remain
    vi.advanceTimersByTime(35000);
    expect(room.getRequest(reqId1)).toBeUndefined();
    expect(room.getRequest(reqId2)).toBeDefined();

    expect(hostSocket.emit).toHaveBeenCalledWith('request_resolved', {
      requestId: reqId1,
      status: 'expired',
    });
    expect(hostSocket.emit).not.toHaveBeenCalledWith('request_resolved', {
      requestId: reqId2,
      status: 'expired',
    });

    // Advance to t=85s (25s more): reqId2 should expire
    vi.advanceTimersByTime(25000);
    expect(room.getRequest(reqId2)).toBeUndefined();

    expect(hostSocket.emit).toHaveBeenCalledWith('request_resolved', {
      requestId: reqId2,
      status: 'expired',
    });
  });

  it('should safely expire requests if requester has disconnected before expiration', async () => {
    await participantSocket.trigger('request_action', { type: 'play' });
    const reqId = participantSocket.emit.mock.calls.find(([e]) => e === 'request_queued')[1].requestId;

    // Requester leaves room
    await participantSocket.trigger('leave_room', { roomId: room.roomId });
    expect(room.getParticipant(partUser.userId)).toBeUndefined();

    // Advance 60s
    vi.advanceTimersByTime(60000);

    // Host & mod still notified
    expect(hostSocket.emit).toHaveBeenCalledWith('request_resolved', {
      requestId: reqId,
      status: 'expired',
    });
    expect(modSocket.emit).toHaveBeenCalledWith('request_resolved', {
      requestId: reqId,
      status: 'expired',
    });
    expect(room.getPendingList().length).toBe(0);
  });

  it('should clear room sweeper timers when room is deleted', async () => {
    expect(room.sweeperTimer).toBeTruthy();
    expect(handler.roomSweepers.has(room.roomId)).toBe(true);

    // All participants leave -> room becomes empty and is deleted
    await spectatorSocket.trigger('leave_room', { roomId: room.roomId });
    await participantSocket.trigger('leave_room', { roomId: room.roomId });
    await modSocket.trigger('leave_room', { roomId: room.roomId });
    await hostSocket.trigger('leave_room', { roomId: room.roomId });

    expect(roomManager.getRoom(room.roomId)).toBeUndefined();
    expect(handler.roomSweepers.has(room.roomId)).toBe(false);
    expect(room.sweeperTimer).toBeNull();
  });
});
