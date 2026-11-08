// Utilidades para las pruebas de integración contra los emuladores de Auth y Firestore (proyecto demo-synk).
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const FS = process.env.FIRESTORE_EMULATOR_HOST;
const PROYECTO = process.env.GCLOUD_PROJECT ?? 'demo-synk';

export const hayEmulador = Boolean(AUTH && FS);

const idt = (accion: string, body: object) =>
  fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:${accion}?key=fake`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json() as Promise<{ idToken: string; localId: string }>);

export const limpiar = () =>
  Promise.all([
    fetch(`http://${FS}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`, { method: 'DELETE' }),
    fetch(`http://${AUTH}/emulator/v1/projects/${PROYECTO}/accounts`, { method: 'DELETE' }),
  ]);

/** Cuenta correo/clave: devuelve ID token real del emulador. */
export const crearCuenta = (email: string, password = 'clave-segura-1') => idt('signUp', { email, password, returnSecureToken: true });

export const iniciarSesion = (email: string, password: string) => idt('signInWithPassword', { email, password, returnSecureToken: true });

/** Cuenta Google simulada (el emulador acepta un id_token JSON sin firmar). */
export const crearCuentaGoogle = (sub: string, email: string, name = 'Ana Pérez', picture = 'https://example.com/ana.png') =>
  idt('signInWithIdp', {
    postBody: `id_token=${encodeURIComponent(JSON.stringify({ sub, email, email_verified: true, name, picture }))}&providerId=google.com`,
    requestUri: 'http://localhost',
    returnSecureToken: true,
  });
