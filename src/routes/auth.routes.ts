import { Router } from 'express';
import { registrar } from '../services/auth.service';

const router = Router();

router.post('/auth/registro', async (req, res, next) => {
  try {
    res.status(201).json(await registrar(req.body));
  } catch (err) {
    next(err);
  }
});

export default router;
