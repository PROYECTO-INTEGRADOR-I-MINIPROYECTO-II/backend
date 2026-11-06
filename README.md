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

Errores: `{ "error": { "code", "message" } }`.

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
| `FIREBASE_SERVICE_ACCOUNT` | JSON de la service account en base64: `base64 -w0 service-account.json` |

## Seed

Escribe `base/info` en Firestore (usa la misma variable de entorno):

```bash
export FIREBASE_SERVICE_ACCOUNT=$(base64 -w0 service-account.json)
npm run seed
```

## Tests

```bash
npm test          # vitest + cobertura (coverage/lcov.info)
npm run typecheck
```

## CI/CD

- `ci.yml` (PR y push a main): typecheck, tests, SonarCloud y `docker build`.
- `deploy.yml` (tras CI exitoso en main): publica `ghcr.io/<owner>/backend:<sha>` y `:latest`, y llama al deploy hook de Render.

Secrets del repo: `SONAR_TOKEN`, `RENDER_DEPLOY_HOOK` (la URL del hook de Render, que ya incluye `?key=...`).

Render: Web Service con "Existing image" desde `ghcr.io/proyecto-integrador-i-miniproyecto-ii/backend:latest` (paquete GHCR público). Configurar las variables `CORS_ORIGIN` (URL de Vercel) y `FIREBASE_SERVICE_ACCOUNT` en Render.

GHCR crea el paquete **privado** en el primer push: entrar a la org → Packages → backend → Package settings → Change visibility → Public (una sola vez; ya hecho). Si no, Render no puede descargar la imagen.

## Estructura por capas

```
src/
  index.ts                 arranque
  app.ts                   express, cors, swagger, errores
  errors.ts                AppError
  routes/                  rutas HTTP
  services/                lógica de negocio
  repositories/            acceso a datos (Firestore)
  config/firebase.ts       init perezoso de firebase-admin
  openapi.json             especificación Swagger
tests/                     vitest + supertest
scripts/seed.ts            datos iniciales
```
