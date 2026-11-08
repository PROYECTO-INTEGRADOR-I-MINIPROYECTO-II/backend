// Reglas de validación de acceso y perfil. El servidor debe aplicar las mismas (la unicidad de username y correo solo la puede
// comprobar él). Cada función devuelve el mensaje de error, que explica cómo corregir, o undefined si el valor es válido.
// Cada tramo del dominio excluye el punto, así la expresión no tiene alternativas ambiguas (tiempo lineal, sin backtracking costoso).
export const CORREO = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
export const MIN_CLAVE = 8;
// Dos conceptos distintos (decisión del equipo, a partir de lo que exige el curso):
//  · Username: nombre de usuario ÚNICO de la cuenta (US-01, US-02, US-04). 3 a 20 caracteres, sin espacios; letras sin tilde, números,
//    punto y guion bajo, sin repetir el punto ni el guion bajo. No distingue mayúsculas al comparar. Todo username válido es también un
//    nombre válido: la cuenta nace con el nombre igual al username.
//  · Nombre para mostrar (nombres + apellidos): lo que ven los demás en las Salas. Puede repetirse (no hay comprobación de unicidad).
//    Sigue las reglas de nombre de Google: letras de cualquier idioma (con tildes y ñ), números, espacios entre palabras (uno solo y
//    nunca al inicio), punto, guion, guion bajo y apóstrofo sin repetirse; sin emojis, símbolos decorativos, «<» ni «>»; hasta 60
//    caracteres entre nombres y apellidos.
// En ambos se bloquean los términos que simulan ser oficiales. Fuera de alcance (decisión del equipo): lenguaje ofensivo y
// suplantación de personas o marcas.
export type TipoAnalisis = 'vacio' | 'invalido' | 'corto' | 'ok';
export interface Analisis {
  tipo: TipoAnalisis;
  mensaje?: string;
}

