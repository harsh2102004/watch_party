/**
 * @file cors.test.js
 * @description Unit tests for centralized multi-origin CORS configuration and Vercel preview validation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  parseAllowedOrigins,
  isOriginAllowed,
  corsOriginDelegate,
} from '../src/utils/cors.js';

describe('Multi-Origin CORS Utility', () => {
  let originalClientUrl;
  let originalVercelPreviews;

  beforeEach(() => {
    originalClientUrl = process.env.CLIENT_URL;
    originalVercelPreviews = process.env.ALLOW_VERCEL_PREVIEWS;
  });

  afterEach(() => {
    process.env.CLIENT_URL = originalClientUrl;
    process.env.ALLOW_VERCEL_PREVIEWS = originalVercelPreviews;
    vi.restoreAllMocks();
  });

  it('should parse comma-separated origins and strip whitespace and trailing slashes', () => {
    process.env.CLIENT_URL = ' http://localhost:5173/ , https://watchparty.vercel.app/// , https://preview.example.com ';

    const parsed = parseAllowedOrigins();
    expect(parsed).toEqual([
      'http://localhost:5173',
      'https://watchparty.vercel.app',
      'https://preview.example.com',
    ]);
  });

  it('should default to localhost:5173 if CLIENT_URL is unset', () => {
    delete process.env.CLIENT_URL;
    const parsed = parseAllowedOrigins();
    expect(parsed).toEqual(['http://localhost:5173']);
  });

  it('should permit requests without an Origin header (health checks, curl, mobile)', () => {
    expect(isOriginAllowed(undefined)).toBe(true);
    expect(isOriginAllowed('')).toBe(true);
  });

  it('should permit origins in the allowed list regardless of trailing slashes', () => {
    process.env.CLIENT_URL = 'https://watchparty.vercel.app,http://localhost:5173';

    expect(isOriginAllowed('http://localhost:5173')).toBe(true);
    expect(isOriginAllowed('http://localhost:5173/')).toBe(true);
    expect(isOriginAllowed('https://watchparty.vercel.app')).toBe(true);
    expect(isOriginAllowed('https://watchparty.vercel.app/')).toBe(true);
  });

  it('should block unlisted origins and log a warning', () => {
    process.env.CLIENT_URL = 'https://watchparty.vercel.app';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(isOriginAllowed('https://malicious-site.com')).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[CORS] Blocked request from unauthorized origin: "https://malicious-site.com"')
    );
  });

  it('should allow dynamic .vercel.app preview URLs when ALLOW_VERCEL_PREVIEWS=true', () => {
    process.env.CLIENT_URL = 'https://watchparty.vercel.app';
    process.env.ALLOW_VERCEL_PREVIEWS = 'true';

    expect(isOriginAllowed('https://watch-party-git-feature-alice.vercel.app')).toBe(true);
    expect(isOriginAllowed('https://watch-party-git-feature-alice.vercel.app/')).toBe(true);
    expect(isOriginAllowed('https://malicious.com')).toBe(false);
  });

  it('should reject dynamic .vercel.app preview URLs when ALLOW_VERCEL_PREVIEWS is not true', () => {
    process.env.CLIENT_URL = 'https://watchparty.vercel.app';
    process.env.ALLOW_VERCEL_PREVIEWS = 'false';

    expect(isOriginAllowed('https://watch-party-preview-123.vercel.app')).toBe(false);
  });

  it('should execute corsOriginDelegate callback with allow boolean and error on reject', () => {
    process.env.CLIENT_URL = 'https://watchparty.vercel.app';

    // Allowed origin
    const callbackSuccess = vi.fn();
    corsOriginDelegate('https://watchparty.vercel.app', callbackSuccess);
    expect(callbackSuccess).toHaveBeenCalledWith(null, true);

    // Blocked origin
    const callbackBlocked = vi.fn();
    corsOriginDelegate('https://hacker.com', callbackBlocked);
    expect(callbackBlocked).toHaveBeenCalledWith(expect.any(Error), false);
  });
});
