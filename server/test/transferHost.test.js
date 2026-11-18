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

describe('transfer_host event (guarded by HOST)', () => {
  let io, handler, hostSocket, bobSocket, charlieSocket, hostUser, bobUser, charlieUser, room;
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

    // Host setup (Alice)
    hostSocket = makeMockSocket('alice-sock');
    socketMap.set(hostSocket.id, hostSocket);
    handler.register(hostSocket);
    await hostSocket.trigger('create_room', { username: 'Alice' });

    const createCall = hostSocket.emit.mock.calls.find(([e]) => e === 'room_created');
    const roomId = createCall[1].roomId;
    room = roomManager.getRoom(roomId);
    hostUser = room.getHost();

    // Participant setup (Bob)
    bobSocket = makeMockSocket('bob-sock');
    socketMap.set(bobSocket.id, bobSocket);
    handler.register(bobSocket);
    await bobSocket.trigger('join_room', { roomId, username: 'Bob' });
    bobUser = room.getParticipantBySocket(bobSocket.id);

    // Participant setup (Charlie)
    charlieSocket = makeMockSocket('charlie-sock');
    socketMap.set(charlieSocket.id, charlieSocket);
    handler.register(charlieSocket);
    await charlieSocket.trigger('join_room', { roomId, username: 'Charlie' });
    charlieUser = room.getParticipantBySocket(charlieSocket.id);
  });

  it('should reject non-HOST (PARTICIPANT) with FORBIDDEN', async () => {
    await bobSocket.trigger('transfer_host', {
      userId: charlieUser.userId,
    });

    expect(bobSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
      code: 'FORBIDDEN',
    }));
    expect(room.getHost().userId).toBe(hostUser.userId);
  });

  it('should reject non-HOST (MODERATOR) with FORBIDDEN', async () => {
    room.setRole(bobUser.userId, Role.MODERATOR);

    await bobSocket.trigger('transfer_host', {
      userId: charlieUser.userId,
    });

    expect(bobSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
      code: 'FORBIDDEN',
    }));
    expect(room.getHost().userId).toBe(hostUser.userId);
  });

  it('should reject when HOST attempts to transfer host to self', async () => {
    await hostSocket.trigger('transfer_host', {
      userId: hostUser.userId,
    });

    expect(hostSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
      code: 'INVALID_REQUEST',
      message: expect.stringContaining('Cannot transfer host to yourself'),
    }));
    expect(room.getHost().userId).toBe(hostUser.userId);
  });

  it('should reject when userId is missing or empty', async () => {
    await hostSocket.trigger('transfer_host', {});

    expect(hostSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
      code: 'INVALID_REQUEST',
      message: expect.stringContaining('userId is required'),
    }));

    await hostSocket.trigger('transfer_host', { userId: 12345 });
    expect(hostSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
      code: 'INVALID_REQUEST',
      message: expect.stringContaining('userId is required'),
    }));
  });

  it('should reject when target user is not in the room', async () => {
    await hostSocket.trigger('transfer_host', {
      userId: 'non-existent-user-id',
    });

    expect(hostSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
      code: 'USER_NOT_FOUND',
      message: expect.stringContaining('Target user is not in this room'),
    }));
  });

  it('should successfully transfer host to new user, demote old host to MODERATOR, and broadcast role_assigned for both users', async () => {
    await hostSocket.trigger('transfer_host', {
      userId: bobUser.userId,
    });

    // 1. Verify Room model states
    expect(room.getHost().userId).toBe(bobUser.userId);
    expect(room.getParticipant(hostUser.userId).role).toBe(Role.MODERATOR);
    expect(room.getParticipant(bobUser.userId).role).toBe(Role.HOST);

    // 2. Verify broadcast of role_assigned for both users
    expect(io.to).toHaveBeenCalledWith(room.roomId);
    const roomBroadcast = io.to(room.roomId).emit;

    const roleAssignedCalls = roomBroadcast.mock.calls.filter(([event]) => event === 'role_assigned');
    expect(roleAssignedCalls).toHaveLength(2);

    // Call 1: Alice demoted to MODERATOR
    expect(roleAssignedCalls[0][1]).toEqual(expect.objectContaining({
      userId: hostUser.userId,
      username: 'Alice',
      role: Role.MODERATOR,
      participants: expect.arrayContaining([
        expect.objectContaining({ userId: hostUser.userId, role: Role.MODERATOR }),
        expect.objectContaining({ userId: bobUser.userId, role: Role.HOST }),
      ]),
    }));

    // Call 2: Bob promoted to HOST
    expect(roleAssignedCalls[1][1]).toEqual(expect.objectContaining({
      userId: bobUser.userId,
      username: 'Bob',
      role: Role.HOST,
      participants: expect.arrayContaining([
        expect.objectContaining({ userId: hostUser.userId, role: Role.MODERATOR }),
        expect.objectContaining({ userId: bobUser.userId, role: Role.HOST }),
      ]),
    }));
  });

  it('should enable new host to perform host actions and prevent demoted host from host actions', async () => {
    // Transfer host from Alice to Bob
    await hostSocket.trigger('transfer_host', {
      userId: bobUser.userId,
    });

    // Bob (new HOST) should be able to assign role to Charlie
    await bobSocket.trigger('assign_role', {
      userId: charlieUser.userId,
      role: Role.VIEWER,
    });
    expect(room.getParticipant(charlieUser.userId).role).toBe(Role.VIEWER);

    // Alice (now MODERATOR) should be rejected from assign_role
    await hostSocket.trigger('assign_role', {
      userId: charlieUser.userId,
      role: Role.PARTICIPANT,
    });
    expect(hostSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
      code: 'FORBIDDEN',
    }));
  });
});
