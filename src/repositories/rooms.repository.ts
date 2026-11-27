import { FieldPath } from 'firebase-admin/firestore';
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

// Borra cada sala con su subcolección de mensajes (recursiveDelete), sin dejar huérfanos.
export async function borrarSalasDePropietario(uid: string): Promise<void> {
  const snapshot = await salas().where('uid', '==', uid).get();
  for (const doc of snapshot.docs) await getDb().recursiveDelete(doc.ref);
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
  return doc.exists ? { id: doc.id, ...(doc.data() as Omit<Sala, 'id'>) } : null;
}

export interface NuevoMensaje {
  uid: string;
  autor: string;
  texto: string;
}

export interface Mensaje extends NuevoMensaje {
  id: string;
  salaId: string;
  creado: string;
}

// rooms/{salaId}/messages/{auto}: esquema fijo { uid, autor, texto, creado (ISO) }.
export async function guardarMensaje(salaId: string, datos: NuevoMensaje): Promise<Mensaje> {
  const ref = salas().doc(salaId).collection('messages').doc();
  const doc = { uid: datos.uid, autor: datos.autor, texto: datos.texto, creado: new Date().toISOString() };
  await ref.create(doc);
  return { id: ref.id, salaId, ...doc };
}

export async function listarMensajes(salaId: string, limite: number, antes?: string, antesId?: string): Promise<Mensaje[]> {
  let consulta = salas().doc(salaId).collection('messages').orderBy('creado', 'desc').orderBy(FieldPath.documentId(), 'desc');
  if (antes) consulta = antesId ? consulta.startAfter(antes, antesId) : consulta.startAfter(antes);
  const snapshot = await consulta.limit(limite).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, salaId, ...(doc.data() as Omit<Mensaje, 'id' | 'salaId'>) })).reverse();
}
