import http from 'node:http';
import { desconectarUsuario, iniciarTiempoReal } from './realtime';

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
    const token = process.env.INTERNO_TOKEN;
    if (!token || req.headers['x-interno'] !== token) return json(res, 401, { error: 'No autorizado' });
    desconectarUsuario(decodeURIComponent(m[1]));
    res.writeHead(204).end();
  });
  iniciarTiempoReal(server);
  return server;
}

if (require.main === module) {
  const port = process.env.PORT || 3001;
  crearServidorTiempoReal().listen(port, () => console.log(`Tiempo real escuchando en el puerto ${port}`));
}
