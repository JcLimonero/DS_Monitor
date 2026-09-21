import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TaskItem } from '../nucleo/contrato.js';
import type { Anotaciones } from './anotaciones.js';
import {
  candidatosDeAutoasignacion,
  describirResumen,
  resumenVacio
} from './autoasignar.js';

const ahora = new Date('2026-09-20T12:00:00Z');

const base: TaskItem = {
  id: 'c1',
  title: 'Factura de Paddle',
  description: 'De: Paddle <help@paddle.com>\nPara: yo',
  status: 'pendiente',
  priority: 'media',
  accountId: 'correo-nexus',
  origin: 'correo',
  tags: ['correo'],
  updatedAt: '2026-09-18T10:00:00Z'
};

const ana = { id: 'ana', name: 'Ana', email: 'ana@nexus.com' };

function tarea(id: string, extra: Partial<TaskItem> = {}): TaskItem {
  return { ...base, id, ...extra };
}

describe('candidatos de autoasignacion', () => {
  it('toma los de correo abiertos, sin responsable y sin anotaciones', () => {
    const lista = candidatosDeAutoasignacion(
      [
        tarea('a'),
        tarea('b', { assignee: ana }),
        tarea('c', { status: 'hecho' }),
        tarea('d', { origin: 'local' })
      ],
      {},
      { ahora }
    );
    assert.deepEqual(
      lista.map((t) => t.id),
      ['a']
    );
  });

  it('respeta lo anotado: asignado, hecho, eliminado y movimientos de personas', () => {
    const notas: Anotaciones = {
      asignado: { comentarios: [], actualizadoEn: '', asignado: ana },
      hecho: { comentarios: [], actualizadoEn: '', hecho: true },
      estadoHecho: { comentarios: [], actualizadoEn: '', estado: 'hecho' },
      eliminado: { comentarios: [], actualizadoEn: '', eliminado: true },
      tocado: {
        comentarios: [],
        actualizadoEn: '',
        historial: [
          {
            at: '2026-09-19T00:00:00Z',
            by: 'carlos@nexus.com',
            kind: 'asignacion',
            text: 'Responsable quitado'
          }
        ]
      },
      // Las notas del correo relacionado no son decision de nadie.
      correo: {
        comentarios: [],
        actualizadoEn: '',
        historial: [
          {
            at: '2026-09-19T00:00:00Z',
            by: 'Correo',
            kind: 'comentario',
            text: 'Llego respuesta'
          }
        ]
      }
    };
    const lista = candidatosDeAutoasignacion(
      [
        tarea('asignado'),
        tarea('hecho'),
        tarea('estadoHecho'),
        tarea('eliminado'),
        tarea('tocado'),
        tarea('correo'),
        tarea('limpio')
      ],
      notas,
      { ahora }
    );
    assert.deepEqual(
      lista.map((t) => t.id),
      ['correo', 'limpio']
    );
  });

  it('deja fuera los ya intentados, salvo con reintentar y sin sugerencia', () => {
    const notas: Anotaciones = {
      intentado: {
        comentarios: [],
        actualizadoEn: '',
        autoAsignacionIntentada: true
      },
      sugerido: {
        comentarios: [],
        actualizadoEn: '',
        autoAsignacionIntentada: true,
        sugerencia: { responsable: ana, motivo: 'por el rol', at: '' },
        historial: [
          {
            at: '2026-09-19T00:00:00Z',
            by: 'IA',
            kind: 'asignacion',
            text: 'Sugiere a Ana'
          }
        ]
      }
    };
    const tareas = [tarea('intentado'), tarea('sugerido'), tarea('nuevo')];
    assert.deepEqual(
      candidatosDeAutoasignacion(tareas, notas, { ahora }).map((t) => t.id),
      ['nuevo']
    );
    assert.deepEqual(
      candidatosDeAutoasignacion(tareas, notas, {
        ahora,
        reintentar: true
      }).map((t) => t.id),
      ['intentado', 'nuevo']
    );
  });

  it('con diasAtras recorta por fecha; sin el, entra todo', () => {
    const tareas = [
      tarea('reciente', { updatedAt: '2026-09-15T00:00:00Z' }),
      tarea('viejo', { updatedAt: '2026-06-01T00:00:00Z' })
    ];
    assert.deepEqual(
      candidatosDeAutoasignacion(tareas, {}, { ahora, diasAtras: 30 }).map(
        (t) => t.id
      ),
      ['reciente']
    );
    assert.deepEqual(
      candidatosDeAutoasignacion(tareas, {}, { ahora }).map((t) => t.id),
      ['reciente', 'viejo']
    );
  });
});

describe('resumen de la corrida', () => {
  it('arranca en ceros y se describe en una linea', () => {
    const r = resumenVacio();
    assert.equal(
      describirResumen(r),
      'Asignados 0 (regla 0, IA 0) · Sugeridos 0 · Sin propuesta 0'
    );
    r.asignadosPorRegla.push({ id: 'a', titulo: 'A', responsable: 'Ana' });
    r.asignadosPorIa.push({ id: 'b', titulo: 'B', responsable: 'Luis' });
    r.sugeridos.push({ id: 'c', titulo: 'C', responsable: 'Ana' });
    r.sinPropuesta = 2;
    r.omitidos = 3;
    assert.equal(
      describirResumen(r),
      'Asignados 2 (regla 1, IA 1) · Sugeridos 1 · Sin propuesta 2 · Pendientes de revisar 3'
    );
  });
});
