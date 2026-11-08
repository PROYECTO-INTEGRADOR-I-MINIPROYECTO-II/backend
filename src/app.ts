import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import { AppError } from './errors';
import openapi from './openapi.json';
import baseRoutes from './routes/base.routes';
import usersRoutes from './routes/users.routes';

const app = express();

// Sin CORS_ORIGIN no se permite ningún origen externo (no se abre a '*').
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',').map((s) => s.trim()) ?? false }));
app.use(express.json({ limit: '200kb' }));
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi));
app.use('/api', baseRoutes);
app.use('/api', usersRoutes);

app.use((_req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', 'Ruta no encontrada.'));
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, campo: err.campo } });
    return;
  }
  const type = (err as { type?: string }).type;
  if (type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'INVALID_JSON', message: 'El cuerpo no es un JSON válido.' } });
    return;
  }
  if (type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'El cuerpo es demasiado grande.' } });
    return;
  }
  const status = (err as { status?: number }).status;
  if (type && status && status >= 400 && status < 500) {
    res.status(status).json({ error: { code: 'BAD_REQUEST', message: 'La petición no es válida.' } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Ocurrió un error inesperado' } });
});

export default app;
