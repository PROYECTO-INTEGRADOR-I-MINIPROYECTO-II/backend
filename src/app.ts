import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import { AppError } from './errors';
import openapi from './openapi.json';
import baseRoutes from './routes/base.routes';

const app = express();

// Sin CORS_ORIGIN no se permite ningún origen externo (no se abre a '*').
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',').map((s) => s.trim()) ?? false }));
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi));
app.use('/api', baseRoutes);

app.use((_req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', 'Ruta no encontrada.'));
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Ocurrió un error inesperado' } });
});

export default app;
