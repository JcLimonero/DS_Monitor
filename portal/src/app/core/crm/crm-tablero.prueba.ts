import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ALERTAS_ESTANCADOS_OMISION,
  agruparPorEtapa,
  agruparPorEjecucion,
  diasEnEtapa,
  etapaEfectiva,
  etapaVecina,
  filtrarProyectos,
  montoVigenteDe,
  proyectoEstancado,
  proximoPasoDe
} from './crm-tablero';
import type {
  CrmActividadCliente,
  CrmCotizacion,
  CrmHito,
  CrmProyecto
} from '../models/crm-nativo.model';

const AHORA = new Date('2026-10-10T18:00:00Z');

function proyecto(extra: Partial<CrmProyecto> = {}): CrmProyecto {
  return {
    id: extra.id ?? 'portal-acme',
    clienteId: extra.clienteId ?? 'acme',
    nombre: extra.nombre ?? 'Portal Acme',
    actualizadoEn: extra.actualizadoEn ?? AHORA.toISOString(),
    ...extra
  };
}

describe('etapaEfectiva y agrupado', () => {
  it('infiere ganado desde en_desarrollo', () => {
    assert.equal(
      etapaEfectiva(proyecto({ estado: 'en_desarrollo' })),
      'ganado'
    );
  });

  it('agrupa leads por etapa comercial', () => {
    const grupos = agruparPorEtapa([
      proyecto({ id: 'a', etapaComercial: 'prospecto' }),
      proyecto({ id: 'b', estado: 'en_pruebas' }),
      proyecto({ id: 'c', etapaComercial: 'negociacion' })
    ]);
    assert.equal(grupos.prospecto.length, 1);
    assert.equal(grupos.ganado.length, 1);
    assert.equal(grupos.negociacion.length, 1);
    assert.equal(grupos.perdido.length, 0);
  });

  it('agrupa ganados por estado de ejecucion', () => {
    const grupos = agruparPorEjecucion([
      proyecto({ id: 'a', estado: 'en_pruebas' }),
      proyecto({ id: 'b', etapaComercial: 'prospecto' }),
      proyecto({ id: 'c', etapaComercial: 'ganado' })
    ]);
    assert.equal(grupos.en_pruebas.length, 1);
    assert.equal(grupos.en_desarrollo.length, 1);
    assert.equal(grupos.pausado.length, 0);
  });
});

describe('filtros y estancados', () => {
  it('filtra por empresa, cliente y sin responsable', () => {
    const lista = [
      proyecto({
        id: '1',
        empresaAtiendeId: 'itech',
        clienteId: 'acme',
        responsableInterno: { id: 'ana', name: 'Ana' }
      }),
      proyecto({
        id: '2',
        empresaAtiendeId: 'itech',
        clienteId: 'beta',
        clienteFinalId: 'acme'
      }),
      proyecto({ id: '3', empresaAtiendeId: 'nexus', clienteId: 'acme' })
    ];
    assert.equal(filtrarProyectos(lista, { empresaId: 'itech' }).length, 2);
    assert.equal(filtrarProyectos(lista, { clienteId: 'acme' }).length, 3);
    assert.equal(
      filtrarProyectos(lista, { responsableId: '__nadie__' }).map((p) => p.id)
        .length,
      2
    );
  });

  it('marca estancado segun dias de la etapa', () => {
    const p = proyecto({
      etapaComercial: 'cotizacion_enviada',
      enEtapaComericalDesde: '2026-09-20T18:00:00Z'
    });
    assert.equal(diasEnEtapa(p, AHORA), 20);
    assert.equal(proyectoEstancado(p, ALERTAS_ESTANCADOS_OMISION, AHORA), true);
  });
});

describe('monto vigente y proximo paso', () => {
  it('toma la cotizacion aprobada', () => {
    const cots: CrmCotizacion[] = [
      {
        id: '1',
        nombre: 'v1',
        estatus: 'enviada',
        total: 10,
        actualizadoEn: ''
      },
      {
        id: '2',
        nombre: 'v2',
        estatus: 'aprobada',
        total: 20,
        actualizadoEn: ''
      }
    ];
    assert.equal(montoVigenteDe(cots).total, 20);
  });

  it('usa el proximo paso de la actividad mas reciente', () => {
    const acts: CrmActividadCliente[] = [
      {
        id: '1',
        clienteId: 'acme',
        tipo: 'nota',
        resumen: 'vieja',
        fecha: '2026-10-01T00:00:00Z',
        proximoPaso: { descripcion: 'Llamar', fecha: '2026-10-02' },
        actualizadoEn: ''
      },
      {
        id: '2',
        clienteId: 'acme',
        tipo: 'llamada',
        resumen: 'nueva',
        fecha: '2026-10-08T00:00:00Z',
        proximoPaso: { descripcion: 'Enviar propuesta', fecha: '2026-10-11' },
        actualizadoEn: ''
      }
    ];
    const hitos: CrmHito[] = [
      {
        id: 'h',
        proyectoId: 'p',
        nombre: 'Kickoff',
        completado: false,
        actualizadoEn: ''
      }
    ];
    assert.equal(proximoPasoDe(acts, hitos), 'Enviar propuesta');
    assert.equal(proximoPasoDe([], hitos), 'Kickoff');
  });
});

describe('etapaVecina', () => {
  it('avanza y retrocede en el kanban', () => {
    assert.equal(etapaVecina('prospecto', 1), 'en_cotizacion');
    assert.equal(etapaVecina('prospecto', -1), undefined);
    assert.equal(etapaVecina('por_confirmar', 1), undefined);
  });
});
