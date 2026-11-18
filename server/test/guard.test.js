import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withPermission } from '../src/handlers/guard.js';
import { RoomManager } from '../src/models/RoomManager.js';
import { Participant } from '../src/models/Participant.js';
import { Role } from '../src/models/role.js';

function makeMockSocket(id = 'sock-guard-1') {
  return {
    id,
    emit: vi.fn(),
  };
}

describe('guard - withPermission(action, roomManager, socket, handler)', () => {
  let roomManager;
  let socket;

  beforeEach(() => {
    roomManager = new RoomManager();
    socket = makeMockSocket();
  });

  it('should emit NOT_IN_ROOM when socket is not in any room', async () => {
    const handler = vi.fn();
    const guarded = withPermission('play', roomManager, socket, handler);

    await guarded({});

    expect(handler).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('error_event', {
      code: 'NOT_IN_ROOM',
      message: 'You are not in a room.',
    });
  });

  it('should emit FORBIDDEN when participant does not have permission', async () => {
    const room = roomManager.createRoom();
    const participant = new Participant({ username: 'Alice', socketId: socket.id, role: Role.PARTICIPANT });
    room.addParticipant(participant);

    const handler = vi.fn();
    const guarded = withPermission('play', roomManager, socket, handler);

    await guarded({ roomId: room.roomId });

    expect(handler).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('error_event', {
      code: 'FORBIDDEN',
      message: 'Role "PARTICIPANT" is not allowed to perform action "play".',
    });
  });

  it('should call handler with context when user has permission (HOST)', async () => {
    const room = roomManager.createRoom();
    const host = new Participant({ username: 'HostUser', socketId: socket.id, role: Role.HOST });
    room.addParticipant(host);

    const handler = vi.fn();
    const guarded = withPermission('play', roomManager, socket, handler);

    await guarded({ roomId: room.roomId, time: 42 });

    expect(handler).toHaveBeenCalledWith({
      socket,
      room,
      participant: host,
      data: { roomId: room.roomId, time: 42 },
    });
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('should allow MODERATOR to perform permitted action and block unpermitted action', async () => {
    const room = roomManager.createRoom();
    const mod = new Participant({ username: 'ModUser', socketId: socket.id, role: Role.MODERATOR });
    room.addParticipant(mod);

    const playHandler = vi.fn();
    const guardedPlay = withPermission('play', roomManager, socket, playHandler);
    await guardedPlay({});
    expect(playHandler).toHaveBeenCalled();

    const transferHandler = vi.fn();
    const guardedTransfer = withPermission('transfer_host', roomManager, socket, transferHandler);
    await guardedTransfer({});
    expect(transferHandler).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({ code: 'FORBIDDEN' }));
  });
});
