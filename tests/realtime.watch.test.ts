import type http from 'node:http';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { iniciarTiempoReal } from '../src/realtime';
import { getSala, observarSala, type Sala } from '../src/repositories/rooms.repository';

vi.mock('../src/repositories/rooms.repository', () => ({ getSala: vi.fn(), observarSala: vi.fn(), guardarMensaje: vi.fn() }));
vi.mock('../src/services/rooms.service', () => ({
  historial: vi.fn(async () => ({ mensajes: [], hayMas: false, siguiente: 'cursor-rest' })),
  rolEnSala: (sala: Sala, uid: string) => sala.uid === uid ? 'anfitrion' : 'participante',
}));
vi.mock('socket.io', () => ({
  Server: class extends EventEmitter {
    adapter = Object.assign(new EventEmitter(), { rooms: new Map<string, Set<string>>() });
    enviados = vi.fn();
    sockets = new Set<SocketFalso>();
    of() { return { adapter: this.adapter }; }
    use() {}
    to(grupo: string) { return { emit: (evento: string, payload: unknown) => this.enviados(grupo, evento, payload) }; }
    in(grupo: string) {
      return {
        fetchSockets: async () => [...this.sockets].filter((s) => s.rooms.has(grupo)),
        socketsLeave: () => [...this.sockets].forEach((s) => s.leave(grupo)),
      };
    }
  },
}));

type ServidorFalso = EventEmitter & {
  adapter: EventEmitter & { rooms: Map<string, Set<string>> };
  enviados: ReturnType<typeof vi.fn>;
  sockets: Set<SocketFalso>;
};
class SocketFalso extends EventEmitter {
  data = { uid: 'ana', username: 'ana', nombre: 'Ana', foto: null };
  rooms = new Set<string>();
  disconnected = false;
  constructor(readonly id: string, private servidor: ServidorFalso, uid = 'ana') {
    super();
    this.data.uid = uid;
    servidor.sockets.add(this);
    servidor.emit('connection', this);
  }
  async join(grupo: string) {
    this.rooms.add(grupo);
    const miembros = this.servidor.adapter.rooms.get(grupo) ?? new Set<string>();
    miembros.add(this.id);
    this.servidor.adapter.rooms.set(grupo, miembros);
  }
  async leave(grupo: string) {
    this.rooms.delete(grupo);
    const miembros = this.servidor.adapter.rooms.get(grupo);
    miembros?.delete(this.id);
    this.servidor.adapter.emit('leave-room', grupo, this.id);
    if (miembros?.size === 0) {
      this.servidor.adapter.rooms.delete(grupo);
      this.servidor.adapter.emit('delete-room', grupo);
    }
  }
  async enviar(evento: string, payload: unknown) {
    const ack = vi.fn();
    await this.listeners(evento)[0](payload, ack);
    return ack.mock.calls[0]?.[0];
  }
}

const sala: Sala = { id: 'sala1', uid: 'ana', nombre: 'Estudio', descripcion: '', creado: '2026-01-01' };
type Watch = { cambio: (actual: Sala | null) => void; error: (err: Error) => void; cancelar: ReturnType<typeof vi.fn> };

describe('recuperación de la observación de salas', () => {
  let servidor: ServidorFalso;
  let ana: SocketFalso;
  let watches: Watch[];
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    watches = [];
    vi.mocked(getSala).mockResolvedValue(sala);
    vi.mocked(observarSala).mockImplementation((_id, cambio, error) => {
      const watch = { cambio, error, cancelar: vi.fn() };
      watches.push(watch);
      return watch.cancelar;
    });
    servidor = iniciarTiempoReal({} as http.Server) as unknown as ServidorFalso;
    ana = new SocketFalso('ana1', servidor);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  const fallo = (watch: Watch) => watch.error(new Error('Firestore no disponible'));
  const unirse = (socket: SocketFalso) => socket.enviar('sala:unirse', { id: sala.id });

  it('comparte una observación y un reintento, conserva el ack y recupera cambios y eliminación', async () => {
    expect(await unirse(ana)).toEqual({ sala, rol: 'anfitrion', mensajes: [], hayMas: false });
    const bea = new SocketFalso('bea1', servidor, 'bea');
    expect((await unirse(bea)).rol).toBe('participante');
    expect(watches).toHaveLength(1);
    fallo(watches[0]);
    fallo(watches[0]);
    await unirse(bea);
    expect(watches).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
    expect(watches[0].cancelar).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(999);
    expect(watches).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(watches).toHaveLength(2);
    servidor.enviados.mockClear();
    watches[0].cambio(null);
    expect(ana.rooms.has('sala:sala1')).toBe(true);
    expect(servidor.enviados).not.toHaveBeenCalled();
    const actualizada = { ...sala, nombre: 'Nuevo nombre' };
    watches[1].cambio(actualizada);
    expect(servidor.enviados).toHaveBeenCalledWith('sala:sala1', 'sala:actualizada', { sala: actualizada });
    watches[1].cambio(null);
    expect(servidor.enviados).toHaveBeenCalledWith('sala:sala1', 'sala:eliminada', { salaId: sala.id });
    expect(ana.rooms.size).toBe(0);
    expect(bea.rooms.size).toBe(0);
    expect(watches[1].cancelar).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('duplica la espera hasta 30 segundos y la reinicia tras un snapshot sano', async () => {
    await unirse(ana);
    for (const espera of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
      const cantidad = watches.length;
      fallo(watches.at(-1)!);
      await vi.advanceTimersByTimeAsync(espera - 1);
      expect(watches).toHaveLength(cantidad);
      await vi.advanceTimersByTimeAsync(1);
      expect(watches).toHaveLength(cantidad + 1);
    }
    watches.at(-1)!.cambio(sala);
    fallo(watches.at(-1)!);
    const cantidad = watches.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(watches).toHaveLength(cantidad + 1);
  });

  it('cancela el reintento al salir el último socket e ignora callbacks de una ocupación anterior', async () => {
    await unirse(ana);
    const anterior = watches[0];
    fallo(anterior);
    expect(await ana.enviar('sala:salir', { id: sala.id })).toEqual({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(30000);
    expect(watches).toHaveLength(1);
    await unirse(ana);
    expect(watches).toHaveLength(2);
    servidor.enviados.mockClear();
    anterior.cambio(null);
    fallo(anterior);
    expect(servidor.enviados).not.toHaveBeenCalled();
    expect(ana.rooms.has('sala:sala1')).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await ana.leave('sala:sala1');
    expect(watches[1].cancelar).toHaveBeenCalledOnce();
    watches[1].cambio({ ...sala, nombre: 'Tardío' });
    fallo(watches[1]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reintenta si la creación del listener falla sincrónicamente', async () => {
    vi.mocked(observarSala).mockImplementationOnce(() => { throw new Error('Sin conexión'); });
    await unirse(ana);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(watches).toHaveLength(1);
  });
});
