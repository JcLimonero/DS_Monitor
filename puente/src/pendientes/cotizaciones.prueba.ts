import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CrmStage, Person } from '../nucleo/contrato.js';
import {
  AJUSTES_COTIZACIONES_VACIOS,
  buscarVendedor,
  decidir,
  DIAS_POR_OMISION,
  diasVigentes,
  idDePendiente,
  pendienteDeCotizacion,
  tituloDelPendiente,
  validarAjustes,
  type CotizacionVigilada
} from './cotizaciones.js';

const DIA = 86_400_000;
const AHORA = new Date('2026-10-10T12:00:00Z');
const haceDias = (n: number) =>
  new Date(AHORA.getTime() - n * DIA).toISOString();

const cot = (
  etapa: CrmStage,
  dias: number,
  extra: Partial<CotizacionVigilada> = {}
): CotizacionVigilada => ({
  emisor: 'cot',
  id: 'cot-1',
  nombre: 'Licencias anuales',
  cliente: 'Grupo Delta',
  etapa,
  accountId: 'cot',
  ultimoMovimiento: haceDias(dias),
  ...extra
});

describe('limites por etapa', () => {
  it('por omision: nuevo 1, calificado 2, propuesta 3, negociacion 5', () => {
    assert.deepEqual(diasVigentes(AJUSTES_COTIZACIONES_VACIOS), {
      nuevo: 1,
      calificado: 2,
      propuesta: 3,
      negociacion: 5
    });
    assert.deepEqual(DIAS_POR_OMISION, diasVigentes({ dias: {} }));
  });

  it('lo guardado manda sobre lo de fabrica; null vuelve a fabrica', () => {
    const a = validarAjustes(
      { dias: { propuesta: 7, nuevo: 0 } },
      { dias: {} }
    );
    assert.equal(diasVigentes(a).propuesta, 7);
    assert.equal(diasVigentes(a).nuevo, 0);
    const b = validarAjustes({ dias: { propuesta: null } }, a);
    assert.equal(diasVigentes(b).propuesta, 3);
    assert.equal(diasVigentes(b).nuevo, 0);
  });

  it('rechaza etapas que no se vigilan y valores raros', () => {
    for (const malo of [
      { dias: { ganado: 3 } },
      { dias: { nuevo: -1 } },
      { dias: { nuevo: 1.5 } },
      { dias: { nuevo: '3' } },
      { dias: { nuevo: 4000 } },
      { dias: [] },
      {}
    ]) {
      assert.throws(
        () => validarAjustes(malo, { dias: {} }),
        Error,
        JSON.stringify(malo)
      );
    }
  });
});

describe('decidir: cuando una cotizacion vence', () => {
  const ajustes = AJUSTES_COTIZACIONES_VACIOS;

  it('no vence antes de su limite y vence al cumplirlo', () => {
    assert.deepEqual(decidir(cot('propuesta', 2), undefined, ajustes, AHORA), {
      accion: 'ninguna'
    });
    const d = decidir(cot('propuesta', 3), undefined, ajustes, AHORA);
    assert.equal(d.accion, 'crear');
  });

  it('cada etapa usa su limite', () => {
    const vence = (etapa: CrmStage, dias: number) =>
      decidir(cot(etapa, dias), undefined, ajustes, AHORA).accion;
    assert.equal(vence('nuevo', 1), 'crear');
    assert.equal(vence('calificado', 1), 'ninguna');
    assert.equal(vence('calificado', 2), 'crear');
    assert.equal(vence('negociacion', 4), 'ninguna');
    assert.equal(vence('negociacion', 5), 'crear');
  });

  it('ganado y perdido se ignoran, por viejos que sean', () => {
    for (const etapa of ['ganado', 'perdido'] as const) {
      assert.deepEqual(decidir(cot(etapa, 90), undefined, ajustes, AHORA), {
        accion: 'ninguna'
      });
    }
  });

  it('una etapa con 0 dias no se vigila', () => {
    assert.equal(
      decidir(cot('nuevo', 30), undefined, { dias: { nuevo: 0 } }, AHORA)
        .accion,
      'ninguna'
    );
  });

  it('con el pendiente ya creado para este movimiento no lo vuelve a crear', () => {
    const c = cot('propuesta', 10);
    const creada = { ...c, pendienteDesde: c.ultimoMovimiento };
    // Abierto, hecho a mano (false) o borrado (undefined): nada.
    for (const estado of [true, false, undefined]) {
      assert.deepEqual(decidir(creada, estado, ajustes, AHORA), {
        accion: 'ninguna'
      });
    }
  });

  it('un movimiento nuevo cierra el pendiente abierto', () => {
    const c = cot('propuesta', 1, { pendienteDesde: haceDias(9) });
    const d = decidir(c, true, ajustes, AHORA);
    assert.equal(d.accion, 'cerrar');
  });

  it('tras el movimiento, si vuelve a vencer, se crea otra vez (hecho o borrado)', () => {
    const c = cot('propuesta', 4, { pendienteDesde: haceDias(9) });
    for (const estado of [false, undefined]) {
      assert.equal(decidir(c, estado, ajustes, AHORA).accion, 'crear');
    }
  });

  it('ganada con el pendiente abierto: se cierra', () => {
    const c = cot('ganado', 0, { pendienteDesde: haceDias(9) });
    assert.equal(decidir(c, true, ajustes, AHORA).accion, 'cerrar');
    assert.equal(decidir(c, false, ajustes, AHORA).accion, 'ninguna');
  });
});

describe('el pendiente', () => {
  it('lleva un id determinista por oportunidad y el titulo pedido', () => {
    const c = cot('propuesta', 4, { url: 'https://crm.example.com/1' });
    const t = pendienteDeCotizacion(c, 4, AHORA);
    assert.equal(t.id, idDePendiente('cot-1'));
    assert.equal(t.id, 'cotizacion-cot-1');
    assert.equal(
      t.title,
      'Revisar cotización Licencias anuales (Grupo Delta): lleva 4 días en propuesta'
    );
    assert.equal(t.url, 'https://crm.example.com/1');
    assert.equal(t.status, 'pendiente');
    assert.equal(
      tituloDelPendiente(cot('nuevo', 1), 1).includes('1 día en'),
      true
    );
  });
});

describe('buscarVendedor', () => {
  const equipo: Person[] = [
    { id: 'u1', name: 'Juan Carlos', email: 'jc@example.com' },
    { id: 'u2', name: 'Elena Paredes' },
    { id: 'u3', name: 'Mario López' },
    { id: 'u4', name: 'mario lopez' }
  ];

  it('por correo', () => {
    assert.equal(
      buscarVendedor({ id: 'x', name: 'Otro', email: 'JC@example.com' }, equipo)
        ?.id,
      'u1'
    );
  });

  it('por nombre, sin importar acentos ni mayusculas', () => {
    assert.equal(
      buscarVendedor({ id: 'x', name: 'ELENA  Paredes' }, equipo)?.id,
      'u2'
    );
  });

  it('no adivina: nombre parcial, ambiguo o ausente da nada', () => {
    assert.equal(buscarVendedor({ id: 'x', name: 'Juan' }, equipo), undefined);
    assert.equal(
      buscarVendedor({ id: 'x', name: 'Mario Lopez' }, equipo),
      undefined
    );
    assert.equal(buscarVendedor(undefined, equipo), undefined);
  });
});
