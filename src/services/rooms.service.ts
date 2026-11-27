import { AppError } from '../errors';
import { ID_SALA } from '../validaciones';
import { NuevaSala } from '../repositories/rooms.repository';
import * as repo from '../repositories/rooms.repository';

const SALA_NOMBRE_MAX = 80;
const SALA_DESCRIPCION_MAX = 500;

const invalido = (campo: string, message: string) => new AppError(400, 'VALIDATION_ERROR', message, campo);

async function db<T>(op: Promise<T>): Promise<T> {
  try {
    return await op;
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Error en Firestore:', err);
    throw new AppError(503, 'DB_UNAVAILABLE', 'No pudimos conectar con la base de datos. Intenta de nuevo en unos segundos.');
  }
}

function validarDatosSala(body: unknown, parcial = false): Partial<NuevaSala> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw invalido('nombre', 'Envía los datos de la sala.');
  }

  const entrada = body as Record<string, unknown>;
  const datos: Partial<NuevaSala> = {};
  if (!parcial || entrada.nombre !== undefined) {
    if (typeof entrada.nombre !== 'string' || !entrada.nombre.trim()) {
      throw invalido('nombre', 'Escribe el nombre de la sala.');
    }
    datos.nombre = entrada.nombre.trim();
    if ([...datos.nombre].length > SALA_NOMBRE_MAX) {
      throw invalido('nombre', `El nombre de la sala no puede superar ${SALA_NOMBRE_MAX} caracteres.`);
    }
  }

  if (entrada.descripcion !== undefined) {
    if (typeof entrada.descripcion !== 'string') throw invalido('descripcion', 'La descripción debe ser texto.');
    datos.descripcion = entrada.descripcion.trim();
    if ([...datos.descripcion].length > SALA_DESCRIPCION_MAX) {
      throw invalido('descripcion', `La descripción no puede superar ${SALA_DESCRIPCION_MAX} caracteres.`);
    }
  }

  return datos;
}

export async function crearSala(uid: string, body: unknown) {
  const { nombre, descripcion = '' } = validarDatosSala(body);
  return db(repo.crearSala(uid, { nombre: nombre!, descripcion }));
}

export async function listarSalas(uid: string) {
  return { salas: await db(repo.listarSalas(uid)) };
}

export const rolEnSala = (sala: { uid: string }, uid: string) => (sala.uid === uid ? 'anfitrion' : 'participante');

function validarId(id: string) {
  if (!ID_SALA.test(id)) throw invalido('id', 'Indica un ID de sala válido.');
}

export async function obtenerSala(uid: string, id: string) {
  validarId(id);
  const sala = await db(repo.getSala(id));
  if (!sala) throw new AppError(404, 'NOT_FOUND', 'La sala no existe. Revisa el ID.');
  return { ...sala, rol: rolEnSala(sala, uid) };
}

export async function editarSala(uid: string, id: string, body: unknown) {
  validarId(id);
  const cambios = validarDatosSala(body, true);
  if (!Object.keys(cambios).length) throw invalido('nombre', 'Envía un nombre o una descripción para actualizar.');
  return db(repo.editarSala(id, uid, cambios));
}

export async function eliminarSala(uid: string, id: string) {
  validarId(id);
  await db(repo.eliminarSala(id, uid));
}

const PAGINA_MENSAJES = 50;

// Página de historial (antiguo→reciente); sin db(): lo usan la ruta y el ack de sala:unirse, cada uno maneja sus errores.
export async function historial(salaId: string, antes?: string) {
  const leidos = await repo.listarMensajes(salaId, antes, PAGINA_MENSAJES + 1);
  const hayMas = leidos.length > PAGINA_MENSAJES;
  // listarMensajes devuelve antiguo→reciente: el extra (el más antiguo) va al frente.
  return { mensajes: hayMas ? leidos.slice(1) : leidos, hayMas };
}

export async function obtenerMensajes(id: string, antes?: string) {
  if (!ID_SALA.test(id)) throw invalido('id', 'Indica un ID de sala válido.');
  if (antes !== undefined && Number.isNaN(Date.parse(antes))) throw invalido('antes', 'Indica una fecha ISO válida.');
  const desde = antes === undefined ? undefined : new Date(antes).toISOString();
  if (!(await db(repo.getSala(id)))) throw new AppError(404, 'NOT_FOUND', 'La sala no existe. Revisa el ID.');
  return db(historial(id, desde));
}
