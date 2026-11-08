import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/app';
import { getAuthAdmin } from '../src/config/firebase';
import { crearCuenta, crearCuentaGoogle, hayEmulador, iniciarSesion, limpiar } from './emulador';

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

describe.skipIf(!hayEmulador)('login (emuladores)', () => {
  beforeEach(limpiar);

  it('correo/clave -> ID token -> GET yo 200', async () => {
    await request(app).post('/api/auth/registro').send({ nombres: 'Ana', apellidos: 'Pérez', username: 'ana.p', correo: 'ana@x.com', clave: 'clave-segura-1' }).expect(201);
    const { idToken } = await iniciarSesion('ana@x.com', 'clave-segura-1');
    const res = await request(app).get('/api/usuarios/yo').set(bearer(idToken));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ username: 'ana.p', correo: 'ana@x.com' });
  });

  it('sin token -> 401', async () => {
    const res = await request(app).get('/api/usuarios/yo');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('token revocado -> 401', async () => {
    const { idToken, localId } = await crearCuenta('ana@x.com');
    await request(app).get('/api/usuarios/yo').set(bearer(idToken)).expect(200);
    await new Promise((r) => setTimeout(r, 1100)); // revokeRefreshTokens trabaja en segundos
    await getAuthAdmin().revokeRefreshTokens(localId);
    const res = await request(app).get('/api/usuarios/yo').set(bearer(idToken));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('usuario Google con username -> GET yo devuelve el username', async () => {
    const { idToken } = await crearCuentaGoogle('g1', 'ana@gmail.com');
    await request(app).put('/api/usuarios/yo/username').set(bearer(idToken)).send({ username: 'ana.g' }).expect(200);
    const res = await request(app).get('/api/usuarios/yo').set(bearer(idToken));
    expect(res.body).toMatchObject({ username: 'ana.g', proveedores: ['google.com'] });
  });
});
