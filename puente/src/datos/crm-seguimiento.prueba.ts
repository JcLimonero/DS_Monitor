import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CrmOpportunity, CrmStage } from '../nucleo/contrato.js';
import {
  aplicarSeguimiento,
  cambiosPendientes,
  confirmar,
  indiceActividades,
  llave,
  moverManual,
  registrarEnvio,
  SEGUIMIENTO_VACIO,
  sembrar,
  ultimoMovimiento,
  type SeguimientoCrm
} from './crm-seguimiento.js';

const T0 = '2026-10-01T10:00:00.000Z';
const T1 = '2026-10-02T10:00:00.000Z';
const T2 = '2026-10-03T10:00:00.000Z';
const AHORA = new Date('2026-10-10T00:00:00Z');

const opp = (id: string, stage: CrmStage): CrmOpportunity => ({
  id,
  name: `Cotización ${id}`,
  partner: 'Cliente',
  stage,
  amount: 100,
  currency: 'MXN',
  probability: 0,
  accountId: 'cot',
  updatedAt: T0
});

function envio(
  previo: SeguimientoCrm,
  emisor: string,
  generadoEn: string,
  oportunidades: Pick<CrmOpportunity, 'id' | 'stage'>[],
  extra: {
    actividades?: { id: string; opportunityId?: string }[];
    modo?: 'reemplazar' | 'agregar';
  } = {}
): SeguimientoCrm {
  return registrarEnvio(previo, {
    emisor,
    generadoEn,
    oportunidades,
    actividades: extra.actividades,
    modo: extra.modo ?? 'reemplazar',
    ahora: AHORA
  });
}

describe('seguimiento de cotizaciones', () => {
  it('la primera vez, el cambio es el generadoEn del envio', () => {
    const seg = envio(SEGUIMIENTO_VACIO, 'cot', T0, [
      { id: 'cot-1', stage: 'nuevo' }
    ]);
    const e = seg.oportunidades[llave('cot', 'cot-1')];
    assert.equal(e?.etapaVista, 'nuevo');
    assert.equal(e?.cambioEn, T0);
  });

  it('detecta el cambio de etapa y no lo mueve si la etapa es la misma', () => {
    let seg = envio(SEGUIMIENTO_VACIO, 'cot', T0, [
      { id: 'cot-1', stage: 'nuevo' }
    ]);
    seg = envio(seg, 'cot', T1, [{ id: 'cot-1', stage: 'nuevo' }]);
    assert.equal(seg.oportunidades[llave('cot', 'cot-1')]?.cambioEn, T0);
    seg = envio(seg, 'cot', T2, [{ id: 'cot-1', stage: 'propuesta' }]);
    const e = seg.oportunidades[llave('cot', 'cot-1')];
    assert.equal(e?.etapaVista, 'propuesta');
    assert.equal(e?.cambioEn, T2);
  });

  it('un generadoEn en el futuro no congela la cotizacion para siempre', () => {
    const seg = envio(SEGUIMIENTO_VACIO, 'cot', '2099-01-01T00:00:00Z', [
      { id: 'cot-1', stage: 'nuevo' }
    ]);
    assert.equal(
      seg.oportunidades[llave('cot', 'cot-1')]?.cambioEn,
      AHORA.toISOString()
    );
  });

  it('una actividad ligada nueva cuenta como movimiento; la repetida no', () => {
    let seg = envio(
      SEGUIMIENTO_VACIO,
      'cot',
      T0,
      [{ id: 'cot-1', stage: 'propuesta' }],
      { actividades: [{ id: 'cot-a1', opportunityId: 'cot-1' }] }
    );
    const entrada = () =>
      seg.oportunidades[llave('cot', 'cot-1')] as NonNullable<
        SeguimientoCrm['oportunidades'][string]
      >;
    assert.equal(ultimoMovimiento(entrada(), indiceActividades(seg)), T0);

    // La misma actividad en el envio siguiente: no es nueva.
    seg = envio(seg, 'cot', T1, [{ id: 'cot-1', stage: 'propuesta' }], {
      actividades: [{ id: 'cot-a1', opportunityId: 'cot-1' }]
    });
    assert.equal(ultimoMovimiento(entrada(), indiceActividades(seg)), T0);

    // Una distinta si.
    seg = envio(seg, 'cot', T2, [{ id: 'cot-1', stage: 'propuesta' }], {
      actividades: [
        { id: 'cot-a1', opportunityId: 'cot-1' },
        { id: 'cot-a2', opportunityId: 'cot-1' },
        { id: 'cot-suelta' }
      ]
    });
    assert.equal(ultimoMovimiento(entrada(), indiceActividades(seg)), T2);
    // La que no cuelga de ninguna oportunidad no se guarda.
    assert.equal(seg.actividades[llave('cot', 'cot-suelta')], undefined);
  });

  it('reemplazar olvida lo que ya no viene; agregar lo conserva', () => {
    let seg = envio(SEGUIMIENTO_VACIO, 'cot', T0, [
      { id: 'cot-1', stage: 'nuevo' },
      { id: 'cot-2', stage: 'nuevo' }
    ]);
    seg = envio(seg, 'cot', T1, [{ id: 'cot-3', stage: 'nuevo' }], {
      modo: 'agregar'
    });
    assert.equal(Object.keys(seg.oportunidades).length, 3);
    seg = envio(seg, 'cot', T2, [{ id: 'cot-3', stage: 'nuevo' }]);
    assert.deepEqual(Object.keys(seg.oportunidades), [llave('cot', 'cot-3')]);
  });

  it('reemplazar de un emisor no toca el seguimiento de otro', () => {
    let seg = envio(SEGUIMIENTO_VACIO, 'a', T0, [
      { id: 'a-1', stage: 'nuevo' }
    ]);
    seg = envio(seg, 'b', T0, [{ id: 'b-1', stage: 'nuevo' }]);
    seg = envio(seg, 'a', T1, []);
    assert.deepEqual(Object.keys(seg.oportunidades), [llave('b', 'b-1')]);
  });

  it('sembrar da de alta lo anterior al seguimiento, una sola vez', () => {
    const seg = sembrar(
      SEGUIMIENTO_VACIO,
      'cot',
      [opp('cot-1', 'nuevo')],
      AHORA
    );
    assert.equal(
      seg.oportunidades[llave('cot', 'cot-1')]?.cambioEn,
      AHORA.toISOString()
    );
    assert.equal(sembrar(seg, 'cot', [opp('cot-1', 'nuevo')], new Date()), seg);
  });
});

