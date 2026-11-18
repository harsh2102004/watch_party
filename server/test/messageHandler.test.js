import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageHandler, emitError } from '../src/handlers/MessageHandler.js';
import { roomManager } from '../src/models/RoomManager.js';

function makeMockSocket(id = 'socket-test-1') {
  const events = {};
  return {
    id,
    emit: vi.fn(),
    join: vi.fn().mockResolvedValue(undefined),
    on: (event, cb) => { events[event] = cb; },
    trigger: (event, data) => events[event]?.(data),
  };
}

describe('MessageHandler', () => {
  beforeEach(() => {
    roomManager.rooms.clear();
  });

  describe('emitError helper', () => {
    it('should emit error_event with code and message', () => {
      const socket = makeMockSocket();
      emitError(socket, 'ROOM_NOT_FOUND', 'Room does not exist.');
      expect(socket.emit).toHaveBeenCalledWith('error_event', {
        code: 'ROOM_NOT_FOUND',
        message: 'Room does not exist.',
      });
    });
  });

  describe('create_room event', () => {
    let io, handler, socket;

    beforeEach(() => {
      io = { to: vi.fn().mockReturnValue({ emit: vi.fn() }) };
      handler = new MessageHandler(io, roomManager);
      socket = makeMockSocket();
      handler.register(socket);
    });

    it('should emit error_event for missing username', async () => {
      await socket.trigger('create_room', {});
      expect(socket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({ code: 'INVALID_USERNAME' }));
    });

    it('should emit error_event for empty username', async () => {
      await socket.trigger('create_room', { username: '   ' });
      expect(socket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({ code: 'INVALID_USERNAME' }));
    });

    it('should emit error_event for username exceeding 20 chars', async () => {
      await socket.trigger('create_room', { username: 'a'.repeat(21) });
      expect(socket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({ code: 'INVALID_USERNAME' }));
    });

    it('should create room and emit room_created with correct shape', async () => {
      await socket.trigger('create_room', { username: 'Alice' });

      expect(socket.emit).toHaveBeenCalledWith('room_created', expect.objectContaining({
        roomId: expect.stringMatching(/^[A-Z0-9]{6}$/),
        userId: expect.any(String),
        role: 'HOST',
        participants: expect.arrayContaining([
          expect.objectContaining({ username: 'Alice', role: 'HOST' }),
        ]),
        state: expect.objectContaining({
          playState: 'paused',
          currentTime: expect.any(Number),
        }),
      }));
    });

    it('should trim whitespace from username', async () => {
      await socket.trigger('create_room', { username: '  Bob  ' });
      const call = socket.emit.mock.calls.find(([event]) => event === 'room_created');
      expect(call).toBeTruthy();
      const payload = call[1];
      expect(payload.participants[0].username).toBe('Bob');
    });

    it('should join the socket to the room channel', async () => {
      await socket.trigger('create_room', { username: 'Carol' });
      expect(socket.join).toHaveBeenCalledWith(expect.stringMatching(/^[A-Z0-9]{6}$/));
    });

    it('should add room to roomManager', async () => {
      await socket.trigger('create_room', { username: 'Dave' });
      expect(roomManager.rooms.size).toBe(1);
    });
  });

  describe('join_room event', () => {
    let io, handler, hostSocket, joinerSocket, roomId;

    beforeEach(async () => {
      io = {
        to: vi.fn().mockReturnValue({ emit: vi.fn() }),
      };
      handler = new MessageHandler(io, roomManager);

      // Create a room with a host first
      hostSocket = makeMockSocket('host-socket');
      handler.register(hostSocket);
      await hostSocket.trigger('create_room', { username: 'Alice' });

      // Grab the roomId that was emitted
      const roomCreatedCall = hostSocket.emit.mock.calls.find(([e]) => e === 'room_created');
      roomId = roomCreatedCall[1].roomId;

      // Prepare a fresh joiner socket
      joinerSocket = makeMockSocket('joiner-socket');
      joinerSocket.to = vi.fn().mockReturnValue({ emit: vi.fn() });
      handler.register(joinerSocket);
    });

    it('should emit ROOM_NOT_FOUND for a non-existent roomId', async () => {
      await joinerSocket.trigger('join_room', { roomId: 'XXXXXX', username: 'Bob' });
      expect(joinerSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({ code: 'ROOM_NOT_FOUND' }));
    });

    it('should emit INVALID_USERNAME for missing username', async () => {
      await joinerSocket.trigger('join_room', { roomId });
      expect(joinerSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({ code: 'INVALID_USERNAME' }));
    });

    it('should emit USERNAME_TAKEN for duplicate username', async () => {
      await joinerSocket.trigger('join_room', { roomId, username: 'Alice' });
      expect(joinerSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({ code: 'USERNAME_TAKEN' }));
    });

    it('should emit USERNAME_TAKEN case-insensitively', async () => {
      await joinerSocket.trigger('join_room', { roomId, username: 'alice' });
      expect(joinerSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({ code: 'USERNAME_TAKEN' }));
    });

    it('should emit room_joined with correct shape', async () => {
      await joinerSocket.trigger('join_room', { roomId, username: 'Bob' });

      expect(joinerSocket.emit).toHaveBeenCalledWith('room_joined', expect.objectContaining({
        roomId: expect.stringMatching(/^[A-Z0-9]{6}$/),
        userId: expect.any(String),
        role: 'PARTICIPANT',
        participants: expect.arrayContaining([
          expect.objectContaining({ username: 'Alice', role: 'HOST' }),
          expect.objectContaining({ username: 'Bob',   role: 'PARTICIPANT' }),
        ]),
        sync_state: expect.objectContaining({
          playState: 'paused',
          currentTime: expect.any(Number),
        }),
      }));
    });

    it('should broadcast user_joined to others in the room', async () => {
      await joinerSocket.trigger('join_room', { roomId, username: 'Bob' });
      expect(joinerSocket.to).toHaveBeenCalledWith(roomId);
      const toResult = joinerSocket.to.mock.results[0].value;
      expect(toResult.emit).toHaveBeenCalledWith('user_joined', expect.objectContaining({
        username: 'Bob',
        role: 'PARTICIPANT',
        participants: expect.any(Array),
      }));
    });

    it('should add joiner to room participants', async () => {
      const room = roomManager.getRoom(roomId);
      expect(room.participants.size).toBe(1); // only host
      await joinerSocket.trigger('join_room', { roomId, username: 'Bob' });
      expect(room.participants.size).toBe(2); // host + joiner
    });
  });

  describe('leave_room event', () => {
    let io, handler, hostSocket, joinerSocket, roomId;

    beforeEach(async () => {
      io = { to: vi.fn().mockReturnValue({ emit: vi.fn() }) };
      handler = new MessageHandler(io, roomManager);

      hostSocket = makeMockSocket('host-socket');
      handler.register(hostSocket);
      await hostSocket.trigger('create_room', { username: 'Alice' });

      const roomCreatedCall = hostSocket.emit.mock.calls.find(([e]) => e === 'room_created');
      roomId = roomCreatedCall[1].roomId;

      joinerSocket = makeMockSocket('joiner-socket');
      joinerSocket.to = vi.fn().mockReturnValue({ emit: vi.fn() });
      joinerSocket.leave = vi.fn().mockResolvedValue(undefined);
      handler.register(joinerSocket);
      await joinerSocket.trigger('join_room', { roomId, username: 'Bob' });
    });

    it('should emit ROOM_NOT_FOUND for a non-existent roomId', async () => {
      await joinerSocket.trigger('leave_room', { roomId: 'XXXXXX' });
      expect(joinerSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({ code: 'ROOM_NOT_FOUND' }));
    });

    it('should remove participant from the room', async () => {
      const room = roomManager.getRoom(roomId);
      expect(room.participants.size).toBe(2);
      await joinerSocket.trigger('leave_room', { roomId });
      expect(room.participants.size).toBe(1);
    });

    it('should call socket.leave with the roomId', async () => {
      await joinerSocket.trigger('leave_room', { roomId });
      expect(joinerSocket.leave).toHaveBeenCalledWith(roomId);
    });

    it('should broadcast user_left with updated participants list', async () => {
      await joinerSocket.trigger('leave_room', { roomId });
      expect(io.to).toHaveBeenCalledWith(roomId);
      const toResult = io.to.mock.results.at(-1).value;
      expect(toResult.emit).toHaveBeenCalledWith('user_left', expect.objectContaining({
        username: 'Bob',
        participants: expect.arrayContaining([
          expect.objectContaining({ username: 'Alice' }),
        ]),
      }));
    });

    it('should delete the room when the last participant leaves', async () => {
      // Host leaves first
      hostSocket.leave = vi.fn().mockResolvedValue(undefined);
      await hostSocket.trigger('leave_room', { roomId });
      expect(roomManager.rooms.size).toBe(1); // joiner still in room

      // Joiner leaves — room should be deleted
      await joinerSocket.trigger('leave_room', { roomId });
      expect(roomManager.rooms.size).toBe(0);
    });
  });

  describe('disconnect handler', () => {
    let io, handler, hostSocket, joinerSocket, roomId;

    beforeEach(async () => {
      io = { to: vi.fn().mockReturnValue({ emit: vi.fn() }) };
      handler = new MessageHandler(io, roomManager);

      hostSocket = makeMockSocket('host-socket');
      handler.register(hostSocket);
      await hostSocket.trigger('create_room', { username: 'Alice' });

      const roomCreatedCall = hostSocket.emit.mock.calls.find(([e]) => e === 'room_created');
      roomId = roomCreatedCall[1].roomId;

      joinerSocket = makeMockSocket('joiner-socket');
      joinerSocket.to = vi.fn().mockReturnValue({ emit: vi.fn() });
      handler.register(joinerSocket);
      await joinerSocket.trigger('join_room', { roomId, username: 'Bob' });
    });

    it('should remove participant and broadcast user_left on disconnect', async () => {
      const room = roomManager.getRoom(roomId);
      expect(room.participants.size).toBe(2);

      joinerSocket.trigger('disconnect');

      expect(room.participants.size).toBe(1);
      expect(io.to).toHaveBeenCalledWith(roomId);
      const toResult = io.to.mock.results.at(-1).value;
      expect(toResult.emit).toHaveBeenCalledWith('user_left', expect.objectContaining({
        username: 'Bob',
      }));
    });

    it('should delete room when last user disconnects', () => {
      hostSocket.trigger('disconnect');
      joinerSocket.trigger('disconnect');
      expect(roomManager.rooms.size).toBe(0);
    });
  });

  describe('Host departure and auto-promotion', () => {
    let io, handler, hostSocket, modSocket, participantSocket, roomId;

    beforeEach(async () => {
      io = { to: vi.fn().mockReturnValue({ emit: vi.fn() }) };
      handler = new MessageHandler(io, roomManager);

      // Create room with Host Alice
      hostSocket = makeMockSocket('host-socket');
      hostSocket.leave = vi.fn().mockResolvedValue(undefined);
      handler.register(hostSocket);
      await hostSocket.trigger('create_room', { username: 'Alice' });

      const roomCreatedCall = hostSocket.emit.mock.calls.find(([e]) => e === 'room_created');
      roomId = roomCreatedCall[1].roomId;

      // Join participant Bob
      participantSocket = makeMockSocket('participant-socket');
      participantSocket.to = vi.fn().mockReturnValue({ emit: vi.fn() });
      handler.register(participantSocket);
      await participantSocket.trigger('join_room', { roomId, username: 'Bob' });

      // Join moderator Charlie
      modSocket = makeMockSocket('mod-socket');
      modSocket.to = vi.fn().mockReturnValue({ emit: vi.fn() });
      handler.register(modSocket);
      await modSocket.trigger('join_room', { roomId, username: 'Charlie' });

      // Manually set Charlie to MODERATOR
      const room = roomManager.getRoom(roomId);
      const charlie = room.getParticipantBySocket('mod-socket');
      room.setRole(charlie.userId, 'MODERATOR');
    });

    it('should prioritize promoting MODERATOR over PARTICIPANT when host leaves', async () => {
      const room = roomManager.getRoom(roomId);
      await hostSocket.trigger('leave_room', { roomId });

      // Charlie (the MODERATOR) should now be HOST
      const charlie = room.getParticipantBySocket('mod-socket');
      expect(charlie.role).toBe('HOST');

      // Check broadcast
      expect(io.to).toHaveBeenCalledWith(roomId);
      const roleAssignedCall = io.to.mock.results.map((r) => r.value.emit)
        .flatMap((fn) => fn.mock.calls)
        .find(([event]) => event === 'role_assigned');

      expect(roleAssignedCall).toBeDefined();
      expect(roleAssignedCall[1]).toEqual(expect.objectContaining({
        userId: charlie.userId,
        username: 'Charlie',
        role: 'HOST',
        participants: expect.any(Array),
      }));
    });

    it('should promote earliest-joined PARTICIPANT when no MODERATOR exists', async () => {
      const room = roomManager.getRoom(roomId);
      // Remove MODERATOR role so both Bob and Charlie are PARTICIPANT
      const charlie = room.getParticipantBySocket('mod-socket');
      room.setRole(charlie.userId, 'PARTICIPANT');

      // Host disconnects
      hostSocket.trigger('disconnect');

      // Bob joined before Charlie, so Bob becomes HOST
      const bob = room.getParticipantBySocket('participant-socket');
      expect(bob.role).toBe('HOST');
      expect(room.getHost()?.userId).toBe(bob.userId);
    });
  });
});
