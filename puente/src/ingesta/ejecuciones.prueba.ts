import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  estadoDe,
  listarEjecuciones,
  registrarEjecucion
} from './ejecuciones.js';

const AHORA = new Date('2026-09-18T12:00:00Z');

describe('ejecuciones', () => {
  it('registra la corrida con lo que manda la aplicación', () => {
    const { ejecuciones, ejecucion } = registrarEjecucion(
      {},
      'nexdms',
      {
        integracion: 'Sincronía Odoo',
        nombre: 'Sincronía con Odoo',
        estado: 'ok',
        mensaje: '48 facturas',
        duracionMs: 1520,
        cadaMinutos: 60
      },
      AHORA
    );
    assert.equal(ejecucion.clave, 'nexdms/sincron-a-odoo');
    assert.equal(ejecucion.nombre, 'Sincronía con Odoo');
    assert.equal(ejecucion.resultado, 'ok');
    assert.equal(ejecucion.corridas, 1);
    assert.equal(ejecucion.terminoEn, AHORA.toISOString());
    assert.equal(ejecucion.ultimoOkEn, AHORA.toISOString());
    assert.equal(Object.keys(ejecuciones).length, 1);
  });

  it('acepta ok: false como error y cuenta los errores seguidos', () => {
    const uno = registrarEjecucion(
      {},
      'nexdms',
      { integracion: 'barrido', ok: false, mensaje: 'timeout' },
      AHORA
    ).ejecuciones;
    const dos = registrarEjecucion(
      uno,
      'nexdms',
      { integracion: 'barrido', ok: false },
      new Date(AHORA.getTime() + 60_000)
    ).ejecucion;
    assert.equal(dos.resultado, 'error');
    assert.equal(dos.erroresSeguidos, 2);
    assert.equal(dos.corridas, 2);
    const tres = registrarEjecucion(
      { [dos.clave]: dos },
      'nexdms',
      { integracion: 'barrido', ok: true },
      new Date(AHORA.getTime() + 120_000)
    ).ejecucion;
    assert.equal(tres.erroresSeguidos, 0);
    assert.equal(tres.ultimoErrorEn, dos.terminoEn);
  });

  it('exige integración y estado', () => {
    assert.throws(
      () => registrarEjecucion({}, 'x', { estado: 'ok' }, AHORA),
      /integracion/
    );
    assert.throws(
      () =>
        registrarEjecucion(
          {},
          'x',
          { integracion: 'a', estado: 'raro' },
          AHORA
        ),
      /estado/
    );
  });

  it('la marca atrasada cuando pasó la frecuencia esperada con holgura', () => {
    const { ejecucion } = registrarEjecucion(
      {},
      'nexdms',
      { integracion: 'cron', estado: 'ok', cadaMinutos: 60 },
      AHORA
    );
    assert.equal(
      estadoDe(ejecucion, new Date(AHORA.getTime() + 80 * 60_000)),
      'ok'
    );
    assert.equal(
      estadoDe(ejecucion, new Date(AHORA.getTime() + 95 * 60_000)),
      'atrasada'
    );
  });

  it('lista lo que está mal primero', () => {
    let e = registrarEjecucion(
      {},
      'a',
      { integracion: 'bien', estado: 'ok' },
      AHORA
    ).ejecuciones;
    e = registrarEjecucion(
      e,
      'a',
      { integracion: 'mal', estado: 'error' },
      AHORA
    ).ejecuciones;
    e = registrarEjecucion(
      e,
      'a',
      { integracion: 'meh', estado: 'aviso' },
      AHORA
    ).ejecuciones;
    assert.deepEqual(
      listarEjecuciones(e, AHORA).map((x) => x.integracion),
      ['mal', 'meh', 'bien']
    );
  });
});
