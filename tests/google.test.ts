import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/app';
import { getDb } from '../src/config/firebase';
import { crearCuentaGoogle, hayEmulador, limpiar } from './emulador';

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const FOTO = 'https://example.com/ana.png';

describe.skipIf(!hayEmulador)('Google + username obligatorio (emuladores)', () => {
  beforeEach(limpiar);

  it('GET yo -> username null con nombre, foto y correo del token', async () => {
    const { idToken } = await crearCuentaGoogle('g1', 'ana@gmail.com', 'Ana Pérez', FOTO);
    const res = await request(app).get('/api/usuarios/yo').set(bearer(idToken));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ username: null, nombres: 'Ana Pérez', foto: FOTO, correo: 'ana@gmail.com', proveedores: ['google.com'] });
  });

  it('PUT username completa el perfil con los datos de Google', async () => {
    const { idToken, localId } = await crearCuentaGoogle('g1', 'ana@gmail.com', 'Ana Pérez', FOTO);
    const res = await request(app).put('/api/usuarios/yo/username').set(bearer(idToken)).send({ username: 'ana.p' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ username: 'ana.p', nombres: 'Ana Pérez', foto: FOTO, correo: 'ana@gmail.com' });
    expect((await getDb().collection('users').doc(localId).get()).get('username')).toBe('ana.p');
    expect((await request(app).get('/api/usuarios/yo').set(bearer(idToken))).body.username).toBe('ana.p');
  });

  it('username ocupado -> 409 con campo y no completa el perfil', async () => {
    const otro = await crearCuentaGoogle('g2', 'otro@gmail.com');
    await request(app).put('/api/usuarios/yo/username').set(bearer(otro.idToken)).send({ username: 'ana.p' }).expect(200);
    const { idToken, localId } = await crearCuentaGoogle('g1', 'ana@gmail.com');
    const res = await request(app).put('/api/usuarios/yo/username').set(bearer(idToken)).send({ username: 'Ana.P' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'USERNAME_TAKEN', campo: 'username' });
    expect((await getDb().collection('users').doc(localId).get()).exists).toBe(false);
    expect((await request(app).get('/api/usuarios/yo').set(bearer(idToken))).body.username).toBeNull();
  });

  it.each([['a b'], ['ab'], ['']])('username inválido %j -> 400 con campo y no completa', async (username) => {
    const { idToken, localId } = await crearCuentaGoogle('g1', 'ana@gmail.com');
    const res = await request(app).put('/api/usuarios/yo/username').set(bearer(idToken)).send({ username });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'USERNAME_INVALID', campo: 'username' });
    expect((await getDb().collection('users').doc(localId).get()).exists).toBe(false);
  });

  it('PATCH antes de elegir username -> 409 PROFILE_INCOMPLETE', async () => {
    const { idToken } = await crearCuentaGoogle('g1', 'ana@gmail.com');
    const res = await request(app).patch('/api/usuarios/yo').set(bearer(idToken)).send({ nombres: 'Ana' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PROFILE_INCOMPLETE');
  });
});
