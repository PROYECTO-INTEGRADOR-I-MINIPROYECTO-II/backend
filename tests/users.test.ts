import { getAuth } from 'firebase-admin/auth';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/app';
import { getAuthAdmin, getDb } from '../src/config/firebase';
import { crearCuenta, crearCuentaGoogle, hayEmulador, limpiar } from './emulador';

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

// Solo corre con los emuladores (npm run test:int); con `npm test` se omite.
describe.skipIf(!hayEmulador)('usuarios (emuladores)', () => {
  beforeEach(limpiar);
  afterEach(() => vi.restoreAllMocks());

  it('401 sin token y con token inválido', async () => {
    const sin = await request(app).get('/api/usuarios/yo');
    expect(sin.status).toBe(401);
    expect(sin.body.error.code).toBe('UNAUTHENTICATED');
    const mal = await request(app).get('/api/usuarios/yo').set(bearer('basura'));
    expect(mal.status).toBe(401);
    expect(mal.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('JSON malformado -> 400 INVALID_JSON', async () => {
    const { idToken } = await crearCuenta('a@x.com');
    const res = await request(app).put('/api/usuarios/yo/username').set(bearer(idToken)).set('content-type', 'application/json').send('{');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  describe('disponibilidad', () => {
    it('libre, ocupado (sin distinguir mayúsculas) e inválido', async () => {
      const { idToken } = await crearCuenta('a@x.com');
      await request(app).put('/api/usuarios/yo/username').set(bearer(idToken)).send({ username: 'Ana.P' }).expect(200);
      expect((await request(app).get('/api/usernames/otra.persona/disponible')).body).toEqual({ disponible: true });
      expect((await request(app).get('/api/usernames/ANA.p/disponible')).body).toEqual({ disponible: false });
      const mal = await request(app).get('/api/usernames/a__b/disponible');
      expect(mal.status).toBe(400);
      expect(mal.body.error).toMatchObject({ code: 'USERNAME_INVALID', campo: 'username' });
    });
  });

  describe('perfil', () => {
    it('GET yo sin perfil -> username null', async () => {
      const { idToken } = await crearCuenta('a@x.com');
      const res = await request(app).get('/api/usuarios/yo').set(bearer(idToken));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ username: null, correo: 'a@x.com', proveedores: ['password'] });
    });

    it('PUT username crea el perfil y cambiarlo libera el anterior', async () => {
      const { idToken } = await crearCuenta('a@x.com');
      const put = (username: string) => request(app).put('/api/usuarios/yo/username').set(bearer(idToken)).send({ username });
      expect((await put('ana1')).body).toMatchObject({ username: 'ana1', correo: 'a@x.com' });
      expect((await put('ana2')).status).toBe(200);
      expect((await request(app).get('/api/usernames/ana1/disponible')).body.disponible).toBe(true);
      expect((await request(app).get('/api/usuarios/yo').set(bearer(idToken))).body.username).toBe('ana2');
    });

    it('PUT username ocupado -> 409 con campo', async () => {
      const a = await crearCuenta('a@x.com');
      const b = await crearCuenta('b@x.com');
      await request(app).put('/api/usuarios/yo/username').set(bearer(a.idToken)).send({ username: 'ana' }).expect(200);
      const res = await request(app).put('/api/usuarios/yo/username').set(bearer(b.idToken)).send({ username: 'ANA' });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({ code: 'USERNAME_TAKEN', campo: 'username' });
    });

    it('PATCH antes del username -> 409 PROFILE_INCOMPLETE', async () => {
      const { idToken } = await crearCuenta('a@x.com');
      const res = await request(app).patch('/api/usuarios/yo').set(bearer(idToken)).send({ nombres: 'Ana' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PROFILE_INCOMPLETE');
    });

    it('PATCH actualiza y valida por campo', async () => {
      const { idToken } = await crearCuenta('a@x.com');
      await request(app).put('/api/usuarios/yo/username').set(bearer(idToken)).send({ username: 'ana' });
      const ok = await request(app).patch('/api/usuarios/yo').set(bearer(idToken)).send({ nombres: 'Ana María', apellidos: 'Pérez', foto: null });
      expect(ok.body).toMatchObject({ nombres: 'Ana María', apellidos: 'Pérez', foto: null });
      const mal = await request(app).patch('/api/usuarios/yo').set(bearer(idToken)).send({ foto: 'http://inseguro.com/a.png' });
      expect(mal.status).toBe(400);
      expect(mal.body.error).toMatchObject({ code: 'VALIDATION_ERROR', campo: 'foto' });
      const vacio = await request(app).patch('/api/usuarios/yo').set(bearer(idToken)).send({ nombres: '<b>' });
      expect(vacio.body.error.campo).toBe('nombres');
    });

    describe('PATCH correo', () => {
      const preparar = async (correo = 'a@x.com') => {
        const cuenta = await crearCuenta(correo);
        await request(app).put('/api/usuarios/yo/username').set(bearer(cuenta.idToken)).send({ username: 'ana' });
        return { ...cuenta, patch: (b: object) => request(app).patch('/api/usuarios/yo').set(bearer(cuenta.idToken)).send(b) };
      };

      it('cambio exitoso actualiza Auth y perfil', async () => {
        const { localId, patch } = await preparar();
        const res = await patch({ correo: ' Nuevo@x.com ' });
        expect(res.status).toBe(200);
        expect(res.body.correo).toBe('Nuevo@x.com');
        expect((await getAuthAdmin().getUser(localId)).email).toBe('nuevo@x.com');
        expect((await getDb().collection('users').doc(localId).get()).get('correo')).toBe('Nuevo@x.com');
      });

      it('correo de otra cuenta -> 409 EMAIL_TAKEN y nada cambia', async () => {
        await crearCuenta('b@x.com');
        const { localId, patch } = await preparar();
        const res = await patch({ correo: 'B@x.com' });
        expect(res.status).toBe(409);
        expect(res.body.error).toMatchObject({ code: 'EMAIL_TAKEN', campo: 'correo' });
        expect((await getAuthAdmin().getUser(localId)).email).toBe('a@x.com');
        expect((await getDb().collection('users').doc(localId).get()).get('correo')).toBe('a@x.com');
      });

      it('formato inválido -> 400 con campo', async () => {
        const { patch } = await preparar();
        const res = await patch({ correo: 'no-es-correo' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatchObject({ code: 'VALIDATION_ERROR', campo: 'correo' });
        expect((await patch({ correo: null })).body.error.campo).toBe('correo');
      });

      it('inicio de sesión viejo -> 401 REAUTH_REQUIRED', async () => {
        const { idToken, localId, patch } = await preparar();
        const real = await getAuthAdmin().verifyIdToken(idToken);
        vi.spyOn(getAuthAdmin(), 'verifyIdToken').mockResolvedValue({ ...real, auth_time: real.auth_time - 10 * 60 });
        const res = await patch({ correo: 'nuevo@x.com' });
        expect(res.status).toBe(401);
        expect(res.body.error).toMatchObject({ code: 'REAUTH_REQUIRED', campo: 'correo' });
        expect((await getAuthAdmin().getUser(localId)).email).toBe('a@x.com');
      });

      it('token sin auth_time -> 401 REAUTH_REQUIRED', async () => {
        const { idToken, patch } = await preparar();
        const { auth_time, ...sinAuthTime } = await getAuthAdmin().verifyIdToken(idToken);
        vi.spyOn(getAuthAdmin(), 'verifyIdToken').mockResolvedValue(sinAuthTime as never);
        const res = await patch({ correo: 'nuevo@x.com' });
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('REAUTH_REQUIRED');
      });

      it('mismo correo (sin distinguir mayúsculas) -> 200 sin reautenticar ni cambios', async () => {
        const { idToken, localId, patch } = await preparar();
        const real = await getAuthAdmin().verifyIdToken(idToken);
        vi.spyOn(getAuthAdmin(), 'verifyIdToken').mockResolvedValue({ ...real, auth_time: real.auth_time - 10 * 60 });
        const res = await patch({ correo: ' A@X.com ' });
        expect(res.status).toBe(200);
        expect(res.body.correo).toBe('a@x.com');
        expect((await getAuthAdmin().getUser(localId)).email).toBe('a@x.com');
      });
    });

    it('PATCH con null: nombres/apellidos -> 400, foto null la quita', async () => {
      const { idToken } = await crearCuenta('a@x.com');
      await request(app).put('/api/usuarios/yo/username').set(bearer(idToken)).send({ username: 'ana' });
      const patch = (b: object) => request(app).patch('/api/usuarios/yo').set(bearer(idToken)).send(b);
      expect((await patch({ nombres: null })).body.error).toMatchObject({ code: 'VALIDATION_ERROR', campo: 'nombres' });
      expect((await patch({ apellidos: null })).body.error).toMatchObject({ code: 'VALIDATION_ERROR', campo: 'apellidos' });
      await patch({ foto: 'https://example.com/a.png' }).expect(200);
      expect((await patch({ foto: null })).body.foto).toBeNull();
    });

    it('PATCH foto data URL: válida, demasiado grande y MIME no permitido', async () => {
      const { idToken } = await crearCuenta('a@x.com');
      await request(app).put('/api/usuarios/yo/username').set(bearer(idToken)).send({ username: 'ana' });
      const patch = (foto: string) => request(app).patch('/api/usuarios/yo').set(bearer(idToken)).send({ foto });
      const ok = 'data:image/png;base64,iVBORw0KGgo=';
      expect((await patch(ok)).body.foto).toBe(ok);
      const grande = await patch(`data:image/png;base64,${'A'.repeat(100_000)}`);
      expect(grande.body.error).toMatchObject({ code: 'VALIDATION_ERROR', campo: 'foto' });
      expect((await patch('data:image/gif;base64,R0lGODlh')).body.error.campo).toBe('foto');
    });

    it('cuerpo muy grande -> 413 JSON', async () => {
      const { idToken } = await crearCuenta('a@x.com');
      const res = await request(app).patch('/api/usuarios/yo').set(bearer(idToken)).send({ foto: 'A'.repeat(300_000) });
      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('DELETE yo borra Auth y Firestore y libera el username', async () => {
      const { idToken, localId } = await crearCuenta('a@x.com');
      await request(app).put('/api/usuarios/yo/username').set(bearer(idToken)).send({ username: 'ana' });
      await request(app).delete('/api/usuarios/yo').set(bearer(idToken)).expect(204);
      expect((await request(app).get('/api/usernames/ana/disponible')).body.disponible).toBe(true);
      expect((await getDb().collection('users').doc(localId).get()).exists).toBe(false);
      await expect(getAuthAdmin().getUser(localId)).rejects.toThrow();
    });
  });

  describe('proveedor Google', () => {
    it('desvincular el último proveedor -> 409 LAST_PROVIDER', async () => {
      const { idToken } = await crearCuentaGoogle('g1', 'g@x.com');
      const res = await request(app).delete('/api/usuarios/yo/proveedores/google').set(bearer(idToken));
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('LAST_PROVIDER');
    });

    it('desvincular con contraseña asignada -> 204', async () => {
      const { idToken, localId } = await crearCuentaGoogle('g1', 'g@x.com');
      await getAuth().updateUser(localId, { password: 'clave-segura-1' });
      await request(app).delete('/api/usuarios/yo/proveedores/google').set(bearer(idToken)).expect(204);
      expect((await getAuthAdmin().getUser(localId)).providerData.map((p) => p.providerId)).toEqual(['password']);
    });
  });
});
