import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../src/repositories/rooms.repository';
import * as svc from '../src/services/rooms.service';

vi.mock('../src/repositories/rooms.repository', () => ({
  crearSala: vi.fn(),
  listarSalas: vi.fn(),
  borrarSalasDePropietario: vi.fn(),
}));

const crearSalaRepo = vi.mocked(repo.crearSala);

describe('servicio de salas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it('limpia los campos y asigna el propietario autenticado', async () => {
    const sala = {
      id: 'sala-1',
      nombre: 'Estudio de cálculo',
      descripcion: 'Repaso',
      ownerUid: 'uid-1',
      creado: '2026-01-01T00:00:00.000Z',
    };
    crearSalaRepo.mockResolvedValue(sala);

    await expect(
      svc.crearSala('uid-1', { nombre: '  Estudio de cálculo ', descripcion: ' Repaso ', ownerUid: 'otro-uid' }),
    ).resolves.toEqual(sala);
    expect(crearSalaRepo).toHaveBeenCalledWith('uid-1', { nombre: 'Estudio de cálculo', descripcion: 'Repaso' });
  });

  it('rechaza nombre vacío y no escribe en Firestore', async () => {
    await expect(svc.crearSala('uid-1', { nombre: '   ' })).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      campo: 'nombre',
    });
    expect(crearSalaRepo).not.toHaveBeenCalled();
  });

  it('convierte errores de Firestore en DB_UNAVAILABLE', async () => {
    crearSalaRepo.mockRejectedValue(new Error('Firestore unavailable'));

    await expect(svc.crearSala('uid-1', { nombre: 'Estudio' })).rejects.toMatchObject({
      status: 503,
      code: 'DB_UNAVAILABLE',
    });
    expect(console.error).toHaveBeenCalledWith('Error en Firestore:', expect.any(Error));
  });
});
