import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/app';
import { getAuthAdmin } from '../src/config/firebase';
import { getPerfil, usernameLibre } from '../src/repositories/users.repository';

// Sin emulador: Auth y repositorio simulados para probar los caminos de error.
vi.mock('../src/config/firebase');
vi.mock('../src/repositories/users.repository');
const auth = { verifyIdToken: vi.fn(), getUser: vi.fn() };
const bearer = { Authorization: 'Bearer t' };

describe('caminos de error', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getAuthAdmin).mockReturnValue(auth as never);
    auth.verifyIdToken.mockReset().mockResolvedValue({ uid: 'u1' });
    auth.getUser.mockReset();
  });

  it('token con error de Auth -> 401; fallo de red -> 503 AUTH_UNAVAILABLE', async () => {
    auth.verifyIdToken.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'auth/id-token-expired' }));
    expect((await request(app).get('/api/usuarios/yo').set(bearer)).status).toBe(401);
    auth.verifyIdToken.mockRejectedValueOnce(new Error('red'));
    const res = await request(app).get('/api/usuarios/yo').set(bearer);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AUTH_UNAVAILABLE');
  });

  it('Firestore caído -> 503 DB_UNAVAILABLE', async () => {
    vi.mocked(usernameLibre).mockRejectedValue(new Error('boom'));
    const res = await request(app).get('/api/usernames/ana/disponible');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DB_UNAVAILABLE');
  });

  it('PATCH vacío -> 400 VALIDATION_ERROR', async () => {
    vi.mocked(getPerfil).mockResolvedValue({ username: 'ana', nombres: 'Ana', apellidos: '', foto: null, correo: 'a@x.com', creado: '' });
    const res = await request(app).patch('/api/usuarios/yo').set(bearer).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('error inesperado -> 500 INTERNAL_ERROR JSON', async () => {
    vi.mocked(getPerfil).mockResolvedValue(null);
    auth.getUser.mockRejectedValue(new Error('inesperado'));
    const res = await request(app).get('/api/usuarios/yo').set(bearer);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('error 4xx del body-parser -> BAD_REQUEST con su status', async () => {
    const res = await request(app).put('/api/usuarios/yo/username').set(bearer).set('content-type', 'application/json; charset=latin1').send('{}');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });
});
