import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TaskItem } from '../nucleo/contrato.js';
import {
  anotar,
  conSeguidor,
  conSugerencia,
  sinSeguidor,
  sinSugerencia
} from './anotaciones.js';
import {
  esResponsable,
  esSeguidor,
  pendientesDePersona
} from './seguidores.js';

const ana = { id: 'ana', name: 'Ana', email: 'Ana@Nexus.com' };
const beto = { id: 'beto', name: 'Beto', email: 'beto@nexus.com' };
const carla = { id: 'carla', name: 'Carla' };

const tarea = (id: string, extra: Partial<TaskItem> = {}): TaskItem => ({
  id,
  title: id,
  status: 'pendiente',
  priority: 'media',
  accountId: 'ops',
  origin: 'ops',
  tags: [],
  updatedAt: '',
  ...extra
});

describe('seguidores en la anotación', () => {
  it('agrega con su movimiento y no repite ni al responsable', () => {
    const vacia = { comentarios: [], actualizadoEn: '' };
    const una = conSeguidor(vacia, ana, '2026-09-20T10:00:00Z', 'admin');
    assert.deepEqual(una.seguidores, [ana]);
    assert.equal(una.historial?.[0]?.text, 'Da seguimiento: Ana');
    assert.equal(una.historial?.[0]?.kind, 'asignacion');
    // Por correo, sin importar mayúsculas.
    assert.equal(
      conSeguidor(una, { ...ana, id: 'otra', email: 'ana@nexus.com' }, ''),
      una
    );
    const conDueno = { ...vacia, asignado: beto };
    assert.equal(conSeguidor(conDueno, beto, ''), conDueno);
  });

  it('quita con su movimiento; si no estaba, nada', () => {
    const nota = conSeguidor(
      conSeguidor({ comentarios: [], actualizadoEn: '' }, ana, ''),
      beto,
      ''
    );
    const sinAna = sinSeguidor(nota, ana, '2026-09-20T11:00:00Z', 'admin');
    assert.deepEqual(sinAna.seguidores, [beto]);
    assert.equal(
      sinAna.historial?.at(-1)?.text,
      'Deja de dar seguimiento: Ana'
    );
    assert.equal(sinSeguidor(sinAna, carla, ''), sinAna);
    assert.equal(sinSeguidor(sinAna, beto, '').seguidores, undefined);
  });

  it('se sirven como followers encima de la tarea', () => {
    const [t] = anotar([tarea('x')], {
      x: { comentarios: [], actualizadoEn: '', seguidores: [ana] }
    });
    assert.deepEqual(t?.followers, [ana]);
    const [sin] = anotar([tarea('x')], {
      x: { comentarios: [], actualizadoEn: '', seguidores: [] }
    });
    assert.equal(sin?.followers, undefined);
  });
});

describe('sugerencia de responsable', () => {
  it('se guarda, se sirve y se descarta con movimiento', () => {
    const nota = conSugerencia(
      { comentarios: [], actualizadoEn: '' },
      ana,
      'Atiende lo de ese cliente',
      '2026-09-20T10:00:00Z'
    );
    assert.equal(nota.autoAsignacionIntentada, true);
    assert.equal(
      nota.historial?.[0]?.text,
      'Sugiere a Ana: Atiende lo de ese cliente'
    );
    const [t] = anotar([tarea('x')], { x: nota });
    assert.deepEqual(t?.suggestedAssignee, {
      person: ana,
      reason: 'Atiende lo de ese cliente'
    });
    const descartada = sinSugerencia(
      nota,
      '2026-09-20T11:00:00Z',
      'admin',
      true
    );
    assert.equal(descartada.sugerencia, undefined);
    assert.equal(
      descartada.historial?.at(-1)?.text,
      'Sugerencia descartada: Ana'
    );
    assert.equal(sinSugerencia(descartada, ''), descartada);
  });

  it('con responsable ya asignado la sugerencia no se sirve', () => {
    const nota = {
      ...conSugerencia({ comentarios: [], actualizadoEn: '' }, ana, 'x', ''),
      asignado: beto
    };
    const [t] = anotar([tarea('x')], { x: nota });
    assert.equal(t?.suggestedAssignee, undefined);
    assert.equal(t?.assignee?.id, 'beto');
  });
});

describe('pendientesDePersona (la liga /mio)', () => {
  const mia = tarea('mia', { assignee: ana });
  const sigo = tarea('sigo', { assignee: beto, followers: [ana] });
  const ajena = tarea('ajena', { assignee: beto });
  const porCorreo = tarea('correo', {
    assignee: { id: 'x', name: 'Ana', email: 'ana@nexus.com' }
  });

  it('ve lo suyo y lo que sigue, y sabe cuál es cuál', () => {
    const r = pendientesDePersona([mia, sigo, ajena, porCorreo], ana);
    assert.deepEqual(
      r.pendientes.map((t) => t.id),
      ['mia', 'sigo', 'correo']
    );
    assert.deepEqual(r.seguimiento, ['sigo']);
    assert.equal(esResponsable(sigo, ana), false);
    assert.equal(esSeguidor(sigo, ana), true);
    assert.equal(esResponsable(porCorreo, ana), true);
  });

  it('la liga de una sola tarea acota', () => {
    const r = pendientesDePersona([mia, sigo], ana, 'sigo');
    assert.deepEqual(
      r.pendientes.map((t) => t.id),
      ['sigo']
    );
    assert.deepEqual(pendientesDePersona([mia], ana, 'otra').pendientes, []);
  });
});
