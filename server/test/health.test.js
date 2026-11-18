import { describe, it, expect, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import * as connectModule from '../src/db/connect.js';

describe('GET /health Endpoint', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should report status: "ok", uptime, rooms count, and db: "connected" when readyState is 1', async () => {
    vi.spyOn(connectModule, 'getDbStatus').mockReturnValue('connected');

    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ok',
      uptime: expect.any(Number),
      db: 'connected',
      rooms: expect.any(Number),
    });
  });

  it('should report db: "disconnected" when configured but disconnected', async () => {
    vi.spyOn(connectModule, 'getDbStatus').mockReturnValue('disconnected');

    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ok',
      uptime: expect.any(Number),
      db: 'disconnected',
      rooms: expect.any(Number),
    });
  });

  it('should report db: "disabled" when MONGODB_URI is not set', async () => {
    vi.spyOn(connectModule, 'getDbStatus').mockReturnValue('disabled');

    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ok',
      uptime: expect.any(Number),
      db: 'disabled',
      rooms: expect.any(Number),
    });
  });
});
