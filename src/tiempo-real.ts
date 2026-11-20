import { timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import { desconectarUsuario, iniciarTiempoReal } from './realtime';

const tokenValido = (recibido: unknown) => {
  const esperado = process.env.INTERNO_TOKEN;
  if (!esperado || typeof recibido !== 'string') return false;
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
};

const json = (res: http.ServerResponse, status: number, cuerpo: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(cuerpo));
};

// Servidor del servicio de tiempo real: salud, endpoint interno para la API y socket.io.
export function crearServidorTiempoReal() {
  const server = http.createServer((req, res) => {
    const { method } = req;
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (method === 'GET' && pathname === '/api/health') return json(res, 200, { status: 'ok' });
    const m = method === 'POST' && pathname.match(/^\/interno\/desconectar\/([^/]+)$/);
    if (!m) return json(res, 404, { error: 'No encontrado' });
    if (!tokenValido(req.headers['x-interno'])) return json(res, 401, { error: 'No autorizado' });
    let uid: string;
    try {
      uid = decodeURIComponent(m[1]);
    } catch {
      return json(res, 400, { error: 'uid inválido' });
    }
    desconectarUsuario(uid);
    res.writeHead(204).end();
  });
  iniciarTiempoReal(server);
  return server;
}

if (require.main === module) {
  const port = process.env.PORT || 3001;
  crearServidorTiempoReal().listen(port, () => console.log(`Tiempo real escuchando en el puerto ${port}`));
}
