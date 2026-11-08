import { getDb } from '../config/firebase';
import { AppError } from '../errors';
import { normalizarUsername } from '../validaciones';

export interface Perfil {
  username: string;
  nombres: string;
  apellidos: string;
  foto: string | null;
  correo: string;
  creado: string;
}

const users = () => getDb().collection('users');
const usernames = () => getDb().collection('usernames');

export async function getPerfil(uid: string): Promise<Perfil | null> {
  const doc = await users().doc(uid).get();
  return doc.exists ? (doc.data() as Perfil) : null;
}

export async function usernameLibre(username: string): Promise<boolean> {
  return !(await usernames().doc(normalizarUsername(username)).get()).exists;
}

// users/{uid} y usernames/{norm} siempre cambian juntos. Si el perfil no existe lo crea con `nuevo`;
// si existe cambia el username y libera el anterior.
export async function guardarUsername(uid: string, username: string, nuevo: Omit<Perfil, 'username'>): Promise<Perfil> {
  const db = getDb();
  const clave = normalizarUsername(username);
  return db.runTransaction(async (tx) => {
    const [reserva, actual] = await Promise.all([tx.get(usernames().doc(clave)), tx.get(users().doc(uid))]);
    if (reserva.exists && reserva.get('uid') !== uid) {
      throw new AppError(409, 'USERNAME_TAKEN', 'Ese username ya está en uso. Elige otro.', 'username');
    }
    const previo = actual.data() as Perfil | undefined;
    if (previo && normalizarUsername(previo.username) !== clave) tx.delete(usernames().doc(normalizarUsername(previo.username)));
    const perfil: Perfil = { ...(previo ?? nuevo), username: username.trim() };
    tx.set(usernames().doc(clave), { uid });
    tx.set(users().doc(uid), perfil);
    return perfil;
  });
}

export async function actualizarPerfil(uid: string, datos: Partial<Pick<Perfil, 'nombres' | 'apellidos' | 'foto'>>): Promise<Perfil> {
  const ref = users().doc(uid);
  await ref.update(datos);
  return (await ref.get()).data() as Perfil;
}

export async function borrarPerfil(uid: string): Promise<void> {
  await getDb().runTransaction(async (tx) => {
    const actual = await tx.get(users().doc(uid));
    const username = actual.get('username') as string | undefined;
    if (username) tx.delete(usernames().doc(normalizarUsername(username)));
    tx.delete(users().doc(uid));
  });
}
