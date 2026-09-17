import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TaskItem } from '../nucleo/contrato.js';
import { homologarPendientes, idsDelGrupo } from './homologar.js';

function correo(
  id: string,
  cuenta: string,
  fecha: string,
  titulo = 'Se requiere una acción para mantener su suscripción Personal Plan / Monthly'
): TaskItem {
  return {
    id,
    title: titulo,
    description: 'De: EmailJS (via Paddle.com) <help@paddle.com>\nPara: yo',
    status: 'pendiente',
    priority: 'urgente',
    accountId: cuenta,
    origin: 'correo',
    tags: [],
    updatedAt: fecha
  };
}

describe('homologar pendientes de correo', () => {
  it('el mismo correo en dos buzones se sirve una vez, con la otra cuenta en alsoIn', () => {
    const r = homologarPendientes({
      'correo-nexus': [correo('n1', 'correo-nexus', '2026-09-02T00:17:10Z')],
      'correo-itech': [correo('i1', 'correo-itech', '2026-09-02T00:17:10Z')]
    });
    assert.deepEqual(
      r['correo-itech']?.map((t) => t.id),
      ['i1']
    );
    assert.deepEqual(r['correo-itech']?.[0]?.alsoIn, ['correo-nexus']);
    assert.deepEqual(r['correo-nexus'], []);
  });

  it('de los avisos repetidos del mismo remitente solo queda el mas reciente', () => {
    const r = homologarPendientes({
      'correo-nexus': [
        correo('viejo', 'correo-nexus', '2026-08-02T00:00:00Z'),
        correo('nuevo', 'correo-nexus', '2026-09-02T00:00:00Z'),
        correo(
          'otro',
          'correo-nexus',
          '2026-09-05T00:00:00Z',
          'Tu plan PilloFon vence hoy'
        )
      ]
    });
    assert.deepEqual(
      r['correo-nexus']?.map((t) => t.id),
      ['nuevo', 'otro']
    );
    assert.equal(r['correo-nexus']?.[0]?.alsoIn, undefined);
  });

  it('los ids del grupo cubren todas las copias, para anotar de una vez', () => {
    const todos = [
      correo('n1', 'correo-nexus', '2026-09-02T00:00:00Z'),
      correo('i1', 'correo-itech', '2026-09-02T00:00:00Z'),
      correo('viejo', 'correo-nexus', '2026-08-02T00:00:00Z'),
      correo('otro', 'correo-nexus', '2026-09-05T00:00:00Z', 'Otra cosa')
    ];
    assert.deepEqual(idsDelGrupo('n1', todos).sort(), ['i1', 'n1', 'viejo']);
    assert.deepEqual(idsDelGrupo('otro', todos), ['otro']);
    assert.deepEqual(idsDelGrupo('x', todos), ['x']);
  });
});
