import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TaskItem } from '../nucleo/contrato.js';
import {
  filtrarNuevosSinRepetir,
  homologarLista,
  homologarPendientes,
  idsDelGrupo,
  reusarIdsPorContenido
} from './homologar.js';

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

function propio(id: string, extra: Partial<TaskItem> = {}): TaskItem {
  return {
    id,
    title: 'Confirmar monto de comisión Región Occidente',
    description:
      'Carlos lo va a preguntar. Hay dos montos distintos para la facturación.',
    status: 'pendiente',
    priority: 'alta',
    dueDate: '2026-10-13T00:00:00.000Z',
    accountId: extra.accountId ?? 'ops',
    origin: extra.origin ?? 'ops',
    company: 'NexusQTech',
    tags: [],
    updatedAt: extra.updatedAt ?? '2026-10-13T12:00:00.000Z',
    ...extra
  };
}

describe('homologar pendientes de ops y propios', () => {
  it('dos envios del mismo pendiente con id distinto quedan en uno', () => {
    const lista = homologarLista([
      propio('bot-1', { updatedAt: '2026-10-13T10:00:00.000Z' }),
      propio('bot-2', { updatedAt: '2026-10-13T12:00:00.000Z' })
    ]);
    assert.deepEqual(
      lista.map((t) => t.id),
      ['bot-2']
    );
  });

  it('si uno ya esta hecho se enseña el que sigue abierto', () => {
    const lista = homologarLista([
      propio('viejo', {
        status: 'hecho',
        updatedAt: '2026-10-14T10:00:00.000Z'
      }),
      propio('abierto', { updatedAt: '2026-10-13T10:00:00.000Z' })
    ]);
    assert.deepEqual(
      lista.map((t) => t.id),
      ['abierto']
    );
  });

  it('el mismo titulo en ops y en propios se sirve una vez', () => {
    const lista = homologarLista([
      propio('ops-1', { origin: 'ops', accountId: 'ops' }),
      propio('local-1', { origin: 'local', accountId: 'mios' })
    ]);
    assert.equal(lista.length, 1);
  });

  it('titulos distintos no se juntan', () => {
    const lista = homologarLista([
      propio('a'),
      propio('b', { title: 'Revisar la ficha de Total Dealer' })
    ]);
    assert.deepEqual(lista.map((t) => t.id).sort(), ['a', 'b']);
  });

  it('idsDelGrupo cubre las copias de ops para anotar de una vez', () => {
    const todos = [
      propio('bot-1'),
      propio('bot-2'),
      propio('otro', { title: 'Otra' })
    ];
    assert.deepEqual(idsDelGrupo('bot-1', todos).sort(), ['bot-1', 'bot-2']);
    assert.deepEqual(idsDelGrupo('otro', todos), ['otro']);
  });

  it('filtrarNuevosSinRepetir no vuelve a crear un abierto igual', () => {
    const existentes = [propio('ya')];
    const nuevos = [
      propio('nuevo'),
      propio('distinto', { title: 'Llamar a Carlos' })
    ];
    assert.deepEqual(
      filtrarNuevosSinRepetir(existentes, nuevos).map((t) => t.id),
      ['distinto']
    );
  });

  it('reusarIdsPorContenido deja el id viejo cuando el emisor manda otro', () => {
    const reusados = reusarIdsPorContenido(
      [propio('ops-viejo')],
      [propio('ops-nuevo', { updatedAt: '2026-10-14T08:00:00.000Z' })]
    );
    assert.equal(reusados[0]?.id, 'ops-viejo');
    assert.equal(reusados[0]?.updatedAt, '2026-10-14T08:00:00.000Z');
  });
});
