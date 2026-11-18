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

describe('Playback Request Lifecycle (End-to-End)', () => {
  let io, handler, hostSocket, modSocket, participantSocket;
  let room, hostUser, modUser, partUser;
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

    // 3. Participant joins
    participantSocket = makeMockSocket('part-sock');
    socketMap.set(participantSocket.id, participantSocket);
    handler.register(participantSocket);
    await participantSocket.trigger('join_room', { roomId, username: 'Charlie' });
    partUser = room.getParticipantBySocket(participantSocket.id);
  });

  afterEach(() => {
    handler.clearAllSweepers();
    roomManager.clear();
    vi.useRealTimers();
  });

  it('participant request -> mod approve changes state', async () => {
    // Initial state
    expect(room.playState).toBe('paused');
    expect(room.currentTime).toBe(0);

    // 1. Participant submits request to seek to 120s
    await participantSocket.trigger('request_action', {
      type: 'seek',
      payload: { time: 120 },
    });

    // Requester gets confirmation receipt
    const queuedCall = participantSocket.emit.mock.calls.find(([e]) => e === 'request_queued');
    expect(queuedCall).toBeTruthy();
    const requestId = queuedCall[1].requestId;

    // Moderator receives action_requested
    expect(modSocket.emit).toHaveBeenCalledWith('action_requested', expect.objectContaining({
      id: requestId,
      type: 'seek',
      payload: { time: 120 },
    }));

    // 2. Moderator approves the request
    await modSocket.trigger('approve_request', { requestId });

    // 3. Verify room state was updated
    expect(room.currentTime).toBe(120);
    expect(room.pendingRequests.has(requestId)).toBe(false);

    // 4. Verify sync_state was broadcast to everyone in the room
    expect(io.to).toHaveBeenCalledWith(room.roomId);
    expect(io.to(room.roomId).emit).toHaveBeenCalledWith('sync_state', expect.objectContaining({
      currentTime: 120,
      playState: 'paused',
    }));

    // 5. Verify request_resolved was sent to moderator and participant
    expect(modSocket.emit).toHaveBeenCalledWith('request_resolved', {
      requestId,
      status: 'approved',
    });
    expect(participantSocket.emit).toHaveBeenCalledWith('request_resolved', {
      requestId,
      status: 'approved',
    });
  });

  it('reject leaves state unchanged', async () => {
    const originalTime = room.currentTime;
    const originalPlayState = room.playState;
    const originalVideoId = room.videoId;

    // 1. Participant submits request to change video
    await participantSocket.trigger('request_action', {
      type: 'change_video',
      payload: { videoId: 'dQw4w9WgXcQ' },
    });

    const queuedCall = participantSocket.emit.mock.calls.find(([e]) => e === 'request_queued');
    expect(queuedCall).toBeTruthy();
    const requestId = queuedCall[1].requestId;

    // 2. Moderator rejects the request
    await modSocket.trigger('reject_request', {
      requestId,
      reason: 'We want to finish this video first',
    });

    // 3. Verify room state remains strictly unchanged
    expect(room.currentTime).toBe(originalTime);
    expect(room.playState).toBe(originalPlayState);
    expect(room.videoId).toBe(originalVideoId);
    expect(room.pendingRequests.has(requestId)).toBe(false);

    // 4. Requester receives request_rejected notification
    expect(participantSocket.emit).toHaveBeenCalledWith('request_rejected', {
      requestId,
      reason: 'We want to finish this video first',
    });

    // 5. Moderator and requester receive request_resolved with status: 'rejected'
    expect(modSocket.emit).toHaveBeenCalledWith('request_resolved', {
      requestId,
      status: 'rejected',
    });
    expect(participantSocket.emit).toHaveBeenCalledWith('request_resolved', {
      requestId,
      status: 'rejected',
    });
  });

  it('expired request cannot be approved', async () => {
    // 1. Participant submits request
    await participantSocket.trigger('request_action', {
      type: 'seek',
      payload: { time: 88 },
    });

    const queuedCall = participantSocket.emit.mock.calls.find(([e]) => e === 'request_queued');
    const requestId = queuedCall[1].requestId;

    expect(room.getRequest(requestId)).toBeDefined();

    // 2. 60 seconds elapse -> request expires and is cleaned up by the sweeper
    vi.advanceTimersByTime(60000);

    expect(room.getRequest(requestId)).toBeUndefined();
    expect(modSocket.emit).toHaveBeenCalledWith('request_resolved', {
      requestId,
      status: 'expired',
    });

    // 3. Moderator tries to approve the expired request
    modSocket.emit.mockClear();
    await modSocket.trigger('approve_request', { requestId });

    // 4. Verify rejection with REQUEST_NOT_FOUND error
    expect(modSocket.emit).toHaveBeenCalledWith('error_event', {
      code: 'REQUEST_NOT_FOUND',
      message: 'Request not found.',
    });

    // 5. Verify room state was NOT modified
    expect(room.currentTime).toBe(0);
  });

  it('participant cannot approve their own request', async () => {
    // 1. Participant submits request to seek to 45s
    await participantSocket.trigger('request_action', {
      type: 'seek',
      payload: { time: 45 },
    });

    const queuedCall = participantSocket.emit.mock.calls.find(([e]) => e === 'request_queued');
    const requestId = queuedCall[1].requestId;

    // 2. Participant attempts to approve their own request
    await participantSocket.trigger('approve_request', { requestId });

    // 3. Verify participant receives FORBIDDEN error
    expect(participantSocket.emit).toHaveBeenCalledWith('error_event', {
      code: 'FORBIDDEN',
      message: 'Role "PARTICIPANT" is not allowed to perform action "approve_request".',
    });

    // 4. Verify the request is still pending and room state was NOT modified
    expect(room.getRequest(requestId)).toBeDefined();
    expect(room.currentTime).toBe(0);
  });
});
