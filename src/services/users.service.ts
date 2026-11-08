import { DecodedIdToken } from 'firebase-admin/auth';
import { getAuthAdmin } from '../config/firebase';
import { AppError } from '../errors';
import * as repo from '../repositories/users.repository';
import { Perfil } from '../repositories/users.repository';
import { analizarNombre, fotoValida, NOMBRE_MAX_TOTAL, validarUsername } from '../validaciones';

export type PerfilPublico = Omit<Perfil, 'username' | 'creado'> & {
  uid: string;
  username: string | null;
  creado?: string;
  proveedores: string[];
};

// Errores de Firestore -> 503 (los AppError, como USERNAME_TAKEN, pasan tal cual).
export async function db<T>(op: Promise<T>): Promise<T> {
  try {
    return await op;
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Error en Firestore:', err);
    throw new AppError(503, 'DB_UNAVAILABLE', 'No pudimos conectar con la base de datos. Intenta de nuevo en unos segundos.');
  }
}

const invalido = (campo: string, message: string) => new AppError(400, 'VALIDATION_ERROR', message, campo);

export function validarUsernameCampo(v: unknown): string {
  const msg = typeof v === 'string' ? validarUsername(v) : 'Escribe tu username.';
  if (msg || typeof v !== 'string') throw new AppError(400, 'USERNAME_INVALID', msg ?? '', 'username');
  return v.trim();
}

export function validarNombres(nombres: unknown, apellidos: unknown) {
  if (typeof nombres !== 'string') throw invalido('nombres', 'Escribe tus nombres.');
  if (typeof apellidos !== 'string') throw invalido('apellidos', 'Los apellidos deben ser texto.');
  const n = nombres.trim();
  const a = apellidos.trim();
  const rn = analizarNombre(n, NOMBRE_MAX_TOTAL - [...a].length);
  if (rn.tipo === 'vacio') throw invalido('nombres', 'Escribe tus nombres.');
  if (rn.tipo !== 'ok') throw invalido('nombres', rn.mensaje ?? 'Nombres no válidos.');
  const ra = analizarNombre(a, NOMBRE_MAX_TOTAL - [...n].length);
  if (ra.tipo !== 'ok' && ra.tipo !== 'vacio') throw invalido('apellidos', ra.mensaje ?? 'Apellidos no válidos.');
  return { nombres: n, apellidos: a };
}

export function validarFoto(foto: unknown): string | null {
  if (!fotoValida(foto)) throw invalido('foto', 'La foto debe ser una URL https o una imagen png, jpeg o webp de hasta 100 KB.');
  return foto;
}

const proveedoresDe = async (uid: string) => (await getAuthAdmin().getUser(uid)).providerData.map((p) => p.providerId);

export async function disponibilidad(username: string) {
  return { disponible: await db(repo.usernameLibre(validarUsernameCampo(username))) };
}

export async function getYo(uid: string, token: DecodedIdToken): Promise<PerfilPublico> {
  const [perfil, proveedores] = await Promise.all([db(repo.getPerfil(uid)), proveedoresDe(uid)]);
  if (perfil) return { uid, ...perfil, proveedores };
  return { uid, username: null, ...datosDeToken(token), proveedores };
}

// Datos iniciales de quien aún no tiene perfil (Google): nombre/foto/correo salen del token si son válidos.
export function datosDeToken(token: DecodedIdToken): Pick<Perfil, 'nombres' | 'apellidos' | 'foto' | 'correo'> {
  const nombre = typeof token.name === 'string' ? token.name.trim() : '';
  const ok = analizarNombre(nombre).tipo === 'ok';
  return { nombres: ok ? nombre : '', apellidos: '', foto: typeof token.picture === 'string' && fotoValida(token.picture) ? token.picture : null, correo: token.email ?? '' };
}

export async function ponerUsername(uid: string, token: DecodedIdToken, username: unknown): Promise<PerfilPublico> {
  const u = validarUsernameCampo(username);
  const base = datosDeToken(token);
  const perfil = await db(repo.guardarUsername(uid, u, { ...base, nombres: base.nombres || u, creado: new Date().toISOString() }));
  return { uid, ...perfil, proveedores: await proveedoresDe(uid) };
}

export async function actualizarYo(uid: string, body: Record<string, unknown> | undefined): Promise<PerfilPublico> {
  const actual = await db(repo.getPerfil(uid));
  if (!actual) throw new AppError(409, 'PROFILE_INCOMPLETE', 'Primero elige tu username.');
  const { nombres, apellidos, foto } = body ?? {};
  if (nombres === undefined && apellidos === undefined && foto === undefined) {
    throw invalido('nombres', 'Envía al menos nombres, apellidos o foto.');
  }
  const datos: Partial<Perfil> = {};
  if (nombres !== undefined || apellidos !== undefined) {
    Object.assign(datos, validarNombres(nombres === undefined ? actual.nombres : nombres, apellidos === undefined ? actual.apellidos : apellidos));
  }
  if (foto !== undefined) datos.foto = validarFoto(foto);
  const perfil = await db(repo.actualizarPerfil(uid, datos));
  return { uid, ...perfil, proveedores: await proveedoresDe(uid) };
}

export async function eliminarYo(uid: string) {
  await db(repo.borrarPerfil(uid));
  await getAuthAdmin().deleteUser(uid);
}

export async function desvincularGoogle(uid: string) {
  const proveedores = await proveedoresDe(uid);
  if (!proveedores.includes('google.com')) throw new AppError(404, 'NOT_FOUND', 'Tu cuenta no tiene Google vinculado.');
  if (!proveedores.includes('password')) {
    throw new AppError(409, 'LAST_PROVIDER', 'Google es tu único método de acceso. Agrega una contraseña antes de desvincularlo.');
  }
  await getAuthAdmin().updateUser(uid, { providersToUnlink: ['google.com'] });
}
