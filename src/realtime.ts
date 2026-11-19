import type http from 'node:http';
import { Server, type Socket } from 'socket.io';
import { getAuthAdmin } from './config/firebase';
import { getSala, guardarMensaje } from './repositories/rooms.repository';
import { getPerfil } from './repositories/users.repository';

const MAX_TEXTO = 1000;
const ID_SALA = /^[A-Za-z0-9]{1,128}$/;

type Ack = (res: unknown) => void;
type Datos = { uid: string; username: string; salas: Set<string> };

let io: Server | undefined;

const error = (code: string, message: string, campo?: string) => ({ error: { code, message, campo } });
const dbError = (err: unknown) => {
  console.error('Error de Firestore en tiempo real:', err);
  return error('DB_UNAVAILABLE', 'No pudimos completar la operación. Intenta de nuevo en unos segundos.');
};
const responder = (ack: unknown, res: unknown) => {
  if (typeof ack === 'function') (ack as Ack)(res);
};
// Id de sala recortado y válido (solo alfanuméricos: evita rutas de Firestore con '/'), o null.
const idSala = (p: unknown) => {
  const id = objeto(p).id;
  const limpio = typeof id === 'string' ? id.trim() : '';
  return ID_SALA.test(limpio) ? limpio : null;
};
const objeto = (p: unknown): Record<string, unknown> => (p && typeof p === 'object' ? (p as Record<string, unknown>) : {});

async function emitirPresencia(salaId: string, excluir?: Socket) {
  if (!io) return;
  const sockets = await io.in(salaId).fetchSockets();
  const usuarios = new Map<string, string>();
  for (const s of sockets) {
    if (s.id === excluir?.id) continue;
    const { uid, username } = s.data as Datos;
    usuarios.set(uid, username);
  }
  io.to(salaId).emit('sala:presencia', { salaId, usuarios: [...usuarios].map(([uid, username]) => ({ uid, username })) });
}

const presencia = (salaId: string, excluir?: Socket) =>
  emitirPresencia(salaId, excluir).catch((err) => console.error('Error emitiendo presencia:', err));

function conectar(socket: Socket) {
  const { uid, username, salas } = socket.data as Datos;

  socket.on('sala:unirse', async (payload: unknown, ack: unknown) => {
    const limpio = idSala(payload);
    if (!limpio) return responder(ack, error('VALIDATION_ERROR', 'Indica un ID de sala válido.', 'id'));
    try {
      const sala = await getSala(limpio);
      if (socket.disconnected) return;
      if (!sala) return responder(ack, error('NOT_FOUND', 'La sala no existe. Revisa el ID.'));
      await socket.join(limpio);
      salas.add(limpio);
      responder(ack, { sala });
      await presencia(limpio);
    } catch (err) {
      responder(ack, dbError(err));
    }
  });

  socket.on('sala:salir', async (payload: unknown, ack: unknown) => {
    const limpio = idSala(payload);
    if (!limpio) return responder(ack, error('VALIDATION_ERROR', 'Indica un ID de sala válido.', 'id'));
    try {
      // Solo actúa sobre salas unidas: nunca sobre user:<uid> ni el room propio del socket.
      if (salas.delete(limpio)) {
        await socket.leave(limpio);
        await presencia(limpio);
      }
      responder(ack, { ok: true });
    } catch (err) {
      responder(ack, dbError(err));
    }
  });

  socket.on('mensaje:enviar', async (payload: unknown, ack: unknown) => {
    const { salaId, texto } = objeto(payload);
    if (typeof salaId !== 'string' || !salas.has(salaId)) {
      return responder(ack, error('FORBIDDEN', 'Primero únete a la sala.'));
    }
    const limpio = typeof texto === 'string' ? texto.trim() : '';
    if (!limpio || limpio.length > MAX_TEXTO) {
      return responder(ack, error('VALIDATION_ERROR', `El mensaje debe tener entre 1 y ${MAX_TEXTO} caracteres.`, 'texto'));
    }
    try {
      if (!(await getSala(salaId))) {
        salas.delete(salaId);
        await socket.leave(salaId);
        return responder(ack, error('NOT_FOUND', 'La sala ya no existe.'));
      }
      const mensaje = await guardarMensaje(salaId, { uid, autor: username, texto: limpio });
      io?.to(salaId).emit('mensaje:nuevo', mensaje);
      responder(ack, { mensaje });
    } catch (err) {
      responder(ack, dbError(err));
    }
  });

  socket.on('disconnecting', () => {
    for (const sala of salas) void presencia(sala, socket);
  });
}

export function iniciarTiempoReal(server: http.Server) {
  // Misma regla que app.ts: sin CORS_ORIGIN no se permite ningún origen.
  io = new Server(server, { maxHttpBufferSize: 16 * 1024, cors: { origin: process.env.CORS_ORIGIN?.split(',').map((s) => s.trim()) ?? false } });

  // io.use espera un callback síncrono: la promesa se maneja aquí.
  io.use((socket, next) => {
    autenticar(socket, next).catch(next);
  });

  io.on('connection', conectar);
  return io;
}

async function autenticar(socket: Socket, next: (err?: Error) => void) {
  const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
  const fallo = (code: string, message: string) => next(Object.assign(new Error(message), { data: { code, message } }));
  if (typeof token !== 'string' || !token) return fallo('UNAUTHENTICATED', 'Inicia sesión para continuar.');
  try {
    const { uid } = await getAuthAdmin().verifyIdToken(token, true);
    const perfil = await getPerfil(uid);
    if (!perfil?.username) return fallo('PROFILE_INCOMPLETE', 'Primero elige tu username.');
    socket.data = { uid, username: perfil.username, salas: new Set<string>() } satisfies Datos;
    await socket.join('user:' + uid);
    next();
  } catch (err) {
    if (String((err as { code?: unknown }).code).startsWith('auth/')) return fallo('UNAUTHENTICATED', 'Inicia sesión para continuar.');
    console.error('Error verificando el token del socket:', err);
    fallo('AUTH_UNAVAILABLE', 'No pudimos verificar tu sesión. Intenta de nuevo en unos segundos.');
  }
}

// Corta las conexiones de un usuario (p. ej. al eliminar su cuenta).
export function desconectarUsuario(uid: string) {
  io?.in('user:' + uid).disconnectSockets(true);
}
