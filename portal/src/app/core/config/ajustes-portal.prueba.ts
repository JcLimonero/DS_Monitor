import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Account, AjustesPortal } from '../models';
import {
  EMPTY_SETTINGS,
  LocalSettings,
  mailConnection
} from './local-settings';
import {
  aplicarAjustesServidor,
  apagadasAProposito,
  ajustesParaSubir,
  hayAjustesLocales,
  normalizarAjustes,
  servidorTieneAjustes,
  sinAjustesDeCuentas
} from './ajustes-portal';
import { PORTAL_DEFAULTS } from './portal-defaults';
import { PortalConfig } from './portal-config.model';

const BASE: PortalConfig = {
  ...(PORTAL_DEFAULTS as PortalConfig),
  gatewayUrl: 'http://localhost:8786'
};

const buzon = (id: string, extra: Partial<Account> = {}): Account => ({
  id,
  label: 'Ventas',
  detail: 'ventas@ejemplo.mx · IMAP',
  kind: 'imap',
  color: 'sky',
  enabled: true,
  ...extra
});

const ajustes = (parcial: Partial<AjustesPortal> = {}): AjustesPortal => ({
  cuentasApagadas: {},
  modos: {},
  buzonesAgregados: [],
  buzonesQuitados: [],
  actualizadoEn: '2026-10-02T12:00:00.000Z',
  actualizadoPor: 'admin@ejemplo.mx',
  ...parcial
});

describe('servidorTieneAjustes', () => {
  it('vacio (sin fecha) o ausente: nadie ha guardado nada', () => {
    assert.equal(servidorTieneAjustes(undefined), false);
    assert.equal(servidorTieneAjustes(ajustes({ actualizadoEn: '' })), false);
    assert.equal(servidorTieneAjustes(ajustes()), true);
  });
});

describe('normalizarAjustes', () => {
  it('rellena lo que falte y tira lo que no es del tipo', () => {
    const a = normalizarAjustes({
      cuentasApagadas: { claude: false, raro: 'no' },
      modos: { a: 'gateway', b: 'local' },
      buzonesAgregados: [buzon('correo-x'), null, { sinId: true }],
      buzonesQuitados: ['correo-y', 7]
    });
    assert.deepEqual(a?.cuentasApagadas, { claude: false });
    assert.deepEqual(a?.modos, { a: 'gateway' });
    assert.equal(a?.buzonesAgregados.length, 1);
    assert.deepEqual(a?.buzonesQuitados, ['correo-y']);
    assert.equal(a?.actualizadoEn, '');
  });

  it('algo que no es un objeto no cuenta', () => {
    assert.equal(normalizarAjustes(null), undefined);
    assert.equal(normalizarAjustes('x'), undefined);
    assert.equal(normalizarAjustes([]), undefined);
  });
});