const PALABRAS_RESERVADAS = ['admin', 'soporte', 'google', 'verificado', 'synk'];
const MENSAJE_RESERVADAS = 'No se pueden usar términos que simulan ser oficiales (como Admin, Soporte, Google, Verificado o Synk).';
const sinTildes = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const usaReservada = (v: string) =>
  sinTildes(v)
    .split(/[ ._'’-]+/)
    .filter(Boolean)
    .some((p) => PALABRAS_RESERVADAS.some((r) => p.startsWith(r)));
const esEmojiOSimbolo = (c: string) => /\p{Extended_Pictographic}|\p{S}/u.test(c);

// ---- Username (identificador único) ----
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

/** Forma canónica para comparar unicidad: sin mayúsculas ni espacios sobrantes. El servidor debe aplicar lo mismo. */
export const normalizarUsername = (v: string) => v.trim().toLowerCase();

/** Qué le pasa al username ahora mismo, con el mensaje que explica cómo corregirlo (sirve para validar mientras se escribe). */
export function analizarUsername(v: string): Analisis {
  if (!v) return { tipo: 'vacio' };
  const raro = [...v].find((c) => !/[A-Za-z0-9._]/.test(c));
  if (raro !== undefined) {
    if (raro === ' ') return { tipo: 'invalido', mensaje: 'Los espacios no están permitidos. Usa punto o guion bajo para separar.' };
    if (/[áéíóúüñÁÉÍÓÚÜÑ]/.test(raro)) return { tipo: 'invalido', mensaje: `«${raro}» no se puede usar: nada de tildes ni «ñ». Usa letras sin tilde.` };
    if (esEmojiOSimbolo(raro)) return { tipo: 'invalido', mensaje: 'No se permiten emojis ni símbolos.' };
    return { tipo: 'invalido', mensaje: `«${raro}» no está permitido. Usa letras, números, punto o guion bajo.` };
  }
  if (/[._]{2,}/.test(v)) return { tipo: 'invalido', mensaje: 'No repitas el punto ni el guion bajo (como «..» o «__»).' };
  const largo = v.length;
  if (largo > USERNAME_MAX) return { tipo: 'invalido', mensaje: `Máximo ${USERNAME_MAX} caracteres (llevas ${largo}).` };
  if (usaReservada(v)) return { tipo: 'invalido', mensaje: MENSAJE_RESERVADAS };
  if (largo < USERNAME_MIN) return { tipo: 'corto', mensaje: `Escribe al menos ${USERNAME_MIN} caracteres.` };
  return { tipo: 'ok' };
}

export const validarUsername = (v: string): string | undefined => {
  const u = v.trim();
  if (!u) return 'Escribe tu username.';
  return analizarUsername(u).mensaje;
};

/** Propone un username a partir del nombre (p. ej. el de la cuenta de Google): «Juan Carlos» + «Pérez Gómez» → «juan.perez». */
export function sugerirUsername(nombres: string, apellidos: string): string {
  const primero = (t: string) => sinTildes(t.trim().split(/\s+/)[0] ?? '').replace(/[^a-z0-9]/g, '');
  const base = [primero(nombres), primero(apellidos)].filter(Boolean).join('.').slice(0, USERNAME_MAX);
  return analizarUsername(base).tipo === 'ok' ? base : 'usuario';
}

// ---- Nombre para mostrar (nombres y apellidos) ----
export const NOMBRE_MAX_TOTAL = 60;

/** Nombre completo tal como lo ven los demás. */
export const nombreCompleto = (nombres: string, apellidos: string) => [nombres.trim(), apellidos.trim()].filter(Boolean).join(' ');

/** Iniciales para el avatar sin foto: primera letra del nombre y del apellido (una o dos). */
export const iniciales = (nombres: string, apellidos: string) =>
  [nombres, apellidos]
    .map((t) => [...t.trim()][0] ?? '')
    .join('')
    .toLocaleUpperCase('es');

// Quita los espacios del final con un recorrido simple (una expresión como / +$/ es de tiempo cuadrático con muchos espacios).
const sinEspaciosFinales = (s: string) => {
  let fin = s.length;
  while (fin > 0 && s[fin - 1] === ' ') fin--;
  return s.slice(0, fin);
};

/**
 * Qué le pasa a un campo del nombre (nombres o apellidos). `disponibles` = cuántos caracteres le quedan según lo que ya ocupa el otro
 * campo (el total entre ambos es NOMBRE_MAX_TOTAL). Un espacio al final se tolera: se está escribiendo la siguiente palabra.
 */
export function analizarNombre(crudo: string, disponibles = NOMBRE_MAX_TOTAL): Analisis {
  if (!crudo) return { tipo: 'vacio' };
  if (crudo[0] === ' ') return { tipo: 'invalido', mensaje: 'No puede empezar con un espacio.' };
  const v = sinEspaciosFinales(crudo);
  const raro = [...v].find((c) => !/[\p{L}\p{M}\p{N} ._'’-]/u.test(c));
  if (raro !== undefined) {
    if (raro === '<' || raro === '>') return { tipo: 'invalido', mensaje: 'Los caracteres «<» y «>» no están permitidos.' };
    if (esEmojiOSimbolo(raro)) return { tipo: 'invalido', mensaje: 'No se permiten emojis ni símbolos decorativos.' };
    return { tipo: 'invalido', mensaje: `«${raro}» no está permitido. Usa letras, números, espacios, punto, guion, guion bajo o apóstrofo.` };
  }
  if (/ {2,}/.test(v)) return { tipo: 'invalido', mensaje: 'Usa un solo espacio entre palabras.' };
  if (/[._'’-]{2,}/.test(v)) return { tipo: 'invalido', mensaje: 'No repitas signos de puntuación (como «..» o «--»).' };
  const largo = [...v].length;
  if (largo > disponibles) {
    return { tipo: 'invalido', mensaje: `Entre nombres y apellidos caben ${NOMBRE_MAX_TOTAL} caracteres (te pasas por ${largo - disponibles}).` };
  }
  if (usaReservada(v)) return { tipo: 'invalido', mensaje: MENSAJE_RESERVADAS };
  return { tipo: 'ok' };
}

export const validarCorreo = (v: string): string | undefined => {
  const c = v.trim();
  if (!c) return 'Escribe tu correo.';
  if (!CORREO.test(c)) return 'Escribe un correo con formato nombre@dominio.com.';
};

/** `nueva`: al crear o cambiar la contraseña se exige la longitud mínima; al iniciar sesión solo que no esté vacía. */
export const validarClave = (v: string, nueva: boolean): string | undefined => {
  if (!v) return 'Escribe tu contraseña.';
  if (nueva && v.length < MIN_CLAVE) return `Usa al menos ${MIN_CLAVE} caracteres.`;
};

export const validarConfirmacion = (v: string, clave: string): string | undefined => {
  if (!v) return 'Repite tu contraseña.';
  if (v !== clave) return 'Las contraseñas no coinciden.';
};

// ---- Solo servidor ----
/** Foto: null (iniciales), URL https sin espacios, comillas ni «<» «>», o data URL png/jpeg/webp en base64 de hasta 100 000 caracteres. */
export const fotoValida = (v: unknown): v is string | null =>
  v === null ||
  (typeof v === 'string' &&
    (/^https:\/\/[^\s"'<>]+$/.test(v) || (v.length <= 100_000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(v))));
