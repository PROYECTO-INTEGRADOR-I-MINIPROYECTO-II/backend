import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { io as cliente, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import app from '../src/app';
import { getDb } from '../src/config/firebase';
import { desconectarUsuario, iniciarTiempoReal } from '../src/realtime';
import { crearCuenta, hayEmulador, limpiar } from './emulador';

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe.skipIf(!hayEmulador)('tiempo real (emuladores)', () => {
  const server = http.createServer(app);
  let url = '';
  const abiertos: Socket[] = [];

  beforeAll(async () => {
    iniciarTiempoReal(server);
    await new Promise<void>((ok) => server.listen(0, ok));
    url = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((ok) => { server.closeAllConnections(); server.close(() => ok()); }));
  beforeEach(limpiar);
  afterEach(() => abiertos.splice(0).forEach((s) => s.close()));

  const conectar = (token?: string) => {
    const s = cliente(url, { auth: { token }, reconnection: false, forceNew: true });
    abiertos.push(s);
    return s;
  };
  const conectado = (s: Socket) => new Promise<Socket>((ok, ko) => { s.on('connect', () => ok(s)); s.on('connect_error', ko); });
  const rechazo = (s: Socket) => new Promise<{ data?: { code: string } }>((ok) => s.on('connect_error', ok));
  const emitir = (s: Socket, evento: string, payload: unknown) => s.emitWithAck(evento, payload);
  const siguiente = <T = any>(s: Socket, evento: string) => new Promise<T>((ok) => s.once(evento, ok));
  const pausa = (ms = 300) => new Promise((ok) => setTimeout(ok, ms));

  async function usuario(correo: string, username: string) {
    const { idToken, localId } = await crearCuenta(correo);
    await request(app).put('/api/usuarios/yo/username').set(bearer(idToken)).send({ username }).expect(200);
    return { idToken, uid: localId, socket: await conectado(conectar(idToken)) };
  }
  const crearSala = async (token: string) =>
    (await request(app).post('/api/salas').set(bearer(token)).send({ nombre: 'Estudio' }).expect(201)).body.id as string;

  it('rechaza el handshake sin token o con token inválido', async () => {
    expect((await rechazo(conectar())).data?.code).toBe('UNAUTHENTICATED');
    expect((await rechazo(conectar('basura'))).data?.code).toBe('UNAUTHENTICATED');
  });

  it('rechaza si no hay perfil con username', async () => {
    const { idToken } = await crearCuenta('ana@x.com');
    expect((await rechazo(conectar(idToken))).data?.code).toBe('PROFILE_INCOMPLETE');
  });

  it('valida el ID al unirse y lo recorta', async () => {
    const ana = await usuario('ana@x.com', 'ana');
    const id = await crearSala(ana.idToken);
    expect((await emitir(ana.socket, 'sala:unirse', { id: 'noexiste' })).error.code).toBe('NOT_FOUND');
    expect((await emitir(ana.socket, 'sala:unirse', { id: '   ' })).error).toMatchObject({ code: 'VALIDATION_ERROR', campo: 'id' });
    expect((await emitir(ana.socket, 'sala:unirse', null)).error.code).toBe('VALIDATION_ERROR');
    expect((await emitir(ana.socket, 'sala:unirse', { id: `  ${id} ` })).sala.id).toBe(id);
  });

  it('el mensaje llega a la misma sala, no a otra, y se guarda', async () => {
    const ana = await usuario('ana@x.com', 'ana');
    const bea = await usuario('bea@x.com', 'bea');
    const cai = await usuario('cai@x.com', 'cai');
    const sala = await crearSala(ana.idToken);
    const otra = await crearSala(cai.idToken);
    await emitir(ana.socket, 'sala:unirse', { id: sala });
    await emitir(bea.socket, 'sala:unirse', { id: sala });
    await emitir(cai.socket, 'sala:unirse', { id: otra });

    let fuera = false;
    cai.socket.on('mensaje:nuevo', () => (fuera = true));
    const recibido = siguiente(bea.socket, 'mensaje:nuevo');
    const ack = await emitir(ana.socket, 'mensaje:enviar', { salaId: sala, texto: '  hola  ' });
    expect(ack.mensaje).toMatchObject({ salaId: sala, uid: ana.uid, autor: 'ana', texto: 'hola' });
    expect(await recibido).toEqual(ack.mensaje);
    await pausa();
    expect(fuera).toBe(false);

    const docs = await getDb().collection('rooms').doc(sala).collection('messages').get();
    expect(docs.size).toBe(1);
    expect(docs.docs[0].data()).toEqual({ uid: ana.uid, autor: 'ana', texto: 'hola', creado: ack.mensaje.creado });
  });

  it('rechaza texto vacío o demasiado largo y no lo guarda', async () => {
    const ana = await usuario('ana@x.com', 'ana');
    const sala = await crearSala(ana.idToken);
    await emitir(ana.socket, 'sala:unirse', { id: sala });
    for (const texto of ['', '   ', 'a'.repeat(1001), 5]) {
      expect((await emitir(ana.socket, 'mensaje:enviar', { salaId: sala, texto })).error).toMatchObject({ code: 'VALIDATION_ERROR', campo: 'texto' });
    }
    expect((await getDb().collection('rooms').doc(sala).collection('messages').get()).empty).toBe(true);
  });

  it('no deja enviar sin unirse', async () => {
    const ana = await usuario('ana@x.com', 'ana');
    const sala = await crearSala(ana.idToken);
    expect((await emitir(ana.socket, 'mensaje:enviar', { salaId: sala, texto: 'hola' })).error.code).toBe('FORBIDDEN');
    expect((await emitir(ana.socket, 'mensaje:enviar', null)).error.code).toBe('FORBIDDEN');
    for (const salaId of [`user:${ana.uid}`, ana.socket.id]) {
      expect((await emitir(ana.socket, 'mensaje:enviar', { salaId, texto: 'hola' })).error.code).toBe('FORBIDDEN');
    }
    const rooms = await getDb().collection('rooms').listDocuments();
    expect(rooms.map((d) => d.id)).toEqual([sala]);
    expect((await rooms[0].collection('messages').get()).empty).toBe(true);
  });

  it('si la sala se borró, el envío da NOT_FOUND y no escribe', async () => {
    const ana = await usuario('ana@x.com', 'ana');
    const sala = await crearSala(ana.idToken);
    await emitir(ana.socket, 'sala:unirse', { id: sala });
    await getDb().recursiveDelete(getDb().collection('rooms').doc(sala));
    expect((await emitir(ana.socket, 'mensaje:enviar', { salaId: sala, texto: 'hola' })).error.code).toBe('NOT_FOUND');
    expect((await getDb().collection('rooms').doc(sala).collection('messages').get()).empty).toBe(true);
    expect((await emitir(ana.socket, 'mensaje:enviar', { salaId: sala, texto: 'hola' })).error.code).toBe('FORBIDDEN');
  });

  it('rechaza IDs con caracteres no válidos', async () => {
    const ana = await usuario('ana@x.com', 'ana');
    for (const id of ['a/messages/m', 'user:x', 'a'.repeat(129)]) {
      expect((await emitir(ana.socket, 'sala:unirse', { id })).error).toMatchObject({ code: 'VALIDATION_ERROR', campo: 'id' });
    }
  });

  it('sala:salir no saca de la sala privada: desconectarUsuario sigue funcionando', async () => {
    const ana = await usuario('ana@x.com', 'ana');
    await emitir(ana.socket, 'sala:salir', { id: `user:${ana.uid}` });
    const cerrado = new Promise((ok) => ana.socket.on('disconnect', ok));
    desconectarUsuario(ana.uid);
    await cerrado;
    expect(ana.socket.connected).toBe(false);
  });

  it('emite la presencia al unirse y al salir', async () => {
    const ana = await usuario('ana@x.com', 'ana');
    const bea = await usuario('bea@x.com', 'bea');
    const sala = await crearSala(ana.idToken);
    await emitir(ana.socket, 'sala:unirse', { id: sala });
    const lista = siguiente(ana.socket, 'sala:presencia');
    await emitir(bea.socket, 'sala:unirse', { id: sala });
    const { usuarios } = await lista;
    expect(usuarios).toHaveLength(2);
    expect(usuarios).toEqual(expect.arrayContaining([{ uid: ana.uid, username: 'ana' }, { uid: bea.uid, username: 'bea' }]));

    const tras = siguiente(ana.socket, 'sala:presencia');
    bea.socket.close();
    expect((await tras).usuarios).toEqual([{ uid: ana.uid, username: 'ana' }]);
  });

  it('desconectarUsuario corta sus sockets', async () => {
    const ana = await usuario('ana@x.com', 'ana');
    const cerrado = new Promise((ok) => ana.socket.on('disconnect', ok));
    desconectarUsuario(ana.uid);
    await cerrado;
    expect(ana.socket.connected).toBe(false);
  });
});
