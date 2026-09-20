import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { HostedApp, MonitorTarget, VpsStatus } from './contrato.js';
import { avisosDePortales, avisosDeSitios, avisosDeVps } from './vigilancia.js';

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

describe('avisosDeVps', () => {
  const vps = (health: VpsStatus['health'], reason?: string): VpsStatus => ({
    id: 'vps-1',
    name: 'VPS Nexus',
    online: health !== 'sin_senal',
    health,
    reason,
    cpuHistory: [],
    memHistory: [],
    containers: [],
    accountId: 'vps'
  });

  it('avisa al pasar de umbral, otra vez si empeora y cuando vuelve', () => {
    const uno = avisosDeVps([vps('aviso', 'disco al 86 %')], {}, AHORA);
    assert.match(uno.lineas[0]!, /🟠.*VPS Nexus.*aviso — disco al 86 %/);
    assert.deepEqual(
      avisosDeVps([vps('aviso', 'disco al 87 %')], uno.avisados, AHORA).lineas,
      []
    );
    const peor = avisosDeVps(
      [vps('critico', 'disco al 96 %')],
      uno.avisados,
      AHORA
    );
    assert.match(peor.lineas[0]!, /🔴.*crítico/);
    const bien = avisosDeVps(
      [vps('bien')],
      peor.avisados,
      new Date(AHORA.getTime() + 3600_000)
    );
    assert.match(bien.lineas[0]!, /🟢.*volvió a estar bien después de 1.0 h/);
    assert.deepEqual(bien.avisados, {});
  });

  it('sin señal también avisa', () => {
    assert.match(
      avisosDeVps([vps('sin_senal', 'No reporta')], {}, AHORA).lineas[0]!,
      /📡.*sin señal/
    );
  });
});

describe('avisosDePortales', () => {
  const portal = (
    status: HostedApp['status'],
    healthy?: boolean
  ): HostedApp => ({
    id: 'app-1',
    name: 'Portal Vanguardia',
    kind: 'app',
    status,
    healthy,
    server: 'nexus-1',
    url: 'https://vgd.com.mx',
    accountId: 'coolify'
  });

  it('avisa cuando se detiene y cuando vuelve', () => {
    const uno = avisosDePortales([portal('stopped')], {}, AHORA);
    assert.match(
      uno.lineas[0]!,
      /🟥.*Portal Vanguardia.*\(nexus-1\): portal detenido/
    );
    assert.deepEqual(
      avisosDePortales([portal('stopped')], uno.avisados, AHORA).lineas,
      []
    );
    const vuelta = avisosDePortales(
      [portal('running', true)],
      uno.avisados,
      new Date(AHORA.getTime() + 10 * 60_000)
    );
    assert.match(vuelta.lineas[0]!, /🟩.*volvió después de 10 min/);
    assert.deepEqual(vuelta.avisados, {});
  });

  it('corriendo pero sin salud también avisa', () => {
    assert.match(
      avisosDePortales([portal('running', false)], {}, AHORA).lineas[0]!,
      /sin salud/
    );
  });
});
