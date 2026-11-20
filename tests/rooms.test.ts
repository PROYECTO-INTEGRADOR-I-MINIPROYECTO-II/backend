import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/app';
import { getDb } from '../src/config/firebase';
import { anonimizarMensajes, guardarMensaje } from '../src/repositories/rooms.repository';
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
      uid: propietaria.localId,
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

  it('consulta una sala por ID con el rol de quien la pide', async () => {
    const ana = await crearCuenta('ana@x.com');
    const bea = await crearCuenta('bea@x.com');
    const { id } = (await request(app).post('/api/salas').set(bearer(ana.idToken)).send({ nombre: 'Estudio' }).expect(201)).body;

    const propia = await request(app).get(`/api/salas/${id}`).set(bearer(ana.idToken));
    expect(propia.status).toBe(200);
    expect(propia.body).toMatchObject({ id, nombre: 'Estudio', uid: ana.localId, rol: 'anfitrion' });
    expect((await request(app).get(`/api/salas/${id}`).set(bearer(bea.idToken))).body.rol).toBe('participante');
  });

  it('GET /api/salas/:id responde 404, 400 y 401', async () => {
    const { idToken } = await crearCuenta('ana@x.com');
    const noExiste = await request(app).get('/api/salas/noexiste').set(bearer(idToken));
    expect(noExiste.status).toBe(404);
    expect(noExiste.body.error).toMatchObject({ code: 'NOT_FOUND', message: 'La sala no existe. Revisa el ID.' });
    const malo = await request(app).get('/api/salas/a.b').set(bearer(idToken));
    expect(malo.status).toBe(400);
    expect(malo.body.error).toMatchObject({ code: 'VALIDATION_ERROR', campo: 'id' });
    await request(app).get('/api/salas/noexiste').expect(401);
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

    const restantes = await getDb().collection('rooms').where('uid', '==', localId).get();
    expect(restantes.empty).toBe(true);
  });

  it('al eliminar la cuenta aplica la política: borra sus salas con mensajes y anonimiza los suyos en salas ajenas', async () => {
    const a = await crearCuenta('ana@x.com');
    const b = await crearCuenta('bea@x.com');
    await request(app).put('/api/usuarios/yo/username').set(bearer(a.idToken)).send({ username: 'ana.p' }).expect(200);
    await request(app).put('/api/usuarios/yo/username').set(bearer(b.idToken)).send({ username: 'bea.q' }).expect(200);
    const salaA = (await request(app).post('/api/salas').set(bearer(a.idToken)).send({ nombre: 'De Ana' })).body.id;
    const salaB = (await request(app).post('/api/salas').set(bearer(b.idToken)).send({ nombre: 'De Bea' })).body.id;

    const msg = (sala: string, uid: string, autor: string, texto: string) =>
      getDb().collection('rooms').doc(sala).collection('messages').add({ uid, autor, texto, creado: new Date().toISOString() });
    await msg(salaA, a.localId, 'ana.p', 'a1');
    await msg(salaA, b.localId, 'bea.q', 'b1');
    await msg(salaB, a.localId, 'ana.p', 'a2');
    await msg(salaB, b.localId, 'bea.q', 'b2');

    await request(app).delete('/api/usuarios/yo').set(bearer(a.idToken)).expect(204);

    expect((await getDb().collection('rooms').doc(salaA).get()).exists).toBe(false);
    expect((await getDb().collection('rooms').doc(salaA).collection('messages').get()).empty).toBe(true);

    const enB = (await getDb().collection('rooms').doc(salaB).collection('messages').get()).docs.map((d) => d.data());
    const porTexto = Object.fromEntries(enB.map((m) => [m.texto, m]));
    expect(porTexto.a2).toMatchObject({ uid: null, autor: 'Usuario eliminado' });
    expect(porTexto.b2).toMatchObject({ uid: b.localId, autor: 'bea.q' });

    expect((await request(app).get('/api/usernames/ana.p/disponible')).body).toEqual({ disponible: true });
    const yoB = await request(app).get('/api/usuarios/yo').set(bearer(b.idToken));
    expect(yoB.status).toBe(200);
    expect(yoB.body.username).toBe('bea.q');
  });

  describe('historial de mensajes', () => {
    const nuevaSala = async (token: string) =>
      (await request(app).post('/api/salas').set(bearer(token)).send({ nombre: 'Estudio' }).expect(201)).body.id as string;
    const insertar = async (sala: string, n: number) => {
      const col = getDb().collection('rooms').doc(sala).collection('messages');
      for (let i = 0; i < n; i++) {
        await col.add({ uid: 'u', autor: 'Ana', texto: `m${i}`, creado: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() });
      }
    };

    it('con menos de 50 mensajes devuelve todos de antiguo a reciente', async () => {
      const { idToken } = await crearCuenta('ana@x.com');
      const sala = await nuevaSala(idToken);
      await insertar(sala, 3);
      const res = await request(app).get(`/api/salas/${sala}/mensajes`).set(bearer(idToken));
      expect(res.status).toBe(200);
      expect(res.body.mensajes.map((m: { texto: string }) => m.texto)).toEqual(['m0', 'm1', 'm2']);
      expect(res.body.mensajes[0]).toMatchObject({ salaId: sala, autor: 'Ana' });
      expect(res.body.hayMas).toBe(false);
    });

    it('pagina con antes: 51 mensajes dan los 50 más recientes y luego el más antiguo', async () => {
      const { idToken } = await crearCuenta('ana@x.com');
      const sala = await nuevaSala(idToken);
      await insertar(sala, 51);
      const pagina = (await request(app).get(`/api/salas/${sala}/mensajes`).set(bearer(idToken))).body;
      expect(pagina.mensajes).toHaveLength(50);
      expect(pagina.mensajes[0].texto).toBe('m1');
      expect(pagina.mensajes[49].texto).toBe('m50');
      expect(pagina.hayMas).toBe(true);
      const resto = (await request(app).get(`/api/salas/${sala}/mensajes`).query({ antes: pagina.mensajes[0].creado }).set(bearer(idToken))).body;
      expect(resto.mensajes.map((m: { texto: string }) => m.texto)).toEqual(['m0']);
      expect(resto.hayMas).toBe(false);
    });

    it('con exactamente 50 mensajes hayMas es false', async () => {
      const { idToken } = await crearCuenta('ana@x.com');
      const sala = await nuevaSala(idToken);
      await insertar(sala, 50);
      const res = (await request(app).get(`/api/salas/${sala}/mensajes`).set(bearer(idToken))).body;
      expect(res.mensajes).toHaveLength(50);
      expect(res.hayMas).toBe(false);
    });

    it('antes sin milisegundos equivale al ISO canónico', async () => {
      const { idToken } = await crearCuenta('ana@x.com');
      const sala = await nuevaSala(idToken);
      await insertar(sala, 8);
      const pedir = (antes: string) => request(app).get(`/api/salas/${sala}/mensajes`).query({ antes }).set(bearer(idToken));
      const sinMs = await pedir('2026-01-01T00:00:05Z');
      expect(sinMs.status).toBe(200);
      expect(sinMs.body.mensajes.map((m: { texto: string }) => m.texto)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']);
      expect(sinMs.body).toEqual((await pedir('2026-01-01T00:00:05.000Z')).body);
    });

    it('muestra "Usuario eliminado" en mensajes anonimizados', async () => {
      const { idToken } = await crearCuenta('ana@x.com');
      const sala = await nuevaSala(idToken);
      await guardarMensaje(sala, { uid: 'ajeno', autor: 'Bea Gómez', texto: 'hola' });
      await anonimizarMensajes('ajeno');
      const { mensajes } = (await request(app).get(`/api/salas/${sala}/mensajes`).set(bearer(idToken))).body;
      expect(mensajes[0]).toMatchObject({ autor: 'Usuario eliminado', uid: null });
    });

    it('responde 400, 404 y 401', async () => {
      const { idToken } = await crearCuenta('ana@x.com');
      const sala = await nuevaSala(idToken);
      const malaFecha = await request(app).get(`/api/salas/${sala}/mensajes?antes=ayer`).set(bearer(idToken));
      expect(malaFecha.status).toBe(400);
      expect(malaFecha.body.error).toMatchObject({ code: 'VALIDATION_ERROR', campo: 'antes' });
      expect((await request(app).get('/api/salas/a.b/mensajes').set(bearer(idToken))).body.error.campo).toBe('id');
      const noExiste = await request(app).get('/api/salas/noexiste/mensajes').set(bearer(idToken));
      expect(noExiste.status).toBe(404);
      expect(noExiste.body.error.message).toBe('La sala no existe. Revisa el ID.');
      await request(app).get(`/api/salas/${sala}/mensajes`).expect(401);
    });
  });
});
