import { getDb } from '../src/config/firebase';

getDb()
  .collection('base')
  .doc('info')
  .set({ mensaje: 'Hola desde Firestore 👋' })
  .then(() => console.log('base/info escrito'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
