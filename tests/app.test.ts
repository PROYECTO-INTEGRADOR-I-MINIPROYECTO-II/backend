import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/app';
import { getBaseInfo } from '../src/repositories/base.repository';

vi.mock('../src/repositories/base.repository');
const repo = vi.mocked(getBaseInfo);

describe('API', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    repo.mockReset();
  });

  it('GET /api/health -> 200', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /api/base -> 200 con el dato', async () => {
    const info = { mensaje: 'Hola', actualizado: '2026-01-01T00:00:00.000Z' };
    repo.mockResolvedValue(info);
    const res = await request(app).get('/api/base');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(info);
  });

  it('GET /api/base -> 503 si el repo falla', async () => {
    repo.mockRejectedValue(new Error('boom'));
    const res = await request(app).get('/api/base');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DB_UNAVAILABLE');
  });

  it('GET /api/base -> 404 si no hay dato', async () => {
    repo.mockResolvedValue(null);
    const res = await request(app).get('/api/base');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('ruta desconocida -> 404 JSON', async () => {
    const res = await request(app).get('/nada');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
