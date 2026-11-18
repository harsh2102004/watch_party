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

describe('Moderation & RBAC Edge Cases', () => {
  let io, handler, hostSocket, modSocket, participantSocket, hostUser, modUser, participantUser, room;
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

    // 1. Host creates room (Alice)
    hostSocket = makeMockSocket('alice-sock');
    socketMap.set(hostSocket.id, hostSocket);
    handler.register(hostSocket);
    await hostSocket.trigger('create_room', { username: 'Alice' });

    const createCall = hostSocket.emit.mock.calls.find(([e]) => e === 'room_created');
    const roomId = createCall[1].roomId;
    room = roomManager.getRoom(roomId);
    hostUser = room.getHost();

    // 2. Bob joins as Moderator
    modSocket = makeMockSocket('bob-sock');
    socketMap.set(modSocket.id, modSocket);
    handler.register(modSocket);
    await modSocket.trigger('join_room', { roomId, username: 'Bob' });
    modUser = room.getParticipantBySocket(modSocket.id);
    room.setRole(modUser.userId, Role.MODERATOR);

    // 3. Charlie joins as Participant
    participantSocket = makeMockSocket('charlie-sock');
    socketMap.set(participantSocket.id, participantSocket);
    handler.register(participantSocket);
    await participantSocket.trigger('join_room', { roomId, username: 'Charlie' });
    participantUser = room.getParticipantBySocket(participantSocket.id);
  });

  // Test 1: moderator attempting assign_role (FORBIDDEN)
  it('should reject a MODERATOR attempting assign_role with FORBIDDEN', async () => {
    await modSocket.trigger('assign_role', {
      userId: participantUser.userId,
      role: Role.VIEWER,
    });

    expect(modSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
      code: 'FORBIDDEN',
      message: expect.stringContaining('is not allowed to perform action "assign_role"'),
    }));

    // Verify Charlie's role is unaffected
    expect(room.getParticipant(participantUser.userId).role).toBe(Role.PARTICIPANT);
  });

  // Test 2: host removing self (rejected)
  it('should reject when HOST attempts to remove self with INVALID_REQUEST', async () => {
    await hostSocket.trigger('remove_participant', {
      userId: hostUser.userId,
    });

    expect(hostSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
      code: 'INVALID_REQUEST',
      message: 'Cannot remove yourself.',
    }));

    // Verify host remains in room
    expect(room.participants.has(hostUser.userId)).toBe(true);
    expect(room.getHost().userId).toBe(hostUser.userId);
  });

  // Test 3: assigning role to a non-existent user
  it('should reject assigning role to a non-existent user with USER_NOT_FOUND', async () => {
    await hostSocket.trigger('assign_role', {
      userId: 'non-existent-user-uuid',
      role: Role.MODERATOR,
    });

    expect(hostSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
      code: 'USER_NOT_FOUND',
      message: 'Target user is not in this room.',
    }));
  });

  // Test 4: removed user trying to send events afterwards (NOT_IN_ROOM)
  it('should reject a removed user trying to send control events afterwards with NOT_IN_ROOM', async () => {
    // Host kicks Charlie
    await hostSocket.trigger('remove_participant', {
      userId: participantUser.userId,
    });

    expect(participantSocket.emit).toHaveBeenCalledWith('removed', expect.anything());
    expect(room.participants.has(participantUser.userId)).toBe(false);

    // Charlie attempts playback events
    await participantSocket.trigger('play', {});
    expect(participantSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
      code: 'NOT_IN_ROOM',
      message: 'You are not in a room.',
    }));

    await participantSocket.trigger('pause', {});
    expect(participantSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
      code: 'NOT_IN_ROOM',
    }));

    await participantSocket.trigger('seek', { time: 100 });
    expect(participantSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
      code: 'NOT_IN_ROOM',
    }));

    await participantSocket.trigger('change_video', { videoId: 'dQw4w9WgXcQ' });
    expect(participantSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
      code: 'NOT_IN_ROOM',
    }));

    // Charlie attempts moderation events
    await participantSocket.trigger('assign_role', {
      userId: modUser.userId,
      role: Role.VIEWER,
    });
    expect(participantSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
      code: 'NOT_IN_ROOM',
    }));

    await participantSocket.trigger('remove_participant', {
      userId: modUser.userId,
    });
    expect(participantSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
      code: 'NOT_IN_ROOM',
    }));

    await participantSocket.trigger('transfer_host', {
      userId: modUser.userId,
    });
    expect(participantSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
      code: 'NOT_IN_ROOM',
    }));
  });
});
