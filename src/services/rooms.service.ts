import { AppError } from '../errors';
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

function validarNuevaSala(body: unknown): NuevaSala {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw invalido('nombre', 'Envía los datos de la sala.');
  }

  const entrada = body as Record<string, unknown>;
  if (typeof entrada.nombre !== 'string' || !entrada.nombre.trim()) {
    throw invalido('nombre', 'Escribe el nombre de la sala.');
  }
  const nombre = entrada.nombre.trim();
  if ([...nombre].length > SALA_NOMBRE_MAX) {
    throw invalido('nombre', `El nombre de la sala no puede superar ${SALA_NOMBRE_MAX} caracteres.`);
  }

  if (entrada.descripcion !== undefined && typeof entrada.descripcion !== 'string') {
    throw invalido('descripcion', 'La descripción debe ser texto.');
  }
  const descripcion = typeof entrada.descripcion === 'string' ? entrada.descripcion.trim() : '';
  if ([...descripcion].length > SALA_DESCRIPCION_MAX) {
    throw invalido('descripcion', `La descripción no puede superar ${SALA_DESCRIPCION_MAX} caracteres.`);
  }

  return { nombre, descripcion };
}

export async function crearSala(ownerUid: string, body: unknown) {
  return db(repo.crearSala(ownerUid, validarNuevaSala(body)));
}

export async function listarSalas(ownerUid: string) {
  return { salas: await db(repo.listarSalas(ownerUid)) };
}
