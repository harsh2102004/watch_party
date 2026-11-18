/**
 * @file auth.js
 * @description Express router for user registration, authentication, token verification,
 * and client guest capability configuration.
 *
 * Interview Decision Notes:
 * 1. Database-Disconnected Resilience (503 Service Unavailable):
 *    If MongoDB is offline or disabled, endpoints respond immediately with 503 instead
 *    of hanging or throwing unhandled errors, honoring the memory-only server capability.
 * 2. Strict Input Validation & Canonicalization:
 *    Emails are checked against standard format and converted to lowercase. Usernames
 *    are validated for 3-20 alphanumeric characters (matching socket display boundaries).
 * 3. Bcrypt Work Factor:
 *    Work factor / cost 10 balances CPU security against hash generation time (~50-100ms),
 *    preventing Event Loop blocking under normal traffic.
 * 4. Token Payload:
 *    JWT payload contains { userId, username } so socket connections can authenticate
 *    without querying MongoDB on every handshake.
 */

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { User } from '../db/models/index.js';
import { isDbConnected, getDbStatus } from '../db/connect.js';

export const authRouter = Router();

/**
 * Resolves JWT secret with strict production enforcement.
 *
 * @returns {string} The secret string.
 */
export function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET environment variable is missing in production.');
    }
    return 'dev-jwt-secret-watchparty-fallback-key';
  }
  return secret;
}

/**
 * Rate limiter for authentication routes to mitigate brute force credential attacks.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test', // Skip in automated test runs
  message: {
    error: 'TOO_MANY_REQUESTS',
    message: 'Too many authentication attempts. Please try again later.',
  },
});

authRouter.use(authLimiter);

/**
 * GET /auth/config
 * Informs client whether guest access is permitted and database availability status.
 */
authRouter.get('/config', (req, res) => {
  const allowGuests = process.env.ALLOW_GUESTS !== 'false';
  res.json({
    allowGuests,
    dbStatus: getDbStatus(),
  });
});

/**
 * POST /auth/register
 * Registers a new user account with email, username, and password.
 */
authRouter.post('/register', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({
      error: 'SERVICE_UNAVAILABLE',
      message: 'Database is unavailable. Registration is currently disabled.',
    });
  }

  const { email, username, password } = req.body || {};

  // 1. Email validation
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'INVALID_EMAIL', message: 'Email address is required.' });
  }
  const normalizedEmail = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(normalizedEmail)) {
    return res.status(400).json({ error: 'INVALID_EMAIL', message: 'Please provide a valid email address.' });
  }

  // 2. Username validation
  if (!username || typeof username !== 'string') {
    return res.status(400).json({ error: 'INVALID_USERNAME', message: 'Username is required.' });
  }
  const trimmedUsername = username.trim();
  if (trimmedUsername.length < 3 || trimmedUsername.length > 20) {
    return res.status(400).json({
      error: 'INVALID_USERNAME',
      message: 'Username must be between 3 and 20 characters.',
    });
  }
  const usernameRegex = /^[a-zA-Z0-9_-]+$/;
  if (!usernameRegex.test(trimmedUsername)) {
    return res.status(400).json({
      error: 'INVALID_USERNAME',
      message: 'Username may only contain letters, numbers, underscores, and hyphens.',
    });
  }

  // 3. Password validation
  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({
      error: 'INVALID_PASSWORD',
      message: 'Password must be at least 8 characters long.',
    });
  }

  try {
    // 4. Duplicate checks
    const existingEmail = await User.findOne({ email: normalizedEmail });
    if (existingEmail) {
      return res.status(409).json({
        error: 'DUPLICATE_EMAIL',
        message: 'An account with this email address already exists.',
      });
    }

    const existingUsername = await User.findOne({ username: trimmedUsername });
    if (existingUsername) {
      return res.status(409).json({
        error: 'DUPLICATE_USERNAME',
        message: 'This username is already taken. Please choose another.',
      });
    }

    // 5. Hash password with bcrypt cost 10
    const passwordHash = await bcrypt.hash(password, 10);

    // 6. Create user record
    const user = await User.create({
      email: normalizedEmail,
      username: trimmedUsername,
      passwordHash,
    });

    // 7. Issue JWT token with 7-day expiration
    const token = jwt.sign(
      {
        userId: user._id.toString(),
        username: user.username,
      },
      getJwtSecret(),
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      token,
      user: {
        userId: user._id.toString(),
        email: user.email,
        username: user.username,
      },
    });
  } catch (err) {
    if (err.code === 11000) {
      // MongoDB duplicate key error fallback
      const field = Object.keys(err.keyPattern || {})[0] || 'credential';
      return res.status(409).json({
        error: `DUPLICATE_${field.toUpperCase()}`,
        message: `An account with this ${field} already exists.`,
      });
    }
    console.error('[Auth] Registration error:', err);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'An error occurred during registration. Please try again.',
    });
  }
});

/**
 * POST /auth/login
 * Authenticates user credentials and issues a JWT token.
 */
authRouter.post('/login', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({
      error: 'SERVICE_UNAVAILABLE',
      message: 'Database is unavailable. Login is currently disabled.',
    });
  }

  const { email, username, password } = req.body || {};
  const identifier = (email || username || '').trim();

  if (!identifier) {
    return res.status(400).json({
      error: 'INVALID_CREDENTIALS',
      message: 'Email or username is required.',
    });
  }

  if (!password || typeof password !== 'string') {
    return res.status(400).json({
      error: 'INVALID_CREDENTIALS',
      message: 'Password is required.',
    });
  }

  try {
    // Find by either email (normalized lowercase) or username
    const user = await User.findOne({
      $or: [{ email: identifier.toLowerCase() }, { username: identifier }],
    });

    if (!user) {
      return res.status(401).json({
        error: 'INVALID_CREDENTIALS',
        message: 'Invalid email/username or password.',
      });
    }

    // Verify password against stored bcrypt hash
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({
        error: 'INVALID_CREDENTIALS',
        message: 'Invalid email/username or password.',
      });
    }

    // Issue JWT token with 7-day expiration
    const token = jwt.sign(
      {
        userId: user._id.toString(),
        username: user.username,
      },
      getJwtSecret(),
      { expiresIn: '7d' }
    );

    return res.json({
      token,
      user: {
        userId: user._id.toString(),
        email: user.email,
        username: user.username,
      },
    });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'An error occurred during login. Please try again.',
    });
  }
});

/**
 * GET /auth/me
 * Retrieves current authenticated user profile from JWT Bearer token.
 */
authRouter.get('/me', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Authentication token missing or invalid.',
    });
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, getJwtSecret());

    if (isDbConnected()) {
      const user = await User.findById(decoded.userId);
      if (!user) {
        return res.status(401).json({
          error: 'USER_NOT_FOUND',
          message: 'User account associated with this token no longer exists.',
        });
      }
      return res.json({
        user: {
          userId: user._id.toString(),
          email: user.email,
          username: user.username,
        },
      });
    }

    // Fallback if DB is disconnected but token is cryptographically valid
    return res.json({
      user: {
        userId: decoded.userId,
        username: decoded.username,
      },
    });
  } catch (err) {
    return res.status(401).json({
      error: 'INVALID_TOKEN',
      message: 'Authentication token is expired or invalid.',
    });
  }
});
