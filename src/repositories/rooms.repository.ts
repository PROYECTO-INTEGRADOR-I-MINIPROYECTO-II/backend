import { getDb } from '../config/firebase';
import { AppError } from '../errors';

export interface Sala {
  id: string;
  nombre: string;
  descripcion: string;
  uid: string;
  creado: string;
}

export interface NuevaSala {
  nombre: string;
  descripcion: string;
}

const salas = () => getDb().collection('rooms');
type DatosSala = Omit<Sala, 'id'> & { eliminada?: true };

function salaActiva(id: string, datos: DatosSala | undefined): Sala | null {
  if (!datos || datos.eliminada) return null;
  const { nombre, descripcion, uid, creado } = datos;
  return { id, nombre, descripcion, uid, creado };
}

function salaDelAnfitrion(datos: DatosSala | undefined, uid: string): DatosSala {
  if (!datos) throw new AppError(404, 'NOT_FOUND', 'La sala no existe. Revisa el ID.');
  if (datos.uid !== uid) throw new AppError(403, 'FORBIDDEN', 'Solo el anfitrión puede editar o eliminar la sala.');
  return datos;
}

export async function crearSala(uid: string, datos: NuevaSala): Promise<Sala> {
  const ref = salas().doc();
  const sala: Omit<Sala, 'id'> = { ...datos, uid, creado: new Date().toISOString() };
  await ref.create(sala);
  return { id: ref.id, ...sala };
}

export async function listarSalas(uid: string): Promise<Sala[]> {
  const snapshot = await salas().where('uid', '==', uid).get();
  return snapshot.docs
    .map((doc) => salaActiva(doc.id, doc.data() as DatosSala))
    .filter((sala): sala is Sala => sala !== null)
    .sort((a, b) => b.creado.localeCompare(a.creado) || a.id.localeCompare(b.id));
}

export async function borrarSalasDePropietario(uid: string): Promise<void> {
  const snapshot = await salas().where('uid', '==', uid).get();
  for (const doc of snapshot.docs) {
    try {
      await eliminarSala(doc.id, uid);
    } catch (err) {
      // El anfitrión también pudo borrar la sala desde la API.
      if (!(err instanceof AppError && err.status === 404)) throw err;
    }
  }
}

// Los mensajes del usuario en salas ajenas se conservan anonimizados. Repite hasta vaciar la consulta.
export async function anonimizarMensajes(uid: string): Promise<void> {
  const tamanoLote = 450;
  while (true) {
    const snapshot = await getDb().collectionGroup('messages').where('uid', '==', uid).limit(tamanoLote).get();
    if (snapshot.empty) return;
    const batch = getDb().batch();
    snapshot.docs.forEach((doc) => batch.update(doc.ref, { uid: null, autor: 'Usuario eliminado' }));
    await batch.commit();
  }
}

export async function getSala(id: string): Promise<Sala | null> {
  const doc = await salas().doc(id).get();
  return salaActiva(doc.id, doc.data() as DatosSala | undefined);
}

export function observarSala(id: string, cambio: (sala: Sala | null) => void, error: (err: Error) => void) {
  return salas().doc(id).onSnapshot((doc) => cambio(salaActiva(doc.id, doc.data() as DatosSala | undefined)), error);
}

export function editarSala(id: string, uid: string, cambios: Partial<NuevaSala>): Promise<Sala> {
  const ref = salas().doc(id);
  return getDb().runTransaction(async (tx) => {
    const datos = (await tx.get(ref)).data() as DatosSala | undefined;
    if (datos?.eliminada) throw new AppError(404, 'NOT_FOUND', 'La sala no existe. Revisa el ID.');
    const sala = salaDelAnfitrion(datos, uid);
    tx.update(ref, cambios);
    return { id, ...sala, ...cambios };
  });
}

export async function eliminarSala(id: string, uid: string): Promise<void> {
  const ref = salas().doc(id);
  await getDb().runTransaction(async (tx) => {
    const datos = salaDelAnfitrion((await tx.get(ref)).data() as DatosSala | undefined, uid);
    // Mantiene el propietario para poder reintentar la limpieza si Firestore falla.
    if (!datos.eliminada) tx.update(ref, { eliminada: true });
  });
  await getDb().recursiveDelete(ref.collection('messages'));
  await ref.delete();
}

export interface NuevoMensaje {
  uid: string;
  autor: string;
  texto: string;
}

export interface Mensaje extends Omit<NuevoMensaje, 'uid'> {
  id: string;
  salaId: string;
  uid: string | null;
  creado: string;
}

// rooms/{salaId}/messages/{auto}: esquema fijo { uid, autor, texto, creado (ISO) }.
export async function guardarMensaje(salaId: string, datos: NuevoMensaje): Promise<Mensaje | null> {
  const sala = salas().doc(salaId);
  const ref = sala.collection('messages').doc();
  const doc = { uid: datos.uid, autor: datos.autor, texto: datos.texto, creado: new Date().toISOString() };
  return getDb().runTransaction(async (tx) => {
    if (!salaActiva(salaId, (await tx.get(sala)).data() as DatosSala | undefined)) return null;
    tx.create(ref, doc);
    return { id: ref.id, salaId, ...doc };
  });
}

export async function listarMensajes(salaId: string, antes?: string, limite = 50): Promise<Mensaje[]> {
  // shortcut: mensajes con el mismo ms en el borde de página se paginan solo por creado; añadir id como desempate si pasa.
  let consulta = salas().doc(salaId).collection('messages').orderBy('creado', 'desc');
  if (antes) consulta = consulta.where('creado', '<', antes);
  const snapshot = await consulta.limit(limite).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, salaId, ...(doc.data() as Omit<Mensaje, 'id' | 'salaId'>) })).reverse();
}
