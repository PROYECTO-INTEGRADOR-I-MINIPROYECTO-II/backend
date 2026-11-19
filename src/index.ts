import app from './app';
import { iniciarTiempoReal } from './realtime';

const port = process.env.PORT || 3000;
const server = app.listen(port, () => console.log(`API escuchando en el puerto ${port}`));
iniciarTiempoReal(server);
