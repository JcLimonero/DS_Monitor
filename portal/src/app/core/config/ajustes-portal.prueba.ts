import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Account, AjustesPortal } from '../models';
import {
  EMPTY_SETTINGS,
  accountIdFor,
  LocalSettings,
  mailConnection
} from './local-settings';
import {
  aplicarAjustesServidor,
  conSoloOmitidos,
  cuerpoDeGuardado,
  parchesDeFusion,
  prepararSubida,
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

describe('cuerpoDeGuardado (primer guardado contra un servidor vacío)', () => {
  const local: LocalSettings = {
    ...EMPTY_SETTINGS,
    accounts: [buzon('correo-local')],
    accountEnabled: { claude: false },
    removedAccounts: ['correo-icloud'],
    connectionMode: { 'odoo-itech': 'gateway' },
    licenseEdits: { x: { cost: 3 } }
  };

  it('servidor vacío + local no vacío: documento completo con el cambio encima', () => {
    const r = cuerpoDeGuardado(true, local, {
      cuentaEnabled: { id: 'plataformas', enabled: false }
    });
    assert.equal(r.subeLocal, true);
    assert.deepEqual(r.cuerpo, {
      ajustes: {
        cuentasApagadas: { claude: false, plataformas: false },
        modos: { 'odoo-itech': 'gateway' },
        buzonesAgregados: [buzon('correo-local')],
        buzonesQuitados: ['correo-icloud']
      }
    });
  });

  it('el cambio manda sobre lo local (quitar el buzón local, cambiar un modo)', () => {
    const r = cuerpoDeGuardado(true, local, { quitarBuzon: 'correo-local' });
    const doc = (r.cuerpo['ajustes'] ?? {}) as Record<string, unknown>;
    assert.deepEqual(doc['buzonesAgregados'], []);
    assert.deepEqual(doc['buzonesQuitados'], ['correo-icloud']);
    const m = cuerpoDeGuardado(true, local, {
      modo: { id: 'odoo-itech', modo: 'demo' }
    });
    assert.deepEqual((m.cuerpo['ajustes'] as { modos: unknown }).modos, {
      'odoo-itech': 'demo'
    });
  });

  it('servidor con ajustes: solo el parche', () => {
    const parche = { cuentaEnabled: { id: 'claude', enabled: true } };
    const r = cuerpoDeGuardado(false, local, parche);
    assert.equal(r.subeLocal, false);
    assert.deepEqual(r.cuerpo, parche);
  });

  it('servidor vacío + local vacío: solo el parche', () => {
    const parche = { agregarBuzon: buzon('correo-nuevo') };
    const r = cuerpoDeGuardado(true, EMPTY_SETTINGS, parche);
    assert.equal(r.subeLocal, false);
    assert.deepEqual(r.cuerpo, parche);
  });

  it('las licencias del navegador no cuentan como ajustes locales', () => {
    const soloLicencias = {
      ...EMPTY_SETTINGS,
      licenseEdits: { x: { cost: 3 } }
    };
    const r = cuerpoDeGuardado(true, soloLicencias, {
      cuentaEnabled: { id: 'claude', enabled: false }
    });
    assert.equal(r.subeLocal, false);
  });
});

describe('prepararSubida: lo que no se sube se conserva y se explica', () => {
  const raro: LocalSettings = {
    ...EMPTY_SETTINGS,
    accounts: [
      buzon('correo-ok'),
      buzon('otro-b'),
      buzon(`correo-${'a'.repeat(80)}`),
      buzon('correo-c', { kind: 'odoo' })
    ],
    accountEnabled: { claude: false, 'No Valido': true },
    connectionMode: { 'odoo-itech': 'gateway', 'pendientes-locales': 'local' },
    removedAccounts: ['correo-icloud', 'itech']
  };

  it('parte el documento y los omitidos, con motivos y total', () => {
    const { documento, omitidos } = prepararSubida(raro);
    assert.deepEqual(
      documento.buzonesAgregados.map((a) => a.id),
      ['correo-ok']
    );
    assert.deepEqual(documento.cuentasApagadas, { claude: false });
    assert.deepEqual(documento.modos, { 'odoo-itech': 'gateway' });
    assert.deepEqual(documento.buzonesQuitados, ['correo-icloud']);
    assert.equal(omitidos.accounts.length, 3);
    assert.deepEqual(omitidos.accountEnabled, { 'No Valido': true });
    assert.deepEqual(omitidos.connectionMode, {
      'pendientes-locales': 'local'
    });
    assert.deepEqual(omitidos.removedAccounts, ['itech']);
    assert.equal(omitidos.total, 6);
    assert.ok(omitidos.motivos.some((m) => /modo «local»/.test(m)));
    assert.ok(omitidos.motivos.some((m) => /demasiado largo/.test(m)));
  });

  it('conSoloOmitidos deja en el navegador solo lo que no se subió', () => {
    const { omitidos } = prepararSubida(raro);
    const resto = conSoloOmitidos(
      { ...raro, licenseEdits: { x: { cost: 3 } } },
      omitidos
    );
    assert.equal(resto.accounts.length, 3);
    assert.deepEqual(resto.removedAccounts, ['itech']);
    assert.deepEqual(resto.licenseEdits, { x: { cost: 3 } });
    // Lo que queda ya no tiene nada que subir.
    const otra = prepararSubida(resto);
    assert.equal(otra.documento.buzonesAgregados.length, 0);
    assert.equal(otra.omitidos.total, omitidos.total);
  });

  it('con solo cosas no subibles, el primer guardado manda el parche', () => {
    const solo = { ...EMPTY_SETTINGS, removedAccounts: ['itech'] };
    const parche = { cuentaEnabled: { id: 'claude', enabled: false } };
    const r = cuerpoDeGuardado(true, solo, parche);
    assert.equal(r.subeLocal, false);
    assert.deepEqual(r.cuerpo, parche);
  });
});

describe('parchesDeFusion (otro dispositivo subió primero)', () => {
  const local: LocalSettings = {
    ...EMPTY_SETTINGS,
    accounts: [buzon('correo-uno'), buzon('correo-comun')],
    accountEnabled: { claude: false, cursor: false },
    connectionMode: { a: 'gateway', b: 'demo' },
    removedAccounts: ['correo-icloud', 'correo-gmail']
  };
  const servidor = ajustes({
    buzonesAgregados: [buzon('correo-comun'), buzon('correo-dos')],
    cuentasApagadas: { cursor: true },
    modos: { b: 'gateway' },
    buzonesQuitados: ['correo-icloud']
  });

  it('manda solo lo que al servidor le falta; en los mapas gana el servidor', () => {
    const p = parchesDeFusion(servidor, local);
    assert.deepEqual(p, [
      { agregarBuzon: buzon('correo-uno') },
      { cuentaEnabled: { id: 'claude', enabled: false } },
      { modo: { id: 'a', modo: 'gateway' } },
      { quitarBuzon: 'correo-gmail' }
    ]);
  });

  it('nunca manda un documento completo y no repite lo que ya está', () => {
    const p = parchesDeFusion(servidor, local);
    assert.ok(p.every((x) => Object.keys(x).length === 1));
    assert.deepEqual(parchesDeFusion(ajustes(), EMPTY_SETTINGS), []);
  });

  it('no quita un buzón que el servidor tiene agregado ni agrega uno que quitó', () => {
    const s = ajustes({
      buzonesAgregados: [buzon('correo-gmail')],
      buzonesQuitados: ['correo-uno']
    });
    const p = parchesDeFusion(s, local);
    assert.ok(!p.some((x) => x.quitarBuzon === 'correo-gmail'));
    assert.ok(!p.some((x) => x.agregarBuzon?.id === 'correo-uno'));
  });
});

describe('accountIdFor con etiquetas largas', () => {
  it('recorta el id para que el puente lo acepte (máx. 64) y sigue siendo único', () => {
    const largo =
      'Buzón de la oficina de ventas de la sucursal norte del grupo';
    const id = accountIdFor(largo, new Set());
    assert.ok(id.length <= 64, id);
    assert.ok(id.startsWith('correo-'));
    const otro = accountIdFor(largo, new Set([id]));
    assert.notEqual(otro, id);
    assert.ok(otro.length <= 64, otro);
    assert.ok(!/-$/.test(id));
  });

  it('una etiqueta corta queda igual que siempre', () => {
    assert.equal(accountIdFor('Ventas', new Set()), 'correo-ventas');
    assert.equal(
      accountIdFor('Ventas', new Set(['correo-ventas'])),
      'correo-ventas-2'
    );
  });
});
