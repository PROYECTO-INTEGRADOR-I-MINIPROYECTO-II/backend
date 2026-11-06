import { Router } from 'express';
import { getBase } from '../services/base.service';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

router.get('/base', async (_req, res, next) => {
  try {
    res.json(await getBase());
  } catch (err) {
    next(err);
  }
});

export default router;
