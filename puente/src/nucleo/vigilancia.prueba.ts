import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { MonitorTarget } from './contrato.js';
import { avisosDeSitios } from './vigilancia.js';

const AHORA = new Date('2026-09-18T12:00:00Z');

const sitio = (
  id: string,
  status: MonitorTarget['status'],
  extra: Partial<MonitorTarget> = {}
): MonitorTarget => ({
  id,
  name: id,
  kind: 'sitio',
  url: `https://${id}`,
  environment: 'produccion',
  status,
  uptime24h: 100,
  uptime30d: 100,
  history: [],
  accountId: 'monitoreo',
  ...extra
});

describe('avisosDeSitios', () => {
  it('avisa una vez cuando cae y otra cuando vuelve', () => {
    const caido = [sitio('vgd.com.mx', 'caido', { incident: 'HTTP 502' })];
    const uno = avisosDeSitios(caido, {}, AHORA);
    assert.equal(uno.lineas.length, 1);
    assert.match(uno.lineas[0]!, /🔴.*vgd\.com\.mx.*caído: HTTP 502/);
    // Sigue caido: nada nuevo.
    assert.deepEqual(avisosDeSitios(caido, uno.avisados, AHORA).lineas, []);
    // Vuelve.
    const vuelta = avisosDeSitios(
      [sitio('vgd.com.mx', 'operativo')],
      uno.avisados,
      new Date(AHORA.getTime() + 25 * 60_000)
    );
    assert.match(vuelta.lineas[0]!, /🟢.*volvió después de 25 min/);
    assert.deepEqual(vuelta.avisados, {});
  });

  it('degradado o desconocido no cuentan como caído ni como regreso', () => {
    const uno = avisosDeSitios([sitio('a', 'caido')], {}, AHORA);
    const sinDato = avisosDeSitios(
      [sitio('a', 'desconocido')],
      uno.avisados,
      AHORA
    );
    assert.deepEqual(sinDato.lineas, []);
    assert.deepEqual(sinDato.avisados, uno.avisados);
    assert.deepEqual(
      avisosDeSitios([sitio('b', 'degradado')], {}, AHORA).lineas,
      []
    );
  });

  it('escapa el HTML del nombre y del incidente', () => {
    const r = avisosDeSitios(
      [sitio('x', 'caido', { name: 'A <b>', incident: '<img>' })],
      {},
      AHORA
    );
    assert.match(r.lineas[0]!, /A &lt;b&gt;.*&lt;img&gt;/);
  });
});
