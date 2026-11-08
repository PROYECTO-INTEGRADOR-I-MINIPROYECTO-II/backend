import { NextFunction, Request, Response } from 'express';
import { DecodedIdToken } from 'firebase-admin/auth';
import { getAuthAdmin } from '../config/firebase';
import { AppError } from '../errors';

export interface AuthLocals {
  uid: string;
  token: DecodedIdToken;
}

// Verifica el ID token (checkRevoked=true: un token revocado deja de valer). Deja uid y token en res.locals.
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
  const sinSesion = new AppError(401, 'UNAUTHENTICATED', 'Inicia sesión para continuar.');
  if (!token) return next(sinSesion);
  try {
    const decoded = await getAuthAdmin().verifyIdToken(token, true);
    Object.assign(res.locals, { uid: decoded.uid, token: decoded } satisfies AuthLocals);
    next();
  } catch (err) {
    if (String((err as { code?: unknown }).code).startsWith('auth/')) return next(sinSesion);
    console.error('Error verificando el token:', err);
    next(new AppError(503, 'AUTH_UNAVAILABLE', 'No pudimos verificar tu sesión. Intenta de nuevo en unos segundos.'));
  }
}
