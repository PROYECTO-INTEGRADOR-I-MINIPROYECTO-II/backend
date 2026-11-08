import { getAuthAdmin } from '../config/firebase';
import { AppError } from '../errors';
import * as repo from '../repositories/users.repository';
import { validarClave, validarCorreo, validarUsername } from '../validaciones';
import { db, PerfilPublico, validarFoto, validarNombres } from './users.service';

const invalido = (campo: string, message: string) => new AppError(400, 'VALIDATION_ERROR', message, campo);

export async function registrar(body: Record<string, unknown> | undefined): Promise<PerfilPublico> {
  const { nombres, apellidos, username, correo, clave, foto } = body ?? {};
  const nombre = validarNombres(nombres, apellidos ?? '');
  const eUsername = typeof username === 'string' ? validarUsername(username) : 'Escribe tu username.';
  if (eUsername || typeof username !== 'string') throw invalido('username', eUsername ?? '');
  const eCorreo = typeof correo === 'string' ? validarCorreo(correo) : 'Escribe tu correo.';
  if (eCorreo || typeof correo !== 'string') throw invalido('correo', eCorreo ?? '');
  const eClave = typeof clave === 'string' ? validarClave(clave, true) : 'Escribe tu contraseña.';
  if (eClave || typeof clave !== 'string') throw invalido('clave', eClave ?? '');
  const fotoOk = foto === undefined ? null : validarFoto(foto);

  const auth = getAuthAdmin();
  let uid: string;
  try {
    uid = (await auth.createUser({ email: correo.trim(), password: clave })).uid;
  } catch (err) {
    if ((err as { code?: string }).code === 'auth/email-already-exists') {
      throw new AppError(409, 'EMAIL_TAKEN', 'Ese correo ya tiene una cuenta. Inicia sesión.', 'correo');
    }
    throw err;
  }
  try {
    const perfil = await db(repo.guardarUsername(uid, username, { ...nombre, foto: fotoOk, correo: correo.trim(), creado: new Date().toISOString() }));
    return { uid, ...perfil, proveedores: ['password'] };
  } catch (err) {
    // Sin cuentas huérfanas: si no se pudo reservar el username, se deshace la cuenta de Auth.
    await auth.deleteUser(uid).catch((e) => console.error('No se pudo deshacer la cuenta de Auth:', e));
    throw err;
  }
}
