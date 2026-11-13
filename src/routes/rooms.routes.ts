import { Router } from 'express';
import { AuthLocals, requireAuth } from '../middleware/auth';
import * as svc from '../services/rooms.service';

const router = Router();

router.use(requireAuth);

router.get('/salas', async (_req, res, next) => {
  try {
    const { uid } = res.locals as AuthLocals;
    res.json(await svc.listarSalas(uid));
  } catch (err) {
    next(err);
  }
});

router.post('/salas', async (req, res, next) => {
  try {
    const { uid } = res.locals as AuthLocals;
    res.status(201).json(await svc.crearSala(uid, req.body));
  } catch (err) {
    next(err);
  }
});

export default router;