describe('movimiento manual', () => {
  const base = () =>
    envio(SEGUIMIENTO_VACIO, 'cot', T0, [{ id: 'cot-1', stage: 'propuesta' }]);

  const mover = (
    seg: SeguimientoCrm,
    etapa: CrmStage,
    etapaDelEmisor: CrmStage
  ) =>
    moverManual(seg, {
      emisor: 'cot',
      id: 'cot-1',
      etapa,
      por: 'ana@example.com',
      etapaDelEmisor,
      ahora: AHORA
    });

  it('la manual gana hasta que el emisor confirma, aunque mande otra', () => {
    const r = mover(base(), 'negociacion', 'propuesta');
    assert.ok(r.ok && !r.sinCambio);
    let seg = (r as { seguimiento: SeguimientoCrm }).seguimiento;

    // El emisor sigue diciendo "propuesta": se sirve la manual.
    let [servida] = aplicarSeguimiento([opp('cot-1', 'propuesta')], 'cot', seg);
    assert.equal(servida?.stage, 'negociacion');
    assert.deepEqual(servida?.stageManual, {
      by: 'ana@example.com',
      at: AHORA.toISOString(),
      reported: 'propuesta'
    });

    // Y si el emisor manda OTRA etapa distinta, sigue ganando la manual.
    seg = envio(seg, 'cot', T1, [{ id: 'cot-1', stage: 'calificado' }]);
    [servida] = aplicarSeguimiento([opp('cot-1', 'calificado')], 'cot', seg);
    assert.equal(servida?.stage, 'negociacion');
    assert.equal(servida?.stageManual?.reported, 'calificado');

    // Confirmado: manda el emisor otra vez.
    seg = confirmar(seg, 'cot', ['1']).seguimiento;
    [servida] = aplicarSeguimiento([opp('cot-1', 'calificado')], 'cot', seg);
    assert.equal(servida?.stage, 'calificado');
    assert.equal(servida?.stageManual, undefined);
  });

  it('cuenta como movimiento', () => {
    const r = mover(base(), 'negociacion', 'propuesta');
    const seg = (r as { seguimiento: SeguimientoCrm }).seguimiento;
    const e = seg.oportunidades[llave('cot', 'cot-1')];
    assert.equal(e?.cambioEn, AHORA.toISOString());
  });

  it('pedir la etapa que ya se ve no hace nada', () => {
    const seg = base();
    const r = mover(seg, 'propuesta', 'propuesta');
    assert.ok(r.ok && r.sinCambio);
    assert.equal((r as { seguimiento: SeguimientoCrm }).seguimiento, seg);
  });

  it('una oportunidad que no existe no se puede mover', () => {
    const r = moverManual(base(), {
      emisor: 'cot',
      id: 'cot-99',
      etapa: 'ganado',
      por: 'x',
      etapaDelEmisor: 'nuevo'
    });
    assert.deepEqual(r, { ok: false, motivo: 'no-existe' });
  });

  it('otro emisor con el mismo id no comparte el movimiento', () => {
    const seg = envio(base(), 'otro', T0, [
      { id: 'cot-1', stage: 'propuesta' }
    ]);
    const r = mover(seg, 'ganado', 'propuesta');
    const movido = (r as { seguimiento: SeguimientoCrm }).seguimiento;
    assert.equal(cambiosPendientes(movido, 'cot').length, 1);
    assert.deepEqual(cambiosPendientes(movido, 'otro'), []);
  });
});

