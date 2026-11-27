import type http from 'node:http';
import { Server, type Socket } from 'socket.io';
import { getAuthAdmin } from './config/firebase';
import { getSala, guardarMensaje, observarSala, type Sala } from './repositories/rooms.repository';
import { getPerfil } from './repositories/users.repository';
import { historial, rolEnSala } from './services/rooms.service';
import { ID_SALA } from './validaciones';

const MAX_TEXTO = 1000;

type Ack = (res: unknown) => void;
type Datos = { uid: string; username: string; nombre: string; foto: string | null };
type Observacion = { sala: Sala | null; cancelar: () => void };

const PREFIJO_SALA = 'sala:';
const canal = (id: string) => PREFIJO_SALA + id;

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

async function emitirPresencia(servidor: Server, salaId: string) {
  const sockets = await servidor.in(canal(salaId)).fetchSockets();
  const usuarios = new Map<string, { uid: string; username: string; nombre: string; foto: string | null }>();
  for (const s of sockets) {
    const { uid, username, nombre, foto } = s.data as Datos;
    usuarios.set(uid, { uid, username, nombre, foto });
  }
  servidor.to(canal(salaId)).emit('sala:presencia', { salaId, usuarios: [...usuarios.values()] });
}

const presencia = (servidor: Server, salaId: string) =>
  emitirPresencia(servidor, salaId).catch((err) => console.error('Error emitiendo presencia:', err));

function conectar(servidor: Server, socket: Socket, vigilar: (sala: Sala) => Observacion) {
  const { uid, nombre } = socket.data as Datos;

  socket.on('sala:unirse', async (payload: unknown, ack: unknown) => {
    const limpio = idSala(payload);
    if (!limpio) return responder(ack, error('VALIDATION_ERROR', 'Indica un ID de sala válido.', 'id'));
    try {
      const sala = await getSala(limpio);
      if (socket.disconnected) return;
      if (!sala) return responder(ack, error('NOT_FOUND', 'La sala no existe. Revisa el ID.'));
      // Se une antes de leer el historial para no perder mensajes en medio; el cliente deduplica por id.
      const grupo = canal(limpio);
      await socket.join(grupo);
      if (socket.disconnected) return;
      try {
        const observacion = vigilar(sala);
        const { mensajes, hayMas } = await historial(limpio);
        const actual = observacion.sala;
        if (!actual) return responder(ack, error('NOT_FOUND', 'La sala ya no existe.'));
        if (!socket.rooms.has(grupo)) return;
        responder(ack, { sala: actual, rol: rolEnSala(actual, uid), mensajes, hayMas });
      } catch (err) {
        await socket.leave(grupo);
        throw err;
      }
      await presencia(servidor, limpio);
    } catch (err) {
      responder(ack, dbError(err));
    }
  });

  socket.on('sala:salir', async (payload: unknown, ack: unknown) => {
    const limpio = idSala(payload);
    if (!limpio) return responder(ack, error('VALIDATION_ERROR', 'Indica un ID de sala válido.', 'id'));
    try {
      await socket.leave(canal(limpio));
      responder(ack, { ok: true });
    } catch (err) {
      responder(ack, dbError(err));
    }
  });

  socket.on('mensaje:enviar', async (payload: unknown, ack: unknown) => {
    const { salaId, texto } = objeto(payload);
    if (typeof salaId !== 'string' || !socket.rooms.has(canal(salaId))) {
      return responder(ack, error('FORBIDDEN', 'Primero únete a la sala.'));
    }
    const limpio = typeof texto === 'string' ? texto.trim() : '';
    if (!limpio || limpio.length > MAX_TEXTO) {
      return responder(ack, error('VALIDATION_ERROR', `El mensaje debe tener entre 1 y ${MAX_TEXTO} caracteres.`, 'texto'));
    }
    try {
      const mensaje = await guardarMensaje(salaId, { uid, autor: nombre, texto: limpio });
      if (!mensaje) {
        return responder(ack, error('NOT_FOUND', 'La sala ya no existe.'));
      }
      servidor.to(canal(salaId)).emit('mensaje:nuevo', mensaje);
      responder(ack, { mensaje });
    } catch (err) {
      responder(ack, dbError(err));
    }
  });
}

