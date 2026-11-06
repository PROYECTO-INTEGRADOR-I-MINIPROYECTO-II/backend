import { getDb } from '../config/firebase';

export interface BaseInfo {
  mensaje: string;
  actualizado: string;
}

export async function getBaseInfo(): Promise<BaseInfo | null> {
  const doc = await getDb().collection('base').doc('info').get();
  const mensaje = doc.get('mensaje');
  if (!doc.exists || typeof mensaje !== 'string') return null;
  return { mensaje, actualizado: doc.updateTime!.toDate().toISOString() };
}