describe('cambios y confirmar: aislamiento entre emisores', () => {
  function conMovimientos(): SeguimientoCrm {
    let seg = envio(SEGUIMIENTO_VACIO, 'a', T0, [
      { id: 'a-1', stage: 'nuevo' }
    ]);
    seg = envio(seg, 'b', T0, [{ id: 'b-1', stage: 'nuevo' }]);
    for (const [emisor, id] of [
      ['a', 'a-1'],
      ['b', 'b-1']
    ] as const) {
      const r = moverManual(seg, {
        emisor,
        id,
        etapa: 'ganado',
        por: 'dueno@example.com',
        etapaDelEmisor: 'nuevo',
        ahora: AHORA
      });
      seg = (r as { seguimiento: SeguimientoCrm }).seguimiento;
    }
    return seg;
  }

  it('cada emisor ve solo lo suyo, con el id sin prefijo', () => {
    const seg = conMovimientos();
    assert.deepEqual(cambiosPendientes(seg, 'a'), [
      {
        id: '1',
        etapa: 'ganado',
        por: 'dueno@example.com',
        en: AHORA.toISOString()
      }
    ]);
    assert.deepEqual(
      cambiosPendientes(seg, 'b').map((c) => c.id),
      ['1']
    );
    assert.deepEqual(cambiosPendientes(seg, 'c'), []);
  });

  it('un emisor no confirma lo de otro: sus ids ajenos se ignoran', () => {
    const seg = conMovimientos();
    // "a" intenta confirmar el "1" de "b" (mismo id sin prefijo) y el id ya
    // prefijado de b: solo cuenta el suyo.
    const r = confirmar(seg, 'a', ['b-1', 'inventado', '1']);
    assert.equal(r.confirmados, 1);
    assert.deepEqual(cambiosPendientes(r.seguimiento, 'a'), []);
    assert.equal(cambiosPendientes(r.seguimiento, 'b').length, 1);
  });

  it('confirmar dos veces cuenta una sola', () => {
    const seg = conMovimientos();
    const una = confirmar(seg, 'a', ['1']);
    assert.equal(una.confirmados, 1);
    assert.equal(confirmar(una.seguimiento, 'a', ['1']).confirmados, 0);
  });

  it('con {id, en} no confirma un movimiento que el emisor no alcanzo a ver', () => {
    const seg = conMovimientos();
    const visto = cambiosPendientes(seg, 'a')[0];
    // Alguien lo mueve otra vez despues de la lectura del emisor.
    const otra = moverManual(seg, {
      emisor: 'a',
      id: 'a-1',
      etapa: 'perdido',
      por: 'otro@example.com',
      etapaDelEmisor: 'nuevo',
      ahora: new Date(AHORA.getTime() + 60_000)
    });
    const nuevo = (otra as { seguimiento: SeguimientoCrm }).seguimiento;
    const r = confirmar(nuevo, 'a', [{ id: '1', en: visto?.en }]);
    assert.equal(r.confirmados, 0);
    assert.equal(cambiosPendientes(r.seguimiento, 'a')[0]?.etapa, 'perdido');
  });
});
