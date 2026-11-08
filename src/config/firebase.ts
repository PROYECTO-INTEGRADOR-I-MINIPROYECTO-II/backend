import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

// Perezoso: el server arranca sin credenciales; el error aparece al primer uso.
function init() {
  if (getApps().length) return;
  const emulador = process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (process.env.NODE_ENV === 'production' && emulador) throw new Error('Los emuladores de Firebase no se pueden usar en producción');
  // Con emulador no hace falta credencial (proyecto demo-*: nunca toca un proyecto real).
  if (emulador) {
    initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? 'demo-synk' });
    return;
  }
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('Falta la variable FIREBASE_SERVICE_ACCOUNT');
  let account;
  try {
    account = JSON.parse(Buffer.from(raw, 'base64').toString());
  } catch {
    // No relanzar el SyntaxError: su mensaje incluye un fragmento de la credencial.
    throw new Error('FIREBASE_SERVICE_ACCOUNT inválida (debe ser el JSON en base64)');
  }
  initializeApp({ credential: cert(account) });
}

export function getDb() {
  init();
  return getFirestore();
}

export function getAuthAdmin() {
  init();
  return getAuth();
}
