import { describe, expect, it } from 'vitest';
import {
  analizarNombre, analizarUsername, fotoValida, iniciales, nombreCompleto, normalizarUsername,
  sugerirUsername, validarClave, validarConfirmacion, validarCorreo, validarUsername,
} from '../src/validaciones';

describe('validaciones', () => {
  it.each([
    ['', 'vacio', undefined],
    ['a b', 'invalido', /espacios/],
    ['ñandu', 'invalido', /tildes/],
    ['ana😀', 'invalido', /emojis/],
    ['ana!', 'invalido', /no está permitido/],
    ['an..a', 'invalido', /No repitas/],
    ['a'.repeat(21), 'invalido', /Máximo 20/],
    ['admin1', 'invalido', /oficiales/],
    ['ab', 'corto', /al menos 3/],
    ['ana.p_1', 'ok', undefined],
  ])('analizarUsername(%j) -> %s', (v, tipo, msg) => {
    const r = analizarUsername(v);
    expect(r.tipo).toBe(tipo);
    if (msg) expect(r.mensaje).toMatch(msg);
  });

  it('validarUsername y normalizarUsername', () => {
    expect(validarUsername('  ')).toMatch(/Escribe/);
    expect(validarUsername('ab')).toMatch(/al menos/);
    expect(validarUsername(' Ana ')).toBeUndefined();
    expect(normalizarUsername(' ANA ')).toBe('ana');
  });

  it.each([
    ['Juan Carlos', 'Pérez Gómez', 'juan.perez'],
    ['', '', 'usuario'],
    ['Zoë', '', 'zoe'],
  ])('sugerirUsername(%j, %j) -> %s', (n, a, esperado) => expect(sugerirUsername(n, a)).toBe(esperado));

  it.each([
    ['', 'vacio', undefined, 60],
    [' Ana', 'invalido', /empezar con un espacio/, 60],
    ['A<b', 'invalido', /«<»/, 60],
    ['Ana😀', 'invalido', /emojis/, 60],
    ['Ana#', 'invalido', /no está permitido/, 60],
    ['Ana  Paz', 'invalido', /un solo espacio/, 60],
    ['Ana--Paz', 'invalido', /signos/, 60],
    ['Ana María', 'invalido', /te pasas por 5/, 4],
    ['Soporte', 'invalido', /oficiales/, 60],
    ["O'Neil Ñu ", 'ok', undefined, 60],
  ])('analizarNombre(%j) -> %s', (v, tipo, msg, max) => {
    const r = analizarNombre(v, max);
    expect(r.tipo).toBe(tipo);
    if (msg) expect(r.mensaje).toMatch(msg);
  });

  it('correo, clave y confirmación', () => {
    expect(validarCorreo(' ')).toMatch(/Escribe/);
    expect(validarCorreo('x@y')).toMatch(/formato/);
    expect(validarCorreo('a@b.com')).toBeUndefined();
    expect(validarClave('', false)).toMatch(/Escribe/);
    expect(validarClave('corta', true)).toMatch(/8/);
    expect(validarClave('corta', false)).toBeUndefined();
    expect(validarConfirmacion('', 'x')).toMatch(/Repite/);
    expect(validarConfirmacion('y', 'x')).toMatch(/no coinciden/);
    expect(validarConfirmacion('x', 'x')).toBeUndefined();
  });

  it('nombreCompleto e iniciales', () => {
    expect(nombreCompleto(' Ana ', ' Paz ')).toBe('Ana Paz');
    expect(nombreCompleto('Ana', '')).toBe('Ana');
    expect(iniciales('ana', 'paz')).toBe('AP');
  });

  it.each([
    [null, true],
    ['https://example.com/a.png', true],
    ['http://example.com/a.png', false],
    ['https://a b', false],
    ['data:image/png;base64,iVBORw0KGgo=', true],
    ['data:image/gif;base64,R0lGOD', false],
    [`data:image/png;base64,${'A'.repeat(100_000)}`, false],
    [42, false],
  ])('fotoValida(%j) -> %s', (v, ok) => expect(fotoValida(v)).toBe(ok));
});
