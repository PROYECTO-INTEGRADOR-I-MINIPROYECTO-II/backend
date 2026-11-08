import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../src/config/firebase';

describe('config/firebase', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ['emulador en producción', { NODE_ENV: 'production', FIRESTORE_EMULATOR_HOST: 'localhost:8080' }, /producción/],
    ['sin credencial', { FIRESTORE_EMULATOR_HOST: '', FIREBASE_AUTH_EMULATOR_HOST: '', FIREBASE_SERVICE_ACCOUNT: '' }, /Falta/],
    ['credencial ilegible', { FIRESTORE_EMULATOR_HOST: '', FIREBASE_AUTH_EMULATOR_HOST: '', FIREBASE_SERVICE_ACCOUNT: 'no-json' }, /inválida/],
  ])('%s -> error', (_n, env, msg) => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    expect(() => getDb()).toThrow(msg);
  });
});