export function iniciarTiempoReal(server: http.Server) {
  // Misma regla que app.ts: sin CORS_ORIGIN no se permite ningún origen.
  const servidor = new Server(server, { maxHttpBufferSize: 16 * 1024, cors: { origin: process.env.CORS_ORIGIN?.split(',').map((s) => s.trim()) ?? false } });
  io = servidor;

  const observaciones = new Map<string, Observacion>();
  const adapter = servidor.of('/').adapter;
  adapter.on('leave-room', (grupo: string) => {
    if (grupo.startsWith(PREFIJO_SALA) && adapter.rooms.get(grupo)?.size) {
      void presencia(servidor, grupo.slice(PREFIJO_SALA.length));
    }
  });
  adapter.on('delete-room', (grupo: string) => {
    observaciones.get(grupo)?.cancelar();
    observaciones.delete(grupo);
  });

  // La API y el servicio Socket.IO comparten Firestore aunque estén en procesos distintos.
  function vigilar(sala: Sala): Observacion {
    const grupo = canal(sala.id);
    const existente = observaciones.get(grupo);
    if (existente) return existente;
    let cancelarWatch: (() => void) | undefined;
    let reintento: ReturnType<typeof setTimeout> | undefined;
    let espera = 1000;
    let generacion = 0;
    const observacion: Observacion = { sala, cancelar: () => {
      generacion++;
      if (reintento) clearTimeout(reintento);
      cancelarWatch?.();
    } };
    observaciones.set(grupo, observacion);

    function observar() {
      if (observaciones.get(grupo) !== observacion || !adapter.rooms.get(grupo)?.size) return;
      const turno = ++generacion;
      const vigente = () => turno === generacion && observaciones.get(grupo) === observacion;
      const fallo = (err: unknown) => {
        if (!vigente()) return;
        generacion++;
        cancelarWatch?.();
        cancelarWatch = undefined;
        console.error('Error observando la sala:', err);
        reintento = setTimeout(() => {
          reintento = undefined;
          observar();
        }, espera);
        espera = Math.min(espera * 2, 30000);
      };
      try {
        const cancelar = observarSala(sala.id, (actual) => {
          if (!vigente()) return;
          espera = 1000;
          const anterior = observacion.sala;
          observacion.sala = actual;
          if (!actual) {
            servidor.to(grupo).emit('sala:eliminada', { salaId: sala.id });
            servidor.in(grupo).socketsLeave(grupo);
          } else if (actual.nombre !== anterior?.nombre || actual.descripcion !== anterior?.descripcion) {
            servidor.to(grupo).emit('sala:actualizada', { sala: actual });
          }
        }, fallo);
        // Un callback síncrono pudo cancelar esta suscripción antes de recibir su cierre.
        if (vigente()) cancelarWatch = cancelar;
        else cancelar();
      } catch (err) {
        fallo(err);
      }
    }
    observar();
    return observacion;
  }

  // io.use espera un callback síncrono: la promesa se maneja aquí.
  servidor.use((socket, next) => {
    autenticar(socket, next).catch(next);
  });

  servidor.on('connection', (socket) => conectar(servidor, socket, vigilar));
  return servidor;
}

async function autenticar(socket: Socket, next: (err?: Error) => void) {
  const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
  const fallo = (code: string, message: string) => next(Object.assign(new Error(message), { data: { code, message } }));
  if (typeof token !== 'string' || !token) return fallo('UNAUTHENTICATED', 'Inicia sesión para continuar.');
  try {
    const { uid } = await getAuthAdmin().verifyIdToken(token, true);
    const perfil = await getPerfil(uid);
    if (!perfil?.username) return fallo('PROFILE_INCOMPLETE', 'Primero elige tu username.');
    const nombre = `${perfil.nombres} ${perfil.apellidos}`.trim() || perfil.username;
    socket.data = { uid, username: perfil.username, nombre, foto: perfil.foto ?? null } satisfies Datos;
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
