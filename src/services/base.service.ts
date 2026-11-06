import { AppError } from '../errors';
import { BaseInfo, getBaseInfo } from '../repositories/base.repository';

export async function getBase(): Promise<BaseInfo> {
  let info: BaseInfo | null;
  try {
    info = await getBaseInfo();
  } catch (err) {
    console.error('Error leyendo Firestore:', err);
    throw new AppError(503, 'DB_UNAVAILABLE', 'No pudimos conectar con la base de datos. Intenta de nuevo en unos segundos.');
  }
  if (!info) throw new AppError(404, 'NOT_FOUND', 'Aún no hay datos de la base técnica.');
  return info;
}
