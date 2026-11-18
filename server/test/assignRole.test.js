import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageHandler } from '../src/handlers/MessageHandler.js';
import { roomManager } from '../src/models/RoomManager.js';
import { Role } from '../src/models/role.js';

function makeMockSocket(id = 'role-sock-1') {
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

describe('assign_role event (guarded by HOST)', () => {
  let io, handler, hostSocket, participantSocket, hostUser, bobUser, room;

  beforeEach(async () => {
    roomManager.rooms.clear();

    io = {
      to: vi.fn().mockReturnValue({ emit: vi.fn() }),
    };
    handler = new MessageHandler(io, roomManager);

    // Host setup
    hostSocket = makeMockSocket('host-role-sock');
    handler.register(hostSocket);
    await hostSocket.trigger('create_room', { username: 'Alice' });

    const createCall = hostSocket.emit.mock.calls.find(([e]) => e === 'room_created');
    const roomId = createCall[1].roomId;
    room = roomManager.getRoom(roomId);
    hostUser = room.getHost();

    // Participant setup
    participantSocket = makeMockSocket('part-role-sock');
    handler.register(participantSocket);
    await participantSocket.trigger('join_room', { roomId, username: 'Bob' });
    bobUser = room.getParticipantBySocket(participantSocket.id);
  });

  it('should reject non-HOST (PARTICIPANT) from assigning roles with FORBIDDEN', async () => {
    await participantSocket.trigger('assign_role', {
      userId: hostUser.userId,
      role: Role.VIEWER,
    });

    expect(participantSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
      code: 'FORBIDDEN',
    }));
  });

  it('should reject non-HOST (MODERATOR) from assigning roles with FORBIDDEN', async () => {
    room.setRole(bobUser.userId, Role.MODERATOR);

    await participantSocket.trigger('assign_role', {
      userId: hostUser.userId,
      role: Role.VIEWER,
    });

    expect(participantSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
      code: 'FORBIDDEN',
    }));
  });

  it('should reject HOST targeting self', async () => {
    await hostSocket.trigger('assign_role', {
      userId: hostUser.userId,
      role: Role.MODERATOR,
    });

    expect(hostSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
      code: 'INVALID_REQUEST',
      message: expect.stringContaining('Cannot change your own role'),
    }));
  });

  it('should reject assigning HOST via assign_role', async () => {
    await hostSocket.trigger('assign_role', {
      userId: bobUser.userId,
      role: Role.HOST,
    });

    expect(hostSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
      code: 'INVALID_ROLE',
      message: expect.stringContaining('Cannot assign HOST role via assign_role'),
    }));
  });

  it('should reject invalid role values', async () => {
    await hostSocket.trigger('assign_role', {
      userId: bobUser.userId,
      role: 'SUPERADMIN',
    });

    expect(hostSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
      code: 'INVALID_ROLE',
    }));
  });

  it('should reject non-existent target users', async () => {
    await hostSocket.trigger('assign_role', {
      userId: 'non-existent-user-1234',
      role: Role.MODERATOR,
    });

    expect(hostSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
      code: 'USER_NOT_FOUND',
    }));
  });

  it('should successfully promote PARTICIPANT to MODERATOR and broadcast role_assigned', async () => {
    await hostSocket.trigger('assign_role', {
      userId: bobUser.userId,
      role: Role.MODERATOR,
    });

    expect(bobUser.role).toBe(Role.MODERATOR);

    const toResult = io.to.mock.results.at(-1).value;
    expect(toResult.emit).toHaveBeenCalledWith('role_assigned', expect.objectContaining({
      userId: bobUser.userId,
      username: 'Bob',
      role: Role.MODERATOR,
      participants: expect.arrayContaining([
        expect.objectContaining({ username: 'Bob', role: Role.MODERATOR }),
      ]),
    }));
  });

  it('should successfully demote MODERATOR to VIEWER', async () => {
    room.setRole(bobUser.userId, Role.MODERATOR);

    await hostSocket.trigger('assign_role', {
      userId: bobUser.userId,
      role: Role.VIEWER,
    });

    expect(bobUser.role).toBe(Role.VIEWER);
    const toResult = io.to.mock.results.at(-1).value;
    expect(toResult.emit).toHaveBeenCalledWith('role_assigned', expect.objectContaining({
      userId: bobUser.userId,
      role: Role.VIEWER,
    }));
  });
});
