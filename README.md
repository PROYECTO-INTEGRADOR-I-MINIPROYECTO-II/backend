# Synk Backend

API Node.js + TypeScript (Express) de Synk, salas de estudio. Sprint 0 (TS-00): lee un dato de Firestore (`base/info`) y lo entrega al frontend (React en Vercel). Desplegada en Render con Docker.

**Producción:** https://synk-api-neop.onrender.com · [`/api/health`](https://synk-api-neop.onrender.com/api/health) · [`/api/base`](https://synk-api-neop.onrender.com/api/base) · [Swagger](https://synk-api-neop.onrender.com/api/docs)

> Plan Free de Render: tras 15 min sin uso el servicio se duerme y la primera petición tarda ~50 s.

## Endpoints

Documentación Swagger: `/api/docs`.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | `200 { "status": "ok" }` (no toca Firestore) |
| GET | `/api/base` | `200 { mensaje, actualizado }`; `404 NOT_FOUND` si no hay dato; `503 DB_UNAVAILABLE` si Firestore no responde |

| POST | `/api/auth/registro` | Público. `{ nombres, apellidos, username, correo, clave, foto? }` -> `201` con el perfil; `400 VALIDATION_ERROR` (con `campo`), `409 EMAIL_TAKEN` / `USERNAME_TAKEN`. Si el username está ocupado se deshace la cuenta de Auth. Luego el cliente inicia sesión con Firebase |
| GET | `/api/usernames/:username/disponible` | Público. `{ disponible }` (no distingue mayúsculas); `400 USERNAME_INVALID` |
| GET | `/api/usuarios/yo` | Perfil de la sesión + `proveedores`. Sin perfil (Google nuevo): `username: null` con nombre/foto/correo del token |
| PATCH | `/api/usuarios/yo` | `{ nombres, apellidos, foto }` (cualquiera); `409 PROFILE_INCOMPLETE` si aún no tiene username |
| PUT | `/api/usuarios/yo/username` | `{ username }`: crea el perfil o cambia el username (libera el anterior); `409 USERNAME_TAKEN` |
| DELETE | `/api/usuarios/yo` | Elimina la cuenta (`204`) |
| DELETE | `/api/usuarios/yo/proveedores/google` | Desvincula Google (`204`); `409 LAST_PROVIDER` si no tiene contraseña |
| POST | `/api/salas` | Crea una sala privada `{ nombre, descripcion? }` (`201`); el servidor asigna el ID y propietario |
| GET | `/api/salas` | Lista las salas privadas creadas por la sesión (`{ salas }`) |

Las rutas `/api/usuarios/**` exigen `Authorization: Bearer <ID token de Firebase>`; sin token, inválido, vencido o revocado: `401 UNAUTHENTICATED`. El login lo hace Firebase en el cliente; `GET /api/usuarios/yo` sirve para comprobar la sesión.

Errores: `{ "error": { "code", "message", "campo"? } }` (`campo` indica el campo del formulario). Siempre JSON; un cuerpo mal formado da `400 INVALID_JSON`.

### Datos y eliminación de cuenta

`users/{uid}` y `usernames/{username en minúsculas}` se escriben siempre en la misma transacción. `firestore.rules` niega todo acceso directo: solo el backend lee/escribe.

Política al eliminar la cuenta: se borran las salas creadas por el usuario, `users`, `usernames` y el usuario de Firebase Auth. Las salas son privadas y solo aparecen en el listado de su propietario; el ID generado por Firestore identifica la sala.

## Correr local

```bash
cp .env.example .env   # completar FIREBASE_SERVICE_ACCOUNT
npm install
npm run dev            # http://localhost:3000
```

Con Docker:

```bash
docker compose up --build
```

El servidor arranca sin `FIREBASE_SERVICE_ACCOUNT`; solo `/api/base` responderá 503.

## Variables de entorno

| Variable | Descripción |
|---|---|
| `PORT` | Puerto (por defecto 3000) |
| `CORS_ORIGIN` | Orígenes permitidos separados por coma (por defecto `*`) |
| `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST` | Solo pruebas/desarrollo con emuladores (no requieren credencial) |
| `FIREBASE_SERVICE_ACCOUNT` | JSON de la service account en base64: `base64 -w0 service-account.json` |

## Seed

Escribe `base/info` en Firestore (usa la misma variable de entorno):

```bash
export FIREBASE_SERVICE_ACCOUNT=$(base64 -w0 service-account.json)
npm run seed
```

## Tests

```bash
npm test          # vitest + cobertura; omite las pruebas que necesitan emuladores
npm run test:int  # igual, pero con emuladores de Auth y Firestore (proyecto demo-synk; requiere Java 21+)
npm run typecheck
```

`test:int` levanta los emuladores con `firebase emulators:exec --project demo-synk`: el prefijo `demo-` garantiza que no toca ningún proyecto real.

## CI/CD

- `ci.yml` (PR y push a main): typecheck, `test:int` (con Java 21 para los emuladores), SonarCloud y `docker build`.
- `deploy.yml` (tras CI exitoso en main): publica `ghcr.io/<owner>/backend:<sha>` y `:latest`, y llama al deploy hook de Render.

- `ping.yml` (cada 10 min): `curl` a `/api/health` en Render para evitar el arranque en frío.

Secrets del repo: `SONAR_TOKEN`, `RENDER_DEPLOY_HOOK` (la URL del hook de Render, que ya incluye `?key=...`).

Render: Web Service con "Existing image" desde `ghcr.io/proyecto-integrador-i-miniproyecto-ii/backend:latest` (paquete GHCR público). Configurar las variables `CORS_ORIGIN` (URL de Vercel) y `FIREBASE_SERVICE_ACCOUNT` en Render.

GHCR crea el paquete **privado** en el primer push: entrar a la org → Packages → backend → Package settings → Change visibility → Public (una sola vez; ya hecho). Si no, Render no puede descargar la imagen.

## Riesgos pendientes

Sin límite de peticiones (rate limit) en `POST /api/auth/registro` ni en la disponibilidad de username: permiten enumerar usernames y crear cuentas en masa. Pendiente para S2.

## Pasos manuales del equipo (Firebase real)

El código nunca toca el Firebase real; esto lo hace una persona del equipo con acceso:

1. Consola de Firebase → Authentication → Sign-in method: habilitar **Correo/contraseña** y **Google**.
2. Desplegar las reglas que niegan el acceso directo: `npx firebase deploy --only firestore:rules --project <id-del-proyecto-real>`.

## Estructura por capas

```
src/
  index.ts                 arranque
  app.ts                   express, cors, swagger, errores
  errors.ts                AppError (con campo opcional)
  validaciones.ts          reglas de username, nombre, correo y clave (copia del frontend)
  middleware/auth.ts       verifica el ID token (401)
  routes/                  rutas HTTP
  services/                lógica de negocio
  repositories/            acceso a datos (Firestore)
  config/firebase.ts       init perezoso de firebase-admin (Firestore y Auth)
  openapi.json             especificación Swagger
tests/                     vitest + supertest (users.test.ts usa emuladores)
firestore.rules, firebase.json   reglas (deny-all) y emuladores
scripts/seed.ts            datos iniciales
```
