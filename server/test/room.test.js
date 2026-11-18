import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Room } from '../src/models/Room.js';
import { Participant } from '../src/models/Participant.js';
import { Role } from '../src/models/role.js';

describe('Room Model', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getComputedTime (playing vs paused)', () => {
    it('should return fixed currentTime when playState is paused', () => {
      const room = new Room({ roomId: 'TEST01', currentTime: 15.5, playState: 'paused' });
      expect(room.getComputedTime()).toBe(15.5);

      // Advance time by 10 seconds
      vi.advanceTimersByTime(10000);

      // Remains 15.5 since playback is paused
      expect(room.getComputedTime()).toBe(15.5);
    });

    it('should extrapolate currentTime when playState is playing', () => {
      const room = new Room({ roomId: 'TEST02', currentTime: 10, playState: 'playing' });
      expect(room.getComputedTime()).toBe(10);

      // Advance time by 2.5 seconds (2500ms)
      vi.advanceTimersByTime(2500);
      expect(room.getComputedTime()).toBeCloseTo(12.5, 3);

      // Advance time by another 5 seconds
      vi.advanceTimersByTime(5000);
      expect(room.getComputedTime()).toBeCloseTo(17.5, 3);
    });

    it('should stop extrapolating after switching to paused', () => {
      const room = new Room({ roomId: 'TEST03', currentTime: 0, playState: 'playing' });

      // Play for 4 seconds
      vi.advanceTimersByTime(4000);
      const computedAtPause = room.getComputedTime();
      expect(computedAtPause).toBeCloseTo(4, 3);

      // Pause playback
      room.setPlaybackState('paused');
      expect(room.getComputedTime()).toBeCloseTo(4, 3);

      // Advance more time while paused
      vi.advanceTimersByTime(6000);
      expect(room.getComputedTime()).toBeCloseTo(4, 3);
    });
  });

  describe('Role changes & assignments', () => {
    it('should update a participant role correctly', () => {
      const room = new Room({ roomId: 'TEST04' });
      const participant = new Participant({ username: 'Alice', socketId: 'sock-1', role: Role.VIEWER });
      room.addParticipant(participant);

      expect(room.getParticipant(participant.userId)?.role).toBe(Role.VIEWER);

      const updated = room.setRole(participant.userId, Role.MODERATOR);
      expect(updated).not.toBeNull();
      expect(updated?.role).toBe(Role.MODERATOR);
      expect(room.getParticipant(participant.userId)?.role).toBe(Role.MODERATOR);
    });

    it('should return null when setting role for a non-existent participant', () => {
      const room = new Room({ roomId: 'TEST05' });
      const result = room.setRole('non-existent-user-id', Role.MODERATOR);
      expect(result).toBeNull();
    });

    it('should locate the room host accurately after role changes', () => {
      const room = new Room({ roomId: 'TEST06' });
      const user1 = new Participant({ username: 'Alice', socketId: 'sock-1', role: Role.HOST });
      const user2 = new Participant({ username: 'Bob', socketId: 'sock-2', role: Role.VIEWER });

      room.addParticipant(user1);
      room.addParticipant(user2);

      expect(room.getHost()?.userId).toBe(user1.userId);

      // Transfer host role to Bob
      room.setRole(user1.userId, Role.PARTICIPANT);
      room.setRole(user2.userId, Role.HOST);

      expect(room.getHost()?.userId).toBe(user2.userId);
    });
  });

  describe('Pending requests management', () => {
    it('should add a valid pending request with generated id and createdAt', () => {
      const room = new Room({ roomId: 'TEST07' });
      const req = room.addRequest({
        type: 'play',
        requesterId: 'user-1',
        requesterName: 'Bob',
      });

      expect(req.id).toBeDefined();
      expect(typeof req.id).toBe('string');
      expect(req.type).toBe('play');
      expect(req.payload).toEqual({});
      expect(req.requesterId).toBe('user-1');
      expect(req.requesterName).toBe('Bob');
      expect(typeof req.createdAt).toBe('number');
      expect(room.pendingRequests.size).toBe(1);
    });

    it('should accept custom id, payload, and createdAt', () => {
      const room = new Room({ roomId: 'TEST08' });
      const customTime = Date.now() - 5000;
      const req = room.addRequest({
        id: 'custom-req-id-1',
        type: 'seek',
        payload: { time: 45 },
        requesterId: 'user-2',
        requesterName: 'Charlie',
        createdAt: customTime,
      });

      expect(req.id).toBe('custom-req-id-1');
      expect(req.type).toBe('seek');
      expect(req.payload).toEqual({ time: 45 });
      expect(req.createdAt).toBe(customTime);
    });

    it('should reject invalid request types with an error', () => {
      const room = new Room({ roomId: 'TEST09' });
      expect(() => {
        room.addRequest({
          type: 'invalid_action',
          requesterId: 'user-1',
          requesterName: 'Bob',
        });
      }).toThrow(/Invalid request type/);
    });

    it('should retrieve a request with getRequest and list with getPendingList', () => {
      const room = new Room({ roomId: 'TEST10' });
      const req1 = room.addRequest({
        type: 'change_video',
        payload: { videoId: 'dQw4w9WgXcQ' },
        requesterId: 'user-1',
        requesterName: 'Bob',
      });
      const req2 = room.addRequest({
        type: 'pause',
        requesterId: 'user-2',
        requesterName: 'Charlie',
      });

      expect(room.getRequest(req1.id)).toEqual(req1);
      expect(room.getRequest(req2.id)).toEqual(req2);
      expect(room.getRequest('non-existent-id')).toBeUndefined();

      const list = room.getPendingList();
      expect(list).toHaveLength(2);
      expect(list).toEqual(expect.arrayContaining([req1, req2]));
    });

    it('should remove a request by ID with removeRequest', () => {
      const room = new Room({ roomId: 'TEST11' });
      const req = room.addRequest({
        type: 'play',
        requesterId: 'user-1',
        requesterName: 'Bob',
      });

      expect(room.removeRequest(req.id)).toBe(true);
      expect(room.getRequest(req.id)).toBeUndefined();
      expect(room.removeRequest(req.id)).toBe(false);
      expect(room.pendingRequests.size).toBe(0);
    });

    it('should clean expired requests based on ttlMs and return removed requests', () => {
      const room = new Room({ roomId: 'TEST12' });
      const now = Date.now();

      // Older than 30s
      const reqOld1 = room.addRequest({
        type: 'play',
        requesterId: 'user-1',
        requesterName: 'Bob',
        createdAt: now - 35000,
      });

      // Older than 30s
      const reqOld2 = room.addRequest({
        type: 'seek',
        payload: { time: 10 },
        requesterId: 'user-2',
        requesterName: 'Charlie',
        createdAt: now - 40000,
      });

      // Fresh request (10s old)
      const reqFresh = room.addRequest({
        type: 'pause',
        requesterId: 'user-3',
        requesterName: 'Dave',
        createdAt: now - 10000,
      });

      expect(room.pendingRequests.size).toBe(3);

      // Clean with 30s TTL
      const removed = room.cleanExpired(30000);

      expect(removed).toHaveLength(2);
      expect(removed).toEqual(expect.arrayContaining([reqOld1, reqOld2]));
      expect(room.pendingRequests.size).toBe(1);
      expect(room.getRequest(reqFresh.id)).toEqual(reqFresh);
      expect(room.getRequest(reqOld1.id)).toBeUndefined();
      expect(room.getRequest(reqOld2.id)).toBeUndefined();
    });
  });
});
