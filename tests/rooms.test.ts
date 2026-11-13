import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/app';
import { getDb } from '../src/config/firebase';
import { crearCuenta, hayEmulador, limpiar } from './emulador';

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe.skipIf(!hayEmulador)('salas (emuladores)', () => {
  beforeEach(limpiar);

  it('requiere autenticación para crear y listar salas', async () => {
    await request(app).post('/api/salas').send({ nombre: 'Estudio' }).expect(401);
    await request(app).get('/api/salas').expect(401);
  });

  it('crea una sala y solo la lista a su propietario', async () => {
    const propietaria = await crearCuenta('ana@x.com');
    const otraPersona = await crearCuenta('bea@x.com');

    const creada = await request(app)
      .post('/api/salas')
      .set(bearer(propietaria.idToken))
      .send({ nombre: '  Estudio de cálculo  ', descripcion: '  Repaso del parcial  ' });

    expect(creada.status).toBe(201);
    expect(creada.body).toMatchObject({
      nombre: 'Estudio de cálculo',
      descripcion: 'Repaso del parcial',
      ownerUid: propietaria.localId,
    });
    expect(creada.body.id).toBeTruthy();
    expect(creada.body.creado).toBeTruthy();

    const propias = await request(app).get('/api/salas').set(bearer(propietaria.idToken));
    expect(propias.status).toBe(200);
    expect(propias.body.salas).toEqual([creada.body]);

    const ajenas = await request(app).get('/api/salas').set(bearer(otraPersona.idToken));
    expect(ajenas.status).toBe(200);
    expect(ajenas.body).toEqual({ salas: [] });
  });

  it('valida el nombre y la longitud de los campos', async () => {
    const { idToken } = await crearCuenta('ana@x.com');
    const crear = (body: object) => request(app).post('/api/salas').set(bearer(idToken)).send(body);

    expect((await crear({})).body.error).toMatchObject({ code: 'VALIDATION_ERROR', campo: 'nombre' });
    expect((await crear({ nombre: '   ' })).body.error.campo).toBe('nombre');
    expect((await crear({ nombre: 'a'.repeat(81) })).body.error.campo).toBe('nombre');
    expect((await crear({ nombre: 'Estudio', descripcion: 'a'.repeat(501) })).body.error.campo).toBe('descripcion');
  });

  it('elimina las salas propias al eliminar la cuenta', async () => {
    const { idToken, localId } = await crearCuenta('ana@x.com');
    await request(app).post('/api/salas').set(bearer(idToken)).send({ nombre: 'Estudio' }).expect(201);

    await request(app).delete('/api/usuarios/yo').set(bearer(idToken)).expect(204);

    const restantes = await getDb().collection('rooms').where('ownerUid', '==', localId).get();
    expect(restantes.empty).toBe(true);
  });
});
