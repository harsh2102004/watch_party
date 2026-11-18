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

describe('remove_participant event (guarded by HOST)', () => {
  let io, handler, hostSocket, participantSocket, targetSocket, hostUser, bobUser, charlieUser, room;
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

    // Host setup
    hostSocket = makeMockSocket('host-sock');
    socketMap.set(hostSocket.id, hostSocket);
    handler.register(hostSocket);
    await hostSocket.trigger('create_room', { username: 'Alice' });

    const createCall = hostSocket.emit.mock.calls.find(([e]) => e === 'room_created');
    const roomId = createCall[1].roomId;
    room = roomManager.getRoom(roomId);
    hostUser = room.getHost();

    // Participant setup (Bob)
    participantSocket = makeMockSocket('bob-sock');
    socketMap.set(participantSocket.id, participantSocket);
    handler.register(participantSocket);
    await participantSocket.trigger('join_room', { roomId, username: 'Bob' });
    bobUser = room.getParticipantBySocket(participantSocket.id);

    // Another participant setup (Charlie)
    targetSocket = makeMockSocket('charlie-sock');
    socketMap.set(targetSocket.id, targetSocket);
    handler.register(targetSocket);
    await targetSocket.trigger('join_room', { roomId, username: 'Charlie' });
    charlieUser = room.getParticipantBySocket(targetSocket.id);
  });

  it('should reject non-HOST (PARTICIPANT) with FORBIDDEN', async () => {
    await participantSocket.trigger('remove_participant', {
      userId: charlieUser.userId,
    });

    expect(participantSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
      code: 'FORBIDDEN',
    }));
    expect(room.participants.has(charlieUser.userId)).toBe(true);
  });

  it('should reject non-HOST (MODERATOR) with FORBIDDEN', async () => {
    room.setRole(bobUser.userId, Role.MODERATOR);

    await participantSocket.trigger('remove_participant', {
      userId: charlieUser.userId,
    });

    expect(participantSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
      code: 'FORBIDDEN',
    }));
    expect(room.participants.has(charlieUser.userId)).toBe(true);
  });

  it('should reject when HOST attempts to remove self', async () => {
    await hostSocket.trigger('remove_participant', {
      userId: hostUser.userId,
    });

    expect(hostSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
      code: 'INVALID_REQUEST',
      message: expect.stringContaining('Cannot remove yourself'),
    }));
    expect(room.participants.has(hostUser.userId)).toBe(true);
  });

  it('should reject when userId is missing or empty', async () => {
    await hostSocket.trigger('remove_participant', {});

    expect(hostSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
      code: 'INVALID_REQUEST',
      message: expect.stringContaining('userId is required'),
    }));

    await hostSocket.trigger('remove_participant', { userId: 12345 });
    expect(hostSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
      code: 'INVALID_REQUEST',
      message: expect.stringContaining('userId is required'),
    }));
  });

  it('should reject when target user is not in the room', async () => {
    await hostSocket.trigger('remove_participant', {
      userId: 'non-existent-user-id',
    });

    expect(hostSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
      code: 'USER_NOT_FOUND',
      message: expect.stringContaining('Target user is not in this room'),
    }));
  });

  it('should notify target socket with default reason, remove from room channel and Room model, and broadcast participant_removed to room', async () => {
    await hostSocket.trigger('remove_participant', {
      userId: charlieUser.userId,
    });

    // 1. Target socket notified with "removed" event and default reason
    expect(targetSocket.emit).toHaveBeenCalledWith('removed', {
      reason: 'Removed by host',
    });

    // 2. Target socket leaves the room channel
    expect(targetSocket.leave).toHaveBeenCalledWith(room.roomId);

    // 3. Removed from Room model
    expect(room.participants.has(charlieUser.userId)).toBe(false);
    expect(room.participants.size).toBe(2);

    // 4. Broadcast participant_removed to the rest of the room
    expect(io.to).toHaveBeenCalledWith(room.roomId);
    const roomBroadcast = io.to(room.roomId).emit;
    expect(roomBroadcast).toHaveBeenCalledWith('participant_removed', {
      userId: charlieUser.userId,
      participants: expect.arrayContaining([
        expect.objectContaining({ userId: hostUser.userId }),
        expect.objectContaining({ userId: bobUser.userId }),
      ]),
    });

    // Verify Charlie is not in the updated participants array
    const broadcastCall = roomBroadcast.mock.calls.find(([event]) => event === 'participant_removed');
    const participantsInPayload = broadcastCall[1].participants;
    expect(participantsInPayload.find((p) => p.userId === charlieUser.userId)).toBeUndefined();
  });

  it('should notify target socket with custom reason if provided', async () => {
    await hostSocket.trigger('remove_participant', {
      userId: bobUser.userId,
      reason: 'Disruptive behavior in chat',
    });

    expect(participantSocket.emit).toHaveBeenCalledWith('removed', {
      reason: 'Disruptive behavior in chat',
    });
    expect(participantSocket.leave).toHaveBeenCalledWith(room.roomId);
    expect(room.participants.has(bobUser.userId)).toBe(false);
  });

  it('should handle case when targetSocket is not found in socket map gracefully', async () => {
    // Delete socket from socketMap to simulate missing socket instance
    socketMap.delete(charlieUser.socketId);

    await hostSocket.trigger('remove_participant', {
      userId: charlieUser.userId,
    });

    // Room still removes participant and broadcasts
    expect(room.participants.has(charlieUser.userId)).toBe(false);
    expect(io.to).toHaveBeenCalledWith(room.roomId);
    expect(io.to(room.roomId).emit).toHaveBeenCalledWith('participant_removed', expect.objectContaining({
      userId: charlieUser.userId,
    }));
  });

  it('should reject a removed user trying to send events afterwards with NOT_IN_ROOM', async () => {
    // 1. Host removes Charlie from the room
    await hostSocket.trigger('remove_participant', {
      userId: charlieUser.userId,
    });
    expect(room.participants.has(charlieUser.userId)).toBe(false);

    // 2. Charlie tries to send playback events afterwards
    await targetSocket.trigger('play', {});
    expect(targetSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
      code: 'NOT_IN_ROOM',
      message: expect.stringContaining('You are not in a room'),
    }));

    // 3. Charlie tries to send moderation/control events afterwards
    await targetSocket.trigger('seek', { time: 42 });
    expect(targetSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
      code: 'NOT_IN_ROOM',
    }));

    await targetSocket.trigger('assign_role', { userId: bobUser.userId, role: Role.MODERATOR });
    expect(targetSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
      code: 'NOT_IN_ROOM',
    }));
  });
});
