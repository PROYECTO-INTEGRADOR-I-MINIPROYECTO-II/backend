import { RequestHandler, Router } from 'express';
import { AuthLocals, requireAuth } from '../middleware/auth';
import * as svc from '../services/users.service';

const router = Router();

// Pasa uid/token al handler, encamina los errores async a next() y responde 204 si no devuelve nada.
const privada =
  (fn: (a: AuthLocals, body: Record<string, unknown> | undefined) => Promise<unknown>): RequestHandler =>
  async (req, res, next) => {
    try {
      const out = await fn(res.locals as AuthLocals, req.body);
      if (out === undefined) res.status(204).end();
      else res.json(out);
    } catch (err) {
      next(err);
    }
  };

router.get('/usernames/:username/disponible', async (req, res, next) => {
  try {
    res.json(await svc.disponibilidad(req.params.username));
  } catch (err) {
    next(err);
  }
});

router.use('/usuarios', requireAuth);
router.get('/usuarios/yo', privada((a) => svc.getYo(a.uid, a.token)));
router.patch('/usuarios/yo', privada((a, b) => svc.actualizarYo(a.uid, b)));
router.put('/usuarios/yo/username', privada((a, b) => svc.ponerUsername(a.uid, a.token, b?.username)));
router.delete('/usuarios/yo', privada((a) => svc.eliminarYo(a.uid)));
router.delete('/usuarios/yo/proveedores/google', privada((a) => svc.desvincularGoogle(a.uid)));

export default router;
