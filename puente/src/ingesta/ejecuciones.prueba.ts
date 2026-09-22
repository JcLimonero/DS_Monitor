import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  actualizarEspera,
  avisosPendientes,
  estadoDe,
  listarEjecuciones,
  minutosEntreDias,
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

  it('una frecuencia corta no adelanta la regla: más de una hora callada', () => {
    const { ejecucion } = registrarEjecucion(
      {},
      'nexdms',
      { integracion: 'rapido', estado: 'ok', cadaMinutos: 15 },
      AHORA
    );
    assert.equal(
      estadoDe(ejecucion, new Date(AHORA.getTime() + 45 * 60_000)),
      'ok'
    );
    assert.equal(
      estadoDe(ejecucion, new Date(AHORA.getTime() + 61 * 60_000)),
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

  it('sin frecuencia declarada, una hora callada ya es atrasada', () => {
    const { ejecucion } = registrarEjecucion(
      {},
      'nexdms',
      { integracion: 'cron', estado: 'ok' },
      AHORA
    );
    assert.equal(
      estadoDe(ejecucion, new Date(AHORA.getTime() + 59 * 60_000)),
      'ok'
    );
    assert.equal(
      estadoDe(ejecucion, new Date(AHORA.getTime() + 61 * 60_000)),
      'atrasada'
    );
  });

  it('actualizarEspera cambia la frecuencia sin contar otra corrida', () => {
    const { ejecuciones, ejecucion } = registrarEjecucion(
      {},
      'ds-monitor',
      { integracion: 'sin asignar', estado: 'ok', cadaMinutos: 15 },
      AHORA
    );
    const siguiente = actualizarEspera(
      ejecuciones,
      'ds-monitor',
      'sin asignar',
      7 * 24 * 60
    );
    assert.equal(siguiente?.[ejecucion.clave]?.cadaMinutos, 7 * 24 * 60);
    assert.equal(siguiente?.[ejecucion.clave]?.corridas, 1);
    assert.equal(siguiente?.[ejecucion.clave]?.terminoEn, ejecucion.terminoEn);
    assert.equal(
      estadoDe(
        siguiente![ejecucion.clave]!,
        new Date(AHORA.getTime() + 2 * 60 * 60_000)
      ),
      'ok'
    );
  });

  it('minutosEntreDias toma el hueco más largo de la semana', () => {
    assert.equal(minutosEntreDias([1]), 7 * 24 * 60);
    assert.equal(minutosEntreDias([2, 4]), 5 * 24 * 60);
    assert.equal(minutosEntreDias([0, 1, 2, 3, 4, 5, 6]), 24 * 60);
  });
});

describe('avisosPendientes (Telegram)', () => {
  const minutos = (n: number) => new Date(AHORA.getTime() + n * 60_000);

  it('avisa una vez cuando pasa más de una hora sin señal y otra cuando vuelve', () => {
    let e = registrarEjecucion(
      {},
      'totalone',
      {
        integracion: 'odoo-sync',
        nombre: 'Sincronía con Odoo',
        estado: 'ok',
        cadaMinutos: 15
      },
      AHORA
    ).ejecuciones;
    // A los 30 min ni la pantalla ni Telegram dicen nada: la regla es una hora.
    assert.equal(estadoDe(Object.values(e)[0]!, minutos(30)), 'ok');
    assert.deepEqual(avisosPendientes(e, {}, minutos(30)).lineas, []);

    const uno = avisosPendientes(e, {}, minutos(61));
    assert.equal(uno.lineas.length, 1);
    assert.match(
      uno.lineas[0]!,
      /Sincronía con Odoo.*sin señal desde hace 1 h/
    );
    // En la siguiente vuelta, nada nuevo.
    assert.deepEqual(avisosPendientes(e, uno.avisadas, minutos(71)).lineas, []);

    e = registrarEjecucion(
      e,
      'totalone',
      { integracion: 'odoo-sync', estado: 'ok' },
      minutos(80)
    ).ejecuciones;
    const vuelta = avisosPendientes(e, uno.avisadas, minutos(81));
    assert.equal(vuelta.lineas.length, 1);
    assert.match(vuelta.lineas[0]!, /volvió a reportar/);
    assert.deepEqual(vuelta.avisadas, {});
  });

  it('respeta una frecuencia declarada mayor a una hora', () => {
    const e = registrarEjecucion(
      {},
      'totalone',
      { integracion: 'reportes', estado: 'ok', cadaMinutos: 1440 },
      AHORA
    ).ejecuciones;
    assert.deepEqual(avisosPendientes(e, {}, minutos(5 * 60)).lineas, []);
    assert.equal(avisosPendientes(e, {}, minutos(37 * 60)).lineas.length, 1);
  });

  it('una tarea semanal no se marca atrasada a las dos horas', () => {
    const { ejecucion } = registrarEjecucion(
      {},
      'ds-monitor',
      { integracion: 'sin asignar', estado: 'ok', cadaMinutos: 7 * 24 * 60 },
      AHORA
    );
    assert.equal(
      estadoDe(ejecucion, new Date(AHORA.getTime() + 2 * 60 * 60_000)),
      'ok'
    );
    assert.equal(
      estadoDe(ejecucion, new Date(AHORA.getTime() + 8 * 24 * 60 * 60_000)),
      'ok'
    );
    assert.equal(
      estadoDe(ejecucion, new Date(AHORA.getTime() + 11 * 24 * 60 * 60_000)),
      'atrasada'
    );
  });

  it('avisa el primer error de la racha, no cada fallo, y cuando vuelve a estar bien', () => {
    let e = registrarEjecucion(
      {},
      'nexdms',
      { integracion: 'barrido', ok: false, mensaje: 'timeout' },
      AHORA
    ).ejecuciones;
    const uno = avisosPendientes(e, {}, minutos(1));
    assert.equal(uno.lineas.length, 1);
    assert.match(uno.lineas[0]!, /❌.*barrido.*timeout/);

    e = registrarEjecucion(
      e,
      'nexdms',
      { integracion: 'barrido', ok: false },
      minutos(15)
    ).ejecuciones;
    assert.deepEqual(avisosPendientes(e, uno.avisadas, minutos(16)).lineas, []);

    e = registrarEjecucion(
      e,
      'nexdms',
      { integracion: 'barrido', ok: true },
      minutos(30)
    ).ejecuciones;
    const bien = avisosPendientes(e, uno.avisadas, minutos(31));
    assert.match(bien.lineas[0]!, /volvió a correr bien/);
    assert.deepEqual(bien.avisadas, {});
  });

  it('escapa el HTML de lo que manda la aplicación', () => {
    const e = registrarEjecucion(
      {},
      'x',
      { integracion: 'a', ok: false, mensaje: '<script>alert(1)</script>' },
      AHORA
    ).ejecuciones;
    assert.match(
      avisosPendientes(e, {}, minutos(1)).lineas[0]!,
      /&lt;script&gt;/
    );
  });
});
