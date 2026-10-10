import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ALERTAS_ESTANCADOS_OMISION,
  calcularSemaforo,
  diasEnEtapa,
  etapaEfectiva,
  montoVigenteDe,
  proyectoEstancado,
  validarHito,
  validarProyecto,
  validarRiesgo
} from './crm-clientes.js';
import type {
  CrmCotizacion,
  CrmHito,
  CrmProyecto
} from '../nucleo/contrato.js';

const AHORA = '2026-10-10T18:00:00.000Z';

function proyecto(extra: Partial<CrmProyecto> = {}): CrmProyecto {
  return {
    id: extra.id ?? 'portal-acme',
    clienteId: extra.clienteId ?? 'acme',
    nombre: extra.nombre ?? 'Portal Acme',
    actualizadoEn: extra.actualizadoEn ?? AHORA,
    ...extra
  };
}

describe('validarProyecto', () => {
  it('guarda etapa comercial y semaforo', () => {
    const p = validarProyecto(
      {
        nombre: 'Portal Acme',
        clienteId: 'acme-corp',
        etapaComercial: 'negociacion',
        enEtapaComericalDesde: '2026-09-01T00:00:00Z',
        semaforo: 'en_riesgo'
      },
      undefined,
      AHORA
    );
    assert.equal(p.etapaComercial, 'negociacion');
    assert.equal(p.enEtapaComericalDesde, '2026-09-01T00:00:00.000Z');
    assert.equal(p.semaforo, 'en_riesgo');
  });

  it('rechaza una etapa inventada', () => {
    assert.throws(
      () =>
        validarProyecto(
          { nombre: 'X', clienteId: 'c', etapaComercial: 'cerrado' },
          undefined,
          AHORA
        ),
      /no es válida/
    );
  });
});

describe('validarHito y validarRiesgo', () => {
  it('guarda el responsable del hito', () => {
    const h = validarHito(
      {
        proyectoId: 'portal-acme',
        nombre: 'Entrega de login',
        responsableId: 'ana-robles'
      },
      undefined,
      AHORA
    );
    assert.equal(h.responsableId, 'ana-robles');
    assert.equal(h.completado, false);
  });

  it('guarda el responsable del riesgo', () => {
    const r = validarRiesgo(
      {
        proyectoId: 'portal-acme',
        tipo: 'bloqueo',
        descripcion: 'Falta acceso al ambiente de pruebas',
        responsableId: 'marco-diaz'
      },
      undefined,
      AHORA
    );
    assert.equal(r.responsableId, 'marco-diaz');
    assert.equal(r.abierto, true);
  });
});

describe('diasEnEtapa y estancados', () => {
  it('cuenta dias desde enEtapaComericalDesde', () => {
    const p = proyecto({
      etapaComercial: 'negociacion',
      enEtapaComericalDesde: '2026-10-01T18:00:00Z'
    });
    assert.equal(diasEnEtapa(p, new Date(AHORA)), 9);
  });

  it('marca estancado segun el limite de la etapa', () => {
    const p = proyecto({
      etapaComercial: 'cotizacion_enviada',
      enEtapaComericalDesde: '2026-09-20T18:00:00Z'
    });
    assert.equal(
      proyectoEstancado(
        p,
        ALERTAS_ESTANCADOS_OMISION.diasPorEtapa,
        ALERTAS_ESTANCADOS_OMISION.diasDefault,
        new Date(AHORA)
      ),
      true
    );
  });

  it('no marca ganado ni perdido', () => {
    const p = proyecto({
      etapaComercial: 'ganado',
      enEtapaComericalDesde: '2026-01-01T00:00:00Z'
    });
    assert.equal(proyectoEstancado(p, {}, 1, new Date(AHORA)), false);
  });
});

describe('etapaEfectiva', () => {
  it('usa la guardada si hay', () => {
    assert.equal(
      etapaEfectiva(
        proyecto({ etapaComercial: 'prospecto', estado: 'en_desarrollo' })
      ),
      'prospecto'
    );
  });

  it('infiere ganado desde un estado de ejecucion', () => {
    assert.equal(etapaEfectiva(proyecto({ estado: 'en_pruebas' })), 'ganado');
  });
});

describe('calcularSemaforo', () => {
  it('atrasado si la fecha de fin ya paso', () => {
    assert.equal(
      calcularSemaforo(
        proyecto({ fechaFinEstimada: '2026-10-01T00:00:00Z' }),
        [],
        new Date(AHORA)
      ),
      'atrasado'
    );
  });

  it('en riesgo si un hito vence en menos de 7 dias', () => {
    const hitos: CrmHito[] = [
      {
        id: 'h1',
        proyectoId: 'portal-acme',
        nombre: 'UAT',
        completado: false,
        fechaCompromiso: '2026-10-14T00:00:00Z',
        actualizadoEn: AHORA
      }
    ];
    assert.equal(
      calcularSemaforo(proyecto(), hitos, new Date(AHORA)),
      'en_riesgo'
    );
  });

  it('en tiempo si no hay fechas encima', () => {
    assert.equal(
      calcularSemaforo(
        proyecto({ fechaFinEstimada: '2026-12-01T00:00:00Z' }),
        [],
        new Date(AHORA)
      ),
      'en_tiempo'
    );
  });
});

describe('montoVigenteDe', () => {
  it('prefiere la aprobada sobre la enviada', () => {
    const cots: CrmCotizacion[] = [
      {
        id: 'c1',
        nombre: 'v1',
        estatus: 'enviada',
        total: 80_000,
        moneda: 'MXN',
        actualizadoEn: AHORA
      },
      {
        id: 'c2',
        nombre: 'v2',
        estatus: 'aprobada',
        total: 95_000,
        moneda: 'MXN',
        actualizadoEn: AHORA
      }
    ];
    assert.deepEqual(montoVigenteDe(cots), {
      total: 95_000,
      moneda: 'MXN',
      folio: undefined
    });
  });
});