describe('aplicarAjustesServidor', () => {
  it('apaga, cambia el modo, agrega y quita buzones sobre la fabrica', () => {
    const r = aplicarAjustesServidor(
      BASE,
      ajustes({
        cuentasApagadas: { claude: false, 'correo-gmail': false },
        modos: { 'claude-consumo': 'gateway' },
        buzonesAgregados: [buzon('correo-ventas')],
        buzonesQuitados: ['correo-icloud']
      })
    );
    const ids = r.accounts.map((a) => a.id);
    assert.ok(ids.includes('correo-ventas'));
    assert.ok(!ids.includes('correo-icloud'));
    assert.equal(r.accounts.find((a) => a.id === 'claude')?.enabled, false);
    assert.equal(
      r.accounts.find((a) => a.id === 'correo-gmail')?.enabled,
      false
    );
    assert.equal(
      r.accounts.find((a) => a.id === 'correo-nexus')?.enabled,
      true
    );
    // El buzon nuevo trae su conexion; el quitado ya no tiene la suya.
    assert.deepEqual(
      r.connections.find((c) => c.accountId === 'correo-ventas'),
      mailConnection(buzon('correo-ventas'))
    );
    assert.ok(!r.connections.some((c) => c.accountId === 'correo-icloud'));
    assert.equal(
      r.connections.find((c) => c.id === 'claude-consumo')?.mode,
      'gateway'
    );
  });

  it('no toca la configuracion de fabrica que recibe', () => {
    const antes = JSON.stringify(BASE);
    aplicarAjustesServidor(
      BASE,
      ajustes({
        cuentasApagadas: { claude: false },
        buzonesQuitados: ['correo-icloud']
      })
    );
    assert.equal(JSON.stringify(BASE), antes);
  });

  it('los ajustes del servidor mandan: lo local ya no cuenta', () => {
    // El servidor dice "ninguno apagado"; aunque el navegador tenga uno, la
    // configuracion se arma solo con lo del servidor.
    const r = aplicarAjustesServidor(BASE, ajustes());
    assert.equal(
      r.accounts.find((a) => a.id === 'correo-gmail')?.enabled,
      BASE.accounts.find((a) => a.id === 'correo-gmail')?.enabled
    );
  });
});

describe('apagadasAProposito', () => {
  it('solo las que quedaron en falso', () => {
    assert.deepEqual(
      [...apagadasAProposito({ a: false, b: true, c: false })].sort(),
      ['a', 'c']
    );
  });
});

describe('ajustes locales: detectar, subir y limpiar', () => {
  const local = (parcial: Partial<LocalSettings> = {}): LocalSettings => ({
    ...EMPTY_SETTINGS,
    ...parcial
  });

  it('hayAjustesLocales mira solo cuentas y modos, no licencias', () => {
    assert.equal(hayAjustesLocales(local()), false);
    assert.equal(
      hayAjustesLocales(local({ licenseEdits: { x: { cost: 3 } } })),
      false
    );
    assert.equal(
      hayAjustesLocales(local({ accounts: [buzon('correo-a')] })),
      true
    );
    assert.equal(
      hayAjustesLocales(local({ removedAccounts: ['correo-a'] })),
      true
    );
    assert.equal(
      hayAjustesLocales(local({ accountEnabled: { a: false } })),
      true
    );
    assert.equal(
      hayAjustesLocales(local({ connectionMode: { a: 'demo' } })),
      true
    );
  });

  it('ajustesParaSubir deja fuera lo que el puente rechazaria', () => {
    const subir = ajustesParaSubir(
      local({
        accounts: [
          buzon('correo-a'),
          buzon('correo-a'),
          buzon('otro-b'),
          buzon('correo-c', { kind: 'odoo' }),
          buzon('correo-d', { color: 'chartreuse' as Account['color'] })
        ],
        accountEnabled: { claude: false, 'No Valido': true },
        connectionMode: {
          'odoo-itech': 'gateway',
          'pendientes-locales': 'local'
        },
        removedAccounts: ['correo-icloud', 'itech', 'correo-icloud']
      })
    );
    assert.deepEqual(
      subir.buzonesAgregados.map((a) => a.id),
      ['correo-a']
    );
    assert.deepEqual(subir.cuentasApagadas, { claude: false });
    assert.deepEqual(subir.modos, { 'odoo-itech': 'gateway' });
    assert.deepEqual(subir.buzonesQuitados, ['correo-icloud']);
  });

  it('sinAjustesDeCuentas limpia los cuatro campos y respeta las licencias', () => {
    const limpio = sinAjustesDeCuentas(
      local({
        accounts: [buzon('correo-a')],
        accountEnabled: { a: false },
        removedAccounts: ['correo-b'],
        connectionMode: { a: 'demo' },
        licenseEdits: { x: { cost: 3 } }
      })
    );
    assert.equal(hayAjustesLocales(limpio), false);
    assert.deepEqual(limpio.licenseEdits, { x: { cost: 3 } });
  });
});
