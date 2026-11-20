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
| PATCH | `/api/usuarios/yo` | `{ nombres, apellidos, foto, correo }` (cualquiera); `409 PROFILE_INCOMPLETE` si aún no tiene username. Cambiar `correo` exige sesión de menos de 5 min (`401 REAUTH_REQUIRED`) y falla con `409 EMAIL_TAKEN` si ya existe. Tras cambiarlo, Firebase invalida los ID tokens anteriores: el cliente debe pedir uno nuevo (`getIdToken(true)`) o volver a iniciar sesión |
| PUT | `/api/usuarios/yo/username` | `{ username }`: crea el perfil o cambia el username (libera el anterior); `409 USERNAME_TAKEN` |
| DELETE | `/api/usuarios/yo` | Elimina la cuenta (`204`) |
| DELETE | `/api/usuarios/yo/proveedores/google` | Desvincula Google (`204`); `409 LAST_PROVIDER` si no tiene contraseña |
| POST | `/api/salas` | Crea una sala privada `{ nombre, descripcion? }` (`201`); el servidor asigna el ID y propietario |
| GET | `/api/salas` | Lista las salas privadas creadas por la sesión (`{ salas }`) |

Las rutas `/api/usuarios/**` exigen `Authorization: Bearer <ID token de Firebase>`; sin token, inválido, vencido o revocado: `401 UNAUTHENTICATED`. El login lo hace Firebase en el cliente; `GET /api/usuarios/yo` sirve para comprobar la sesión.

Errores: `{ "error": { "code", "message", "campo"? } }` (`campo` indica el campo del formulario). Siempre JSON; un cuerpo mal formado da `400 INVALID_JSON`.

### Datos y eliminación de cuenta

`users/{uid}` y `usernames/{username en minúsculas}` se escriben siempre en la misma transacción. `firestore.rules` niega todo acceso directo: solo el backend lee/escribe.

Política al eliminar la cuenta (sin datos huérfanos):

1. Las salas que el usuario creó se borran completas, junto con su subcolección `messages`.
2. Sus mensajes en salas de otras personas se conservan anonimizados: `uid: null` y `autor: 'Usuario eliminado'`.
3. Se borran `users/{uid}`, `usernames/{username}` (el username queda libre) y el usuario de Firebase Auth.

El orden es revocar sesiones y cortar sockets → borrar salas → anonimizar → borrar perfil → borrar Auth; cada paso es idempotente, así que si falla a mitad basta reintentar. La anonimización consulta `messages` como collection group por `uid`, lo que requiere el índice de `firestore.indexes.json`.

## Tiempo real (Socket.io)

Servicio aparte de la API (ver más abajo), con su propio puerto. El cliente se conecta con su ID token de Firebase:

```js
const socket = io(API_URL, { auth: { token } });
```

Si el token falta o es inválido, o el usuario aún no tiene username, el handshake falla: `connect_error` con `err.data = { code, message }` (`UNAUTHENTICATED`, `PROFILE_INCOMPLETE`, `AUTH_UNAVAILABLE`). Los handlers responden por ack `{ ... }` o `{ error: { code, message, campo? } }`.

| Dirección | Evento | Payload | Respuesta / errores |
|---|---|---|---|
| cliente → servidor | `sala:unirse` | `{ id }` | ack `{ sala }`; `VALIDATION_ERROR` (campo `id`), `NOT_FOUND`, `DB_UNAVAILABLE` |
| cliente → servidor | `sala:salir` | `{ id }` | ack `{ ok: true }` |
| cliente → servidor | `mensaje:enviar` | `{ salaId, texto }` (1-1000 caracteres, recortado) | ack `{ mensaje }`; `FORBIDDEN` (no unido), `VALIDATION_ERROR` (campo `texto`), `DB_UNAVAILABLE` |
| servidor → cliente | `mensaje:nuevo` | `{ id, salaId, uid, autor, texto, creado }` | a toda la sala (incluye al emisor) |
| servidor → cliente | `sala:presencia` | `{ salaId, usuarios: [{ uid, username }] }` | al unirse, salir o desconectarse alguien |

Los mensajes se guardan en `rooms/{salaId}/messages`.

```mermaid
erDiagram
  users ||--|| usernames : "username en minúsculas"
  users ||--o{ rooms : "crea (uid)"
  rooms ||--o{ messages : contiene
  users ||--o{ messages : "escribe (uid)"
  users { string uid PK "doc id"; string username; string nombres; string apellidos; string foto; string correo; string creado }
  usernames { string username PK "doc id"; string uid }
  rooms { string id PK; string nombre; string descripcion; string uid; string creado }
  messages { string id PK; string uid; string autor "username"; string texto; string creado "ISO" }
```

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
3. Desplegar el índice de collection group `messages.uid` (necesario para anonimizar mensajes al eliminar una cuenta): `npx firebase deploy --only firestore:indexes --project synk-mp2`.

## Servicios: API y tiempo real

Son dos procesos de la misma imagen: la API (`node dist/index.js`) y el tiempo real (`node dist/tiempo-real.js`, socket.io).

- Render: segundo web service con la misma imagen y Docker command `node dist/tiempo-real.js`. Variables: `FIREBASE_SERVICE_ACCOUNT`, `CORS_ORIGIN`, `INTERNO_TOKEN`. En la API, además: `REALTIME_URL` (URL del tiempo real) e `INTERNO_TOKEN` (el mismo valor). El deploy usa el secret `RENDER_DEPLOY_HOOK_RT` (opcional).
- Local: `npm run dev` (API, 3000) y `npm run dev:rt` (tiempo real, 3001). El socket del frontend apunta a la URL del tiempo real.

## Estructura por capas

```
src/
  index.ts                 arranque de la API
  tiempo-real.ts           arranque del servicio de tiempo real
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
