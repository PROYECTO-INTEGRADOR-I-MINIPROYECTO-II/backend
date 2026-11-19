import { getDb } from '../config/firebase';

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

export async function crearSala(uid: string, datos: NuevaSala): Promise<Sala> {
  const ref = salas().doc();
  const sala: Omit<Sala, 'id'> = { ...datos, uid, creado: new Date().toISOString() };
  await ref.create(sala);
  return { id: ref.id, ...sala };
}

export async function listarSalas(uid: string): Promise<Sala[]> {
  const snapshot = await salas().where('uid', '==', uid).get();
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<Sala, 'id'>) }))
    .sort((a, b) => b.creado.localeCompare(a.creado) || a.id.localeCompare(b.id));
}

export async function borrarSalasDePropietario(uid: string): Promise<void> {
  const db = getDb();
  const collection = salas();
  const tamanoLote = 450;

  while (true) {
    const snapshot = await collection.where('uid', '==', uid).limit(tamanoLote).get();
    if (snapshot.empty) return;
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    if (snapshot.size < tamanoLote) return;
  }
}
