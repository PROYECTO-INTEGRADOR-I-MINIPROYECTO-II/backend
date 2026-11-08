import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/app';
import { getAuthAdmin, getDb } from '../src/config/firebase';
import { hayEmulador, limpiar } from './emulador';

const datos = { nombres: 'Ana', apellidos: 'Pérez', username: 'ana.p', correo: 'ana@x.com', clave: 'clave-segura-1' };
const registrar = (body: object) => request(app).post('/api/auth/registro').send(body);

describe.skipIf(!hayEmulador)('POST /api/auth/registro (emuladores)', () => {
  beforeEach(limpiar);

  it('éxito: 201, doc en Firestore y usuario en Auth', async () => {
    const res = await registrar(datos);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ username: 'ana.p', nombres: 'Ana', apellidos: 'Pérez', foto: null, correo: 'ana@x.com', proveedores: ['password'] });
    expect((await getDb().collection('users').doc(res.body.uid).get()).get('username')).toBe('ana.p');
    expect((await getDb().collection('usernames').doc('ana.p').get()).get('uid')).toBe(res.body.uid);
    expect((await getAuthAdmin().getUser(res.body.uid)).email).toBe('ana@x.com');
  });

  it('username ocupado -> 409 USERNAME_TAKEN y sin cuenta huérfana', async () => {
    await registrar(datos).expect(201);
    const res = await registrar({ ...datos, username: 'ANA.P', correo: 'otra@x.com' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'USERNAME_TAKEN', campo: 'username' });
    expect((await getAuthAdmin().listUsers()).users).toHaveLength(1);
  });

  it('correo ya registrado -> 409 EMAIL_TAKEN', async () => {
    await registrar(datos).expect(201);
    const res = await registrar({ ...datos, username: 'ana.2' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'EMAIL_TAKEN', campo: 'correo' });
  });

  it.each([
    ['nombres', { nombres: '' }],
    ['apellidos', { apellidos: 'Pé<rez>' }],
    ['username', { username: 'a b' }],
    ['correo', { correo: 'no-es-correo' }],
    ['clave', { clave: 'corta' }],
    ['foto', { foto: 'http://inseguro.com/a.png' }],
  ])('dato inválido -> 400 VALIDATION_ERROR en %s', async (campo, cambio) => {
    const res = await registrar({ ...datos, ...cambio });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'VALIDATION_ERROR', campo });
    expect((await getAuthAdmin().listUsers()).users).toHaveLength(0);
  });

  it('dos registros simultáneos con el mismo username: un 201, un 409 y una sola cuenta', async () => {
    const [a, b] = await Promise.all([registrar({ ...datos, correo: 'a@x.com' }), registrar({ ...datos, correo: 'b@x.com' })]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const { users } = await getAuthAdmin().listUsers();
    expect(users).toHaveLength(1);
    expect(users[0].uid).toBe((a.status === 201 ? a : b).body.uid);
  });
});
