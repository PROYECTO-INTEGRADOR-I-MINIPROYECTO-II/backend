import { getDb } from '../config/firebase';

export interface Sala {
  id: string;
  nombre: string;
  descripcion: string;
  ownerUid: string;
  creado: string;
}

export interface NuevaSala {
  nombre: string;
  descripcion: string;
}

const salas = () => getDb().collection('rooms');

export async function crearSala(ownerUid: string, datos: NuevaSala): Promise<Sala> {
  const ref = salas().doc();
  const sala: Omit<Sala, 'id'> = { ...datos, ownerUid, creado: new Date().toISOString() };
  await ref.create(sala);
  return { id: ref.id, ...sala };
}

export async function listarSalas(ownerUid: string): Promise<Sala[]> {
  const snapshot = await salas().where('ownerUid', '==', ownerUid).get();
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<Sala, 'id'>) }))
    .sort((a, b) => b.creado.localeCompare(a.creado) || a.id.localeCompare(b.id));
}

export async function borrarSalasDePropietario(ownerUid: string): Promise<void> {
  const db = getDb();
  const collection = salas();
  const tamanoLote = 450;

  while (true) {
    const snapshot = await collection.where('ownerUid', '==', ownerUid).limit(tamanoLote).get();
    if (snapshot.empty) return;
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    if (snapshot.size < tamanoLote) return;
  }
}
