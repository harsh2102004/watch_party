/**
 * @file auth.test.js
 * @description Comprehensive unit & integration tests for authentication:
 * 1. User registration, login, input validation, duplicate handling, DB-disconnected 503s.
 * 2. Socket.IO handshake authentication (valid JWT, invalid JWT, guest mode fallback, guest rejection).
 * 3. Reconnect and role restoration, including active single-session enforcement (second-tab disconnect).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { app } from '../src/index.js';
import { User } from '../src/db/models/index.js';
import * as connectModule from '../src/db/connect.js';
import { getJwtSecret } from '../src/routes/auth.js';
import { Role } from '../src/models/role.js';
import { socketAuthMiddleware } from '../src/middleware/socketAuth.js';
import { MessageHandler } from '../src/handlers/MessageHandler.js';
import { roomManager } from '../src/models/RoomManager.js';

function makeMockSocket(id = 'socket-test-1', auth = {}) {
  const events = {};
  return {
    id,
    handshake: { auth },
    data: {},
    emit: vi.fn(),
    join: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn().mockResolvedValue(undefined),
    to: vi.fn().mockReturnValue({ emit: vi.fn() }),
    disconnect: vi.fn(),
    on: (event, cb) => {
      events[event] = cb;
    },
    trigger: async (event, data) => {
      if (events[event]) {
        await events[event](data);
      }
    },
  };
}

describe('Authentication & Socket Identity Lifecycle', () => {
  let originalAllowGuests;
  let originalNodeEnv;

  beforeEach(() => {
    roomManager.rooms.clear();
    originalAllowGuests = process.env.ALLOW_GUESTS;
    originalNodeEnv = process.env.NODE_ENV;
    process.env.ALLOW_GUESTS = 'true';
  });

  afterEach(() => {
    process.env.ALLOW_GUESTS = originalAllowGuests;
    process.env.NODE_ENV = originalNodeEnv;
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // STEP 1 - REST API Authentication Routes
  // ---------------------------------------------------------------------------
  describe('POST /auth/register', () => {
    it('should successfully register a new user, hash password, and return JWT token without passwordHash', async () => {
      vi.spyOn(connectModule, 'isDbConnected').mockReturnValue(true);
      vi.spyOn(User, 'findOne').mockResolvedValue(null);

      const fakeUser = {
        _id: '507f1f77bcf86cd799439011',
        email: 'alice@example.com',
        username: 'alice_w',
        passwordHash: 'hashed_pw',
      };
      vi.spyOn(User, 'create').mockResolvedValue(fakeUser);

      const res = await request(app)
        .post('/auth/register')
        .send({
          email: '  Alice@Example.com  ',
          username: 'alice_w',
          password: 'password123',
        });

      expect(res.status).toBe(201);
      expect(res.body.token).toBeDefined();
      expect(res.body.user).toEqual({
        userId: '507f1f77bcf86cd799439011',
        email: 'alice@example.com',
        username: 'alice_w',
      });
      expect(res.body.user.passwordHash).toBeUndefined();

      // Verify JWT payload
      const decoded = jwt.verify(res.body.token, getJwtSecret());
      expect(decoded.userId).toBe('507f1f77bcf86cd799439011');
      expect(decoded.username).toBe('alice_w');
    });

    it('should reject invalid email format with 400', async () => {
      vi.spyOn(connectModule, 'isDbConnected').mockReturnValue(true);

      const res = await request(app)
        .post('/auth/register')
        .send({ email: 'invalid-email', username: 'alice_w', password: 'password123' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_EMAIL');
    });

    it('should reject username less than 3 chars or with invalid characters with 400', async () => {
      vi.spyOn(connectModule, 'isDbConnected').mockReturnValue(true);

      const res1 = await request(app)
        .post('/auth/register')
        .send({ email: 'alice@test.com', username: 'al', password: 'password123' });
      expect(res1.status).toBe(400);
      expect(res1.body.error).toBe('INVALID_USERNAME');

      const res2 = await request(app)
        .post('/auth/register')
        .send({ email: 'alice@test.com', username: 'alice with spaces!', password: 'password123' });
      expect(res2.status).toBe(400);
      expect(res2.body.error).toBe('INVALID_USERNAME');
    });

    it('should reject password less than 8 characters with 400', async () => {
      vi.spyOn(connectModule, 'isDbConnected').mockReturnValue(true);

      const res = await request(app)
        .post('/auth/register')
        .send({ email: 'alice@test.com', username: 'alice_w', password: 'short' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_PASSWORD');
    });

    it('should return 409 when email is already registered', async () => {
      vi.spyOn(connectModule, 'isDbConnected').mockReturnValue(true);
      vi.spyOn(User, 'findOne').mockImplementation(({ email }) => {
        if (email === 'alice@example.com') return Promise.resolve({ _id: '1' });
        return Promise.resolve(null);
      });

      const res = await request(app)
        .post('/auth/register')
        .send({ email: 'alice@example.com', username: 'alice_w', password: 'password123' });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('DUPLICATE_EMAIL');
    });

    it('should return 409 when username is already taken', async () => {
      vi.spyOn(connectModule, 'isDbConnected').mockReturnValue(true);
      vi.spyOn(User, 'findOne').mockImplementation(({ email, username }) => {
        if (username === 'alice_w') return Promise.resolve({ _id: '1' });
        return Promise.resolve(null);
      });

      const res = await request(app)
        .post('/auth/register')
        .send({ email: 'other@example.com', username: 'alice_w', password: 'password123' });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('DUPLICATE_USERNAME');
    });

    it('should return 503 when database is disconnected', async () => {
      vi.spyOn(connectModule, 'isDbConnected').mockReturnValue(false);

      const res = await request(app)
        .post('/auth/register')
        .send({ email: 'alice@example.com', username: 'alice_w', password: 'password123' });

      expect(res.status).toBe(503);
      expect(res.body.error).toBe('SERVICE_UNAVAILABLE');
    });
  });

  describe('POST /auth/login', () => {
    it('should authenticate user with correct password and issue JWT', async () => {
      vi.spyOn(connectModule, 'isDbConnected').mockReturnValue(true);

      const passwordHash = await bcrypt.hash('secretPass123', 10);
      const fakeUser = {
        _id: '507f1f77bcf86cd799439022',
        email: 'bob@example.com',
        username: 'bob_builder',
        passwordHash,
      };

      vi.spyOn(User, 'findOne').mockResolvedValue(fakeUser);

      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'bob@example.com', password: 'secretPass123' });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.user).toEqual({
        userId: '507f1f77bcf86cd799439022',
        email: 'bob@example.com',
        username: 'bob_builder',
      });
    });

    it('should reject login with wrong password (401)', async () => {
      vi.spyOn(connectModule, 'isDbConnected').mockReturnValue(true);

      const passwordHash = await bcrypt.hash('correctPassword', 10);
      vi.spyOn(User, 'findOne').mockResolvedValue({
        _id: '123',
        passwordHash,
      });

      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'bob@example.com', password: 'wrongPassword' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('INVALID_CREDENTIALS');
    });

    it('should return 503 when database is offline during login', async () => {
      vi.spyOn(connectModule, 'isDbConnected').mockReturnValue(false);

      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'bob@example.com', password: 'secretPass123' });

      expect(res.status).toBe(503);
      expect(res.body.error).toBe('SERVICE_UNAVAILABLE');
    });
  });

  describe('GET /auth/me', () => {
    it('should return authenticated user when valid Bearer token provided', async () => {
      vi.spyOn(connectModule, 'isDbConnected').mockReturnValue(true);

      const token = jwt.sign(
        { userId: '507f1f77bcf86cd799439033', username: 'carol_danvers' },
        getJwtSecret(),
        { expiresIn: '1d' }
      );

      vi.spyOn(User, 'findById').mockResolvedValue({
        _id: '507f1f77bcf86cd799439033',
        email: 'carol@example.com',
        username: 'carol_danvers',
      });

      const res = await request(app)
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.user).toEqual({
        userId: '507f1f77bcf86cd799439033',
        email: 'carol@example.com',
        username: 'carol_danvers',
      });
    });

    it('should reject requests without authorization header (401)', async () => {
      const res = await request(app).get('/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHORIZED');
    });
  });

  describe('GET /auth/config', () => {
    it('should return allowGuests configuration', async () => {
      process.env.ALLOW_GUESTS = 'true';
      const res1 = await request(app).get('/auth/config');
      expect(res1.body.allowGuests).toBe(true);

      process.env.ALLOW_GUESTS = 'false';
      const res2 = await request(app).get('/auth/config');
      expect(res2.body.allowGuests).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // STEP 2 - Socket.IO Authentication Middleware
  // ---------------------------------------------------------------------------
  describe('socketAuthMiddleware', () => {
    it('should reject connection when ALLOW_GUESTS=false and no token is provided', () => {
      process.env.ALLOW_GUESTS = 'false';
      const socket = makeMockSocket('s1', {});
      const next = vi.fn();

      socketAuthMiddleware(socket, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(next.mock.calls[0][0].message).toContain('AUTHENTICATION_REQUIRED');
    });

    it('should allow connection when ALLOW_GUESTS=true and assign a guest identity', () => {
      process.env.ALLOW_GUESTS = 'true';
      const socket = makeMockSocket('s2', { username: 'GuestAlice' });
      const next = vi.fn();

      socketAuthMiddleware(socket, next);

      expect(next).toHaveBeenCalledWith();
      expect(socket.data.user).toBeDefined();
      expect(socket.data.user.isGuest).toBe(true);
      expect(socket.data.user.username).toBe('GuestAlice');
      expect(socket.data.user.userId).toContain('guest_');
    });

    it('should authenticate socket with valid JWT and populate socket.data.user', () => {
      const token = jwt.sign(
        { userId: 'user-auth-101', username: 'VerifiedUser' },
        getJwtSecret(),
        { expiresIn: '1h' }
      );
      const socket = makeMockSocket('s3', { token });
      const next = vi.fn();

      socketAuthMiddleware(socket, next);

      expect(next).toHaveBeenCalledWith();
      expect(socket.data.user).toEqual({
        userId: 'user-auth-101',
        username: 'VerifiedUser',
        isGuest: false,
      });
    });

    it('should reject socket with invalid or expired JWT token', () => {
      const socket = makeMockSocket('s4', { token: 'invalid.token.123' });
      const next = vi.fn();

      socketAuthMiddleware(socket, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(next.mock.calls[0][0].message).toContain('AUTHENTICATION_FAILED');
    });
  });

  // ---------------------------------------------------------------------------
  // STEP 3 - Reconnection & Role Restoration (and Active Single-Session)
  // ---------------------------------------------------------------------------
  describe('Reconnect & Role Restoration in MessageHandler', () => {
    let io, handler;

    beforeEach(() => {
      const activeSockets = new Map();
      io = {
        to: vi.fn().mockReturnValue({ emit: vi.fn() }),
        sockets: {
          sockets: activeSockets,
        },
      };
      handler = new MessageHandler(io, roomManager);
    });

    it('should enforce verified token identity in create_room and ignore client spoofed username', async () => {
      const socket = makeMockSocket('s-auth-1');
      socket.data.user = { userId: 'user-auth-101', username: 'VerifiedUser', isGuest: false };
      handler.register(socket);

      // Client attempts to spoof username
      await socket.trigger('create_room', { username: 'SpoofedName' });

      expect(socket.emit).toHaveBeenCalledWith(
        'room_created',
        expect.objectContaining({
          userId: 'user-auth-101',
          role: Role.HOST,
          participants: [expect.objectContaining({ username: 'VerifiedUser', role: Role.HOST })],
        })
      );
    });

    it('should restore previous role when authenticated user reconnects to the room', async () => {
      // 1. User creates room as HOST
      const socket1 = makeMockSocket('sock-1');
      socket1.data.user = { userId: 'user-reconnect-1', username: 'Alice', isGuest: false };
      io.sockets.sockets.set(socket1.id, socket1);
      handler.register(socket1);

      let createdRoomId;
      socket1.emit.mockImplementation((event, payload) => {
        if (event === 'room_created') createdRoomId = payload.roomId;
      });

      await socket1.trigger('create_room', {});
      expect(createdRoomId).toBeDefined();

      // 2. Disconnect socket1 (simulating page reload)
      await socket1.trigger('disconnect');

      // Room is in grace window; reconnect socket2 with same userId
      const socket2 = makeMockSocket('sock-2');
      socket2.data.user = { userId: 'user-reconnect-1', username: 'Alice', isGuest: false };
      io.sockets.sockets.set(socket2.id, socket2);
      handler.register(socket2);

      await socket2.trigger('join_room', { roomId: createdRoomId });

      expect(socket2.emit).toHaveBeenCalledWith(
        'room_joined',
        expect.objectContaining({
          userId: 'user-reconnect-1',
          role: Role.HOST,
          participants: [expect.objectContaining({ username: 'Alice', role: Role.HOST })],
        })
      );
    });

    it('should disconnect older socket with session_replaced when same user opens a second tab', async () => {
      // 1. User creates room in Tab 1
      const tab1Socket = makeMockSocket('tab-1');
      tab1Socket.data.user = { userId: 'user-multitab', username: 'Alice', isGuest: false };
      io.sockets.sockets.set(tab1Socket.id, tab1Socket);
      handler.register(tab1Socket);

      let createdRoomId;
      tab1Socket.emit.mockImplementation((event, payload) => {
        if (event === 'room_created') createdRoomId = payload.roomId;
      });

      await tab1Socket.trigger('create_room', {});

      // 2. User opens Tab 2 while Tab 1 is still connected
      const tab2Socket = makeMockSocket('tab-2');
      tab2Socket.data.user = { userId: 'user-multitab', username: 'Alice', isGuest: false };
      io.sockets.sockets.set(tab2Socket.id, tab2Socket);
      handler.register(tab2Socket);

      await tab2Socket.trigger('join_room', { roomId: createdRoomId });

      // Tab 1 must be notified and disconnected
      expect(tab1Socket.emit).toHaveBeenCalledWith(
        'session_replaced',
        expect.objectContaining({ message: expect.stringContaining('another tab or window') })
      );
      expect(tab1Socket.disconnect).toHaveBeenCalledWith(true);

      // Tab 2 takes over the role
      expect(tab2Socket.emit).toHaveBeenCalledWith(
        'room_joined',
        expect.objectContaining({
          userId: 'user-multitab',
          role: Role.HOST,
        })
      );
    });
  });
});
