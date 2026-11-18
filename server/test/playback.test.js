import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageHandler } from '../src/handlers/MessageHandler.js';
import { roomManager } from '../src/models/RoomManager.js';
import { Role } from '../src/models/role.js';

function makeMockSocket(id = 'playback-socket-1') {
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

describe('Playback Control Events (play, pause, seek)', () => {
  let io, handler, hostSocket, participantSocket, room;

  beforeEach(async () => {
    roomManager.rooms.clear();

    io = {
      to: vi.fn().mockReturnValue({ emit: vi.fn() }),
    };
    handler = new MessageHandler(io, roomManager);

    // Host setup
    hostSocket = makeMockSocket('host-sock');
    handler.register(hostSocket);
    await hostSocket.trigger('create_room', { username: 'Alice' });

    const createCall = hostSocket.emit.mock.calls.find(([e]) => e === 'room_created');
    const roomId = createCall[1].roomId;
    room = roomManager.getRoom(roomId);
    room.setVideo('test-vid-123');

    // Participant setup
    participantSocket = makeMockSocket('part-sock');
    handler.register(participantSocket);
    await participantSocket.trigger('join_room', { roomId, username: 'Bob' });
  });

  describe('play event', () => {
    it('should reject play if user is only a PARTICIPANT', async () => {
      await participantSocket.trigger('play', {});
      expect(participantSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
        code: 'FORBIDDEN',
      }));
      expect(room.playState).toBe('paused');
    });

    it('should allow HOST to play and broadcast sync_state with serverTimestamp', async () => {
      await hostSocket.trigger('play', {});

      expect(room.playState).toBe('playing');
      expect(io.to).toHaveBeenCalledWith(room.roomId);

      const toResult = io.to.mock.results.at(-1).value;
      expect(toResult.emit).toHaveBeenCalledWith('sync_state', expect.objectContaining({
        playState: 'playing',
        videoId: 'test-vid-123',
        currentTime: expect.any(Number),
        serverTimestamp: expect.any(Number),
      }));
    });
  });

  describe('pause event', () => {
    it('should reject pause if user is a PARTICIPANT', async () => {
      room.setPlaybackState('playing', 10);
      await participantSocket.trigger('pause', {});

      expect(participantSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
        code: 'FORBIDDEN',
      }));
      expect(room.playState).toBe('playing');
    });

    it('should allow HOST to pause and broadcast sync_state', async () => {
      room.setPlaybackState('playing', 10);
      await hostSocket.trigger('pause', {});

      expect(room.playState).toBe('paused');
      const toResult = io.to.mock.results.at(-1).value;
      expect(toResult.emit).toHaveBeenCalledWith('sync_state', expect.objectContaining({
        playState: 'paused',
        currentTime: expect.any(Number),
        serverTimestamp: expect.any(Number),
      }));
    });
  });

  describe('seek event', () => {
    it('should reject seek if time is negative or not a number', async () => {
      await hostSocket.trigger('seek', { time: -5 });
      expect(hostSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
        code: 'INVALID_TIME',
      }));

      await hostSocket.trigger('seek', { time: 'invalid' });
      expect(hostSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
        code: 'INVALID_TIME',
      }));
    });

    it('should update room currentTime and broadcast sync_state when valid', async () => {
      await hostSocket.trigger('seek', { time: 45.5 });

      expect(room.currentTime).toBe(45.5);
      const toResult = io.to.mock.results.at(-1).value;
      expect(toResult.emit).toHaveBeenCalledWith('sync_state', expect.objectContaining({
        currentTime: 45.5,
        serverTimestamp: expect.any(Number),
      }));
    });

    it('should allow a MODERATOR to seek', async () => {
      const bob = room.getParticipantBySocket(participantSocket.id);
      room.setRole(bob.userId, Role.MODERATOR);

      await participantSocket.trigger('seek', { time: 100 });
      expect(room.currentTime).toBe(100);
      expect(participantSocket.emit).not.toHaveBeenCalledWith('error_event', expect.anything());
    });
  });

  describe('change_video event', () => {
    it('should reject change_video if user is a PARTICIPANT', async () => {
      await participantSocket.trigger('change_video', { videoId: 'dQw4w9WgXcQ' });
      expect(participantSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
        code: 'FORBIDDEN',
      }));
      expect(room.videoId).toBe('test-vid-123');
    });

    it('should reject invalid video URL or ID with INVALID_VIDEO', async () => {
      await hostSocket.trigger('change_video', { videoId: 'not-a-valid-youtube-video' });
      expect(hostSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
        code: 'INVALID_VIDEO',
      }));
      expect(room.videoId).toBe('test-vid-123');
    });

    it('should allow HOST to change video with a full URL, reset time to 0, pause, and broadcast', async () => {
      room.setPlaybackState('playing', 120);

      await hostSocket.trigger('change_video', {
        videoId: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=50s',
      });

      expect(room.videoId).toBe('dQw4w9WgXcQ');
      expect(room.currentTime).toBe(0);
      expect(room.playState).toBe('paused');

      const toResult = io.to.mock.results.at(-1).value;
      expect(toResult.emit).toHaveBeenCalledWith('sync_state', expect.objectContaining({
        videoId: 'dQw4w9WgXcQ',
        currentTime: 0,
        playState: 'paused',
        serverTimestamp: expect.any(Number),
      }));
    });

    it('should allow MODERATOR to change video with a raw 11-char ID', async () => {
      const bob = room.getParticipantBySocket(participantSocket.id);
      room.setRole(bob.userId, Role.MODERATOR);

      await participantSocket.trigger('change_video', { videoId: 'a-B_1234567' });
      expect(room.videoId).toBe('a-B_1234567');
      expect(room.currentTime).toBe(0);
      expect(room.playState).toBe('paused');
    });
  });

  describe('Late joiner synchronization & PARTICIPANT state protection', () => {
    it('should provide joining user with the correct extrapolated currentTime mid-video', async () => {
      // Advance playback: video playing from 20s, with 15s elapsed
      room.currentTime = 20;
      room.playState = 'playing';
      room.lastUpdatedAt = Date.now() - 15000; // 15 seconds ago

      const lateSocket = makeMockSocket('late-sock');
      handler.register(lateSocket);

      await lateSocket.trigger('join_room', {
        roomId: room.roomId,
        username: 'LateCharlie',
      });

      const joinCall = lateSocket.emit.mock.calls.find(([e]) => e === 'room_joined');
      expect(joinCall).toBeDefined();

      const { sync_state } = joinCall[1];
      expect(sync_state.playState).toBe('playing');
      expect(sync_state.videoId).toBe('test-vid-123');
      // Should extrapolate: 20 + ~15 = ~35
      expect(sync_state.currentTime).toBeGreaterThanOrEqual(34.9);
      expect(sync_state.currentTime).toBeLessThanOrEqual(35.5);
    });

    it('should reject play, seek, and change_video from PARTICIPANT with FORBIDDEN and preserve room state', async () => {
      room.currentTime = 50;
      room.playState = 'playing';
      room.videoId = 'original-vid';

      // 1. Participant tries play
      await participantSocket.trigger('play', {});
      expect(participantSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
        code: 'FORBIDDEN',
      }));
      expect(room.currentTime).toBe(50);
      expect(room.playState).toBe('playing');

      // 2. Participant tries seek
      await participantSocket.trigger('seek', { time: 999 });
      expect(participantSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
        code: 'FORBIDDEN',
      }));
      expect(room.currentTime).toBe(50);

      // 3. Participant tries change_video
      await participantSocket.trigger('change_video', { videoId: 'dQw4w9WgXcQ' });
      expect(participantSocket.emit).toHaveBeenCalledWith('error_event', expect.objectContaining({
        code: 'FORBIDDEN',
      }));
      expect(room.videoId).toBe('original-vid');
      expect(room.currentTime).toBe(50);
      expect(room.playState).toBe('playing');
    });
  });
});
