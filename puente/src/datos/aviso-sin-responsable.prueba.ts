import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  avisoNuevoSinResponsable,
  claveTareaSinResponsable,
  limpiarAvisados,
  tareasViejasSinResponsable,
  type TareaSinResponsable
} from './aviso-sin-responsable.js';

const AHORA = new Date('2026-10-10T18:00:00Z');

function tarea(
  extra: Partial<TareaSinResponsable> & Pick<TareaSinResponsable, 'id'>
): TareaSinResponsable {
  return {
    tipo: extra.tipo ?? 'pendiente',
    id: extra.id,
    titulo: extra.titulo ?? extra.id,
    desde: extra.desde ?? '2026-10-08T12:00:00Z'
  };
}

describe('tareasViejasSinResponsable', () => {
  it('solo cuenta las que llevan 24 h o mas', () => {
    const viejas = tareasViejasSinResponsable(
      [
        tarea({ id: 'vieja', desde: '2026-10-09T17:00:00Z' }),
        tarea({ id: 'fresca', desde: '2026-10-10T12:00:00Z' }),
        tarea({ id: 'justo', desde: '2026-10-09T18:00:00Z' })
      ],
      AHORA
    );
    assert.deepEqual(viejas.map((t) => t.id).sort(), ['justo', 'vieja']);
  });
});

describe('avisoNuevoSinResponsable', () => {
  it('avisa las nuevas y no las que ya se avisaron', () => {
    const viejas = [
      tarea({ id: 'a', titulo: 'Alta de portal' }),
      tarea({ id: 'b', titulo: 'Cotizar Nexus', tipo: 'funcionalidad' })
    ];
    const primero = avisoNuevoSinResponsable(viejas, { avisados: {} }, AHORA);
    assert.ok(primero.aviso);
    assert.match(primero.aviso!.titulo, /2 tareas/);
    assert.equal(primero.aviso!.ids.length, 2);

    const segundo = avisoNuevoSinResponsable(viejas, primero.estado, AHORA);
    assert.equal(segundo.aviso, undefined);

    const conNueva = avisoNuevoSinResponsable(
      [...viejas, tarea({ id: 'c', titulo: 'Hito de entrega', tipo: 'hito' })],
      primero.estado,
      AHORA
    );
    assert.ok(conNueva.aviso);
    assert.deepEqual(conNueva.aviso!.ids, ['hito:c']);
    assert.match(conNueva.aviso!.titulo, /1 tarea/);
  });

  it('si le ponen responsable se olvida y puede volver a avisar', () => {
    const a = tarea({ id: 'a' });
    const conAviso = avisoNuevoSinResponsable([a], { avisados: {} }, AHORA);
    const limpio = limpiarAvisados(conAviso.estado, []);
    assert.deepEqual(limpio.avisados, {});
    const otraVez = avisoNuevoSinResponsable([a], limpio, AHORA);
    assert.ok(otraVez.aviso);
  });
});

describe('claveTareaSinResponsable', () => {
  it('junta tipo e id', () => {
    assert.equal(
      claveTareaSinResponsable({ tipo: 'riesgo', id: 'r1' }),
      'riesgo:r1'
    );
  });
});
