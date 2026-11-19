import { DecodedIdToken } from 'firebase-admin/auth';
import { getAuthAdmin } from '../config/firebase';
import { AppError } from '../errors';
import * as repo from '../repositories/users.repository';
import * as roomsRepo from '../repositories/rooms.repository';
import { desconectarUsuario } from '../realtime';
import { Perfil } from '../repositories/users.repository';
import { analizarNombre, fotoValida, NOMBRE_MAX_TOTAL, validarCorreo, validarUsername } from '../validaciones';

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

const REAUTH_MAX_SEG = 5 * 60;

// Valida, exige reautenticación reciente y cambia el correo en Auth.
async function cambiarCorreoAuth(uid: string, token: DecodedIdToken, valor: unknown): Promise<string> {
  const msg = typeof valor === 'string' ? validarCorreo(valor) : 'Escribe tu correo.';
  if (msg || typeof valor !== 'string') throw invalido('correo', msg ?? '');
  // Un token robado no debe poder secuestrar la cuenta cambiando el correo: se exige inicio de sesión reciente.
  // Falla cerrada: sin auth_time (NaN) también se exige reautenticar.
  if (!(Date.now() / 1000 - token.auth_time <= REAUTH_MAX_SEG)) {
    throw new AppError(401, 'REAUTH_REQUIRED', 'Por seguridad, vuelve a iniciar sesión para cambiar tu correo.', 'correo');
  }
  const correo = valor.trim();
  try {
    await getAuthAdmin().updateUser(uid, { email: correo });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'auth/email-already-exists') throw new AppError(409, 'EMAIL_TAKEN', 'Ese correo ya está registrado en otra cuenta.', 'correo');
    if (code === 'auth/invalid-email') throw invalido('correo', 'Escribe un correo con formato nombre@dominio.com.');
    throw err;
  }
  return correo;
}

export async function actualizarYo(uid: string, token: DecodedIdToken, body: Record<string, unknown> | undefined): Promise<PerfilPublico> {
  const actual = await db(repo.getPerfil(uid));
  if (!actual) throw new AppError(409, 'PROFILE_INCOMPLETE', 'Primero elige tu username.');
  const { nombres, apellidos, foto, correo } = body ?? {};
  if (nombres === undefined && apellidos === undefined && foto === undefined && correo === undefined) {
    throw invalido('nombres', 'Envía al menos nombres, apellidos, foto o correo.');
  }
  const datos: Partial<Perfil> = {};
  if (nombres !== undefined || apellidos !== undefined) {
    Object.assign(datos, validarNombres(nombres === undefined ? actual.nombres : nombres, apellidos === undefined ? actual.apellidos : apellidos));
  }
  if (foto !== undefined) datos.foto = validarFoto(foto);
  // El correo vigente es el de Auth (el perfil de Google puede tener `correo: ''`).
  const anterior = correo === undefined ? '' : token.email ?? (await getAuthAdmin().getUser(uid)).email ?? '';
  const cambiaCorreo = correo !== undefined && !(typeof correo === 'string' && correo.trim().toLowerCase() === anterior.trim().toLowerCase());
  if (cambiaCorreo) datos.correo = await cambiarCorreoAuth(uid, token, correo);
  let perfil: Perfil;
  try {
    perfil = Object.keys(datos).length ? await db(repo.actualizarPerfil(uid, datos)) : actual;
  } catch (err) {
    // Sin cuentas inconsistentes: si falla Firestore, el correo de Auth vuelve al anterior.
    // shortcut: rollback fallido solo se registra, cuenta queda inconsistente; reconciliar si pasa en producción
    if (cambiaCorreo) await getAuthAdmin().updateUser(uid, { email: anterior }).catch((e) => console.error('No se pudo revertir el correo:', e));
    throw err;
  }
  return { uid, ...perfil, proveedores: await proveedoresDe(uid) };
}

export async function eliminarYo(uid: string) {
  // Orden: lo que depende del uid primero y la cuenta al final; si falla a mitad, reintentar es seguro (cada paso es idempotente).
  // Revocar antes de cortar: sin esto el cliente reconecta con el mismo token y escribe mensajes con su uid tras anonimizar.
  await getAuthAdmin().revokeRefreshTokens(uid);
  desconectarUsuario(uid);
  await db(roomsRepo.borrarSalasDePropietario(uid));
  await db(roomsRepo.anonimizarMensajes(uid));
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
