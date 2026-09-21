import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Person, TaskItem, TaskStatus } from '../models';
import { teamWorkload } from './portal.selectors';

const AHORA = new Date('2026-09-21T18:00:00Z');

const persona = (id: string, name = id): Person => ({ id, name });

const tarea = (
  id: string,
  extra: Partial<TaskItem> & { status?: TaskStatus } = {}
): TaskItem => ({
  id,
  title: extra.title ?? id,
  status: extra.status ?? 'pendiente',
  priority: extra.priority ?? 'media',
  accountId: 'mios',
  origin: 'local',
  tags: extra.tags ?? [],
  updatedAt: extra.updatedAt ?? AHORA.toISOString(),
  ...extra
});

describe('teamWorkload', () => {
  it('cuenta solo los no hechos a su nombre y apunta el más antiguo por updatedAt', () => {
    const efren = persona('efren', 'Efrén');
    const marco = persona('marco', 'Marco');
    const cargas = teamWorkload(
      [
        tarea('viejo', {
          assignee: efren,
          title: 'Alta de Vanguardia',
          updatedAt: '2026-08-01T12:00:00.000Z'
        }),
        tarea('nuevo', {
          assignee: efren,
          title: 'Corte de facturas',
          updatedAt: '2026-09-20T12:00:00.000Z'
        }),
        tarea('hecho', {
          assignee: efren,
          status: 'hecho',
          updatedAt: '2026-07-01T12:00:00.000Z'
        }),
        tarea('de-marco', {
          assignee: marco,
          title: 'Demo Birdom',
          updatedAt: '2026-09-10T12:00:00.000Z'
        })
      ],
      AHORA
    );
    const deEfren = cargas.find((c) => c.person.id === 'efren');
    const deMarco = cargas.find((c) => c.person.id === 'marco');
    assert.equal(deEfren?.open, 2);
    assert.equal(deEfren?.oldestOpen?.id, 'viejo');
    assert.equal(deEfren?.oldestOpen?.title, 'Alta de Vanguardia');
    assert.equal(deEfren?.oldestOpen?.updatedAt, '2026-08-01T12:00:00.000Z');
    assert.equal(deMarco?.open, 1);
    assert.equal(deMarco?.oldestOpen?.id, 'de-marco');
  });

  it('quien solo da seguimiento no cuenta como asignado ni tiene más antiguo', () => {
    const efren = persona('efren', 'Efrén');
    const marco = persona('marco', 'Marco');
    const cargas = teamWorkload(
      [
        tarea('seguido', {
          assignee: efren,
          followers: [marco],
          updatedAt: '2026-08-01T12:00:00.000Z'
        })
      ],
      AHORA
    );
    const deMarco = cargas.find((c) => c.person.id === 'marco');
    assert.equal(deMarco?.open, 0);
    assert.equal(deMarco?.following, 1);
    assert.equal(deMarco?.oldestOpen, undefined);
  });

  it('sin asignados no inventa renglones', () => {
    assert.deepEqual(
      teamWorkload([tarea('solo', { status: 'pendiente' })], AHORA),
      []
    );
  });
});
