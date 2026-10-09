import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { PersistenciaArchivos } from '../datos/persistencia.js';
import { AlmacenCorreo } from './almacen-correo.js';
import {
  appPropiaDe,
  esGuid,
  esTenantValido,
  ocultarSecretos,
  validarAppPropia
} from './app-propia.js';

// Solo valores falsos de prueba.
const ID_GENERAL = '11111111-1111-4111-8111-111111111111';
const ID_PROPIO = '22222222-2222-4222-8222-222222222222';
const ID_OTRO = '33333333-3333-4333-8333-333333333333';
const TENANT = '44444444-4444-4444-8444-444444444444';
const SECRETO_GENERAL = 'secreto-general-falso~123';
const SECRETO_PROPIO = 'secreto-propio-falso~456';

const GENERAL = {
  tenant: 'common',
  clientId: ID_GENERAL,
  clientSecret: SECRETO_GENERAL
};

const dirs: string[] = [];
after(async () => {
  for (const d of dirs) {
    await rm(d, { recursive: true, force: true });
  }
});

async function almacenNuevo() {
  const dir = await mkdtemp(join(tmpdir(), 'puente-appprop-'));
  dirs.push(dir);
  const persistencia = new PersistenciaArchivos({ correo: dir });
  const almacen = new AlmacenCorreo(persistencia);
  await almacen.cargar();
  return { almacen, persistencia };
}

describe('validacion de la aplicacion propia', () => {
  it('acepta GUID, dominio y los tenants especiales; rechaza el resto', () => {
    for (const bueno of [
      TENANT,
      'common',
      'organizations',
      'consumers',
      'itechdev.onmicrosoft.com'
    ]) {
      assert.equal(esTenantValido(bueno), true, bueno);
    }
    for (const malo of [
      '',
      'no es tenant',
      '../x',
      'a/b',
      'x?y=1',
      `${TENANT}/oauth2`,
      'sinpunto',
      'a'.repeat(300)
    ]) {
      assert.equal(esTenantValido(malo), false, malo);
    }
    assert.equal(esGuid(ID_PROPIO), true);
    assert.equal(esGuid('no-guid'), false);
  });

  it('pone una aplicacion nueva con ID y secreto', () => {
    const r = validarAppPropia(
      { clientId: ID_PROPIO.toUpperCase(), clientSecret: SECRETO_PROPIO },
      undefined
    );
    assert.deepEqual(r, {
      ok: true,
      tenant: undefined,
      quitar: false,
      app: { clientId: ID_PROPIO, clientSecret: SECRETO_PROPIO }
    });
  });

  it('vacio = sin cambio; un espacio = quitar', () => {
    const actual = { clientId: ID_PROPIO, clientSecret: SECRETO_PROPIO };
    assert.deepEqual(
      validarAppPropia({ clientId: ID_PROPIO, clientSecret: '' }, actual),
      { ok: true, tenant: undefined, quitar: false }
    );
    assert.deepEqual(validarAppPropia({}, undefined), {
      ok: true,
      tenant: undefined,
      quitar: false
    });
    assert.deepEqual(
      validarAppPropia({ clientId: ID_PROPIO, clientSecret: ' ' }, actual),
      { ok: true, tenant: undefined, quitar: true }
    );
  });

  it('rota el secreto con el mismo ID, pero cambiar el ID exige secreto', () => {
    const actual = { clientId: ID_PROPIO, clientSecret: SECRETO_PROPIO };
    const rota = validarAppPropia(
      { clientSecret: 'otro-secreto-falso~9' },
      actual
    );
    assert.equal(rota.ok && rota.app?.clientId, ID_PROPIO);
    const cambia = validarAppPropia({ clientId: ID_OTRO }, actual);
    assert.equal(cambia.ok, false);
    const sinId = validarAppPropia({ clientSecret: SECRETO_PROPIO }, undefined);
    assert.equal(sinId.ok, false);
    const sinSecreto = validarAppPropia({ clientId: ID_OTRO }, undefined);
    assert.equal(sinSecreto.ok, false);
  });

  it('rechaza entradas invalidas sin repetir su valor en el error', () => {
    const casos: Record<string, unknown>[] = [
      { clientId: 'no-es-guid-<script>', clientSecret: SECRETO_PROPIO },
      { clientId: ID_PROPIO, clientSecret: 'corto' },
      { clientId: ID_PROPIO, clientSecret: 'con espacio dentro 1234' },
      { clientId: ID_PROPIO, clientSecret: `${'x'.repeat(300)}` },
      { tenant: 'tenant/../malo' },
      { tenant: 5 },
      { clientId: { a: 1 } },
      { clientSecret: ['x'] }
    ];
    for (const caso of casos) {
      const r = validarAppPropia(caso, undefined);
      assert.equal(r.ok, false, JSON.stringify(caso));
      if (!r.ok) {
        for (const valor of Object.values(caso)) {
          if (typeof valor === 'string') {
            assert.ok(!r.error.includes(valor), 'el error repite el valor');
          }
        }
      }
    }
  });

  it('ocultarSecretos quita el valor literal y respeta lo corto', () => {
    assert.equal(
      ocultarSecretos(`mal ${SECRETO_PROPIO} y ${SECRETO_PROPIO}`, [
        SECRETO_PROPIO,
        undefined
      ]),
      'mal [oculto] y [oculto]'
    );
    assert.equal(ocultarSecretos('hola', ['']), 'hola');
  });

  it('appPropiaDe exige los dos y tolera basura', () => {
    assert.equal(appPropiaDe({ clientId: ID_PROPIO }), undefined);
    assert.equal(appPropiaDe({ clientSecret: SECRETO_PROPIO }), undefined);
    assert.equal(appPropiaDe({ clientId: 5, clientSecret: {} }), undefined);
    assert.equal(appPropiaDe(undefined), undefined);
    assert.deepEqual(
      appPropiaDe({ clientId: ID_PROPIO, clientSecret: SECRETO_PROPIO }),
      { clientId: ID_PROPIO, clientSecret: SECRETO_PROPIO }
    );
  });
});

describe('almacen de buzones con aplicacion propia', () => {
  it('sin aplicacion propia usa la general (comportamiento de siempre)', async () => {
    const { almacen } = await almacenNuevo();
    await almacen.guardar('a', {
      proveedor: 'microsoft',
      usuario: 'a@falso.test'
    });
    const e = almacen.efectiva('a', undefined, 30, GENERAL);
    assert.equal(e?.microsoft?.clientId, ID_GENERAL);
    assert.equal(e?.microsoft?.clientSecret, SECRETO_GENERAL);
    assert.equal(e?.microsoft?.tenant, 'common');
  });

  it('un buzon con app propia no usa la general y los demas siguen igual', async () => {
    const { almacen } = await almacenNuevo();
    await almacen.guardar('itech', {
      proveedor: 'microsoft',
      usuario: 'i@falso.test',
      microsoft: {
        tenant: TENANT,
        clientId: ID_PROPIO,
        clientSecret: SECRETO_PROPIO
      }
    });
    await almacen.guardar('otro', {
      proveedor: 'microsoft',
      usuario: 'o@falso.test'
    });
    const itech = almacen.efectiva('itech', undefined, 30, GENERAL);
    assert.deepEqual(
      [
        itech?.microsoft?.clientId,
        itech?.microsoft?.clientSecret,
        itech?.microsoft?.tenant
      ],
      [ID_PROPIO, SECRETO_PROPIO, TENANT]
    );
    const otro = almacen.efectiva('otro', undefined, 30, GENERAL);
    assert.deepEqual(
      [
        otro?.microsoft?.clientId,
        otro?.microsoft?.clientSecret,
        otro?.microsoft?.tenant
      ],
      [ID_GENERAL, SECRETO_GENERAL, 'common']
    );
  });

  it('con app propia y sin tenant guardado usa common, no el de la general', async () => {
    const { almacen } = await almacenNuevo();
    await almacen.guardar('itech', {
      proveedor: 'microsoft',
      usuario: 'i@falso.test',
      microsoft: { clientId: ID_PROPIO, clientSecret: SECRETO_PROPIO }
    });
    const e = almacen.efectiva('itech', undefined, 30, {
      ...GENERAL,
      tenant: TENANT
    });
    assert.equal(e?.microsoft?.tenant, 'common');
  });

  it('nunca mezcla un ID propio con el secreto de la general', async () => {
    const { almacen, persistencia } = await almacenNuevo();
    // Dato incompleto, como pudo quedar antes: solo clientId.
    await persistencia.guardar('correo', 'raro', {
      proveedor: 'microsoft',
      usuario: 'r@falso.test',
      microsoft: { clientId: ID_PROPIO },
      actualizadoEn: '2026-01-01T00:00:00.000Z'
    });
    await almacen.cargar();
    const e = almacen.efectiva('raro', undefined, 30, GENERAL);
    assert.equal(e?.microsoft?.clientId, ID_GENERAL);
    assert.equal(e?.microsoft?.clientSecret, SECRETO_GENERAL);
  });

  it('datos guardados antiguos (solo tenant y token) siguen funcionando', async () => {
    const { almacen, persistencia } = await almacenNuevo();
    await persistencia.guardar('correo', 'viejo', {
      proveedor: 'microsoft',
      usuario: 'v@falso.test',
      microsoft: {
        tenant: TENANT,
        refreshToken: 'rt-falso-viejo',
        conectadaComo: 'v@falso.test'
      },
      actualizadoEn: '2026-01-01T00:00:00.000Z'
    });
    await almacen.cargar();
    const e = almacen.efectiva('viejo', undefined, 30, GENERAL);
    assert.equal(e?.microsoft?.clientId, ID_GENERAL);
    assert.equal(e?.microsoft?.tenant, TENANT);
    assert.equal(e?.microsoft?.refreshToken, 'rt-falso-viejo');
  });

  it('datos antiguos con ID y secreto guardados cuentan como aplicacion propia', async () => {
    const { almacen, persistencia } = await almacenNuevo();
    await persistencia.guardar('correo', 'viejo2', {
      proveedor: 'microsoft',
      usuario: 'v@falso.test',
      microsoft: {
        tenant: 'common',
        clientId: ID_PROPIO,
        clientSecret: SECRETO_PROPIO,
        refreshToken: 'rt-falso'
      },
      actualizadoEn: '2026-01-01T00:00:00.000Z'
    });
    await almacen.cargar();
    const e = almacen.efectiva('viejo2', undefined, 30, GENERAL);
    assert.equal(e?.microsoft?.clientId, ID_PROPIO);
    assert.equal(e?.microsoft?.refreshToken, 'rt-falso');
  });

  it('el refresh token de la base/general no se presta a una app propia', async () => {
    const { almacen } = await almacenNuevo();
    await almacen.guardar('itech', {
      proveedor: 'microsoft',
      usuario: 'i@falso.test',
      microsoft: { clientId: ID_PROPIO, clientSecret: SECRETO_PROPIO }
    });
    const e = almacen.efectiva(
      'itech',
      {
        id: 'itech',
        proveedor: 'microsoft',
        host: '',
        puerto: 993,
        usuario: 'i@falso.test',
        contrasena: '',
        accountId: 'itech',
        buzones: ['INBOX'],
        diasAtras: 30,
        microsoft: { ...GENERAL, refreshToken: 'rt-de-la-base' }
      },
      30,
      GENERAL
    );
    assert.equal(e?.microsoft?.clientId, ID_PROPIO);
    assert.equal(e?.microsoft?.refreshToken, undefined);
  });

  it('cambiar o quitar la propia descarta el token; rotar el secreto no', async () => {
    const { almacen } = await almacenNuevo();
    await almacen.guardar('itech', {
      proveedor: 'microsoft',
      usuario: 'i@falso.test',
      microsoft: { clientId: ID_PROPIO, clientSecret: SECRETO_PROPIO }
    });
    // Al conectar (el regreso de OAuth) se guarda el token sin tocar la app.
    await almacen.guardar('itech', {
      microsoft: { refreshToken: 'rt-falso', conectadaComo: 'i@falso.test' }
    });
    assert.equal(almacen.obtener('itech')?.microsoft?.refreshToken, 'rt-falso');
    // Rotar el secreto con el mismo ID conserva el token.
    await almacen.guardar('itech', {
      microsoft: { clientId: ID_PROPIO, clientSecret: 'secreto-rotado-falso~7' }
    });
    assert.equal(almacen.obtener('itech')?.microsoft?.refreshToken, 'rt-falso');
    // Otro ID: el token lo emitio otra aplicacion.
    await almacen.guardar('itech', {
      microsoft: { clientId: ID_OTRO, clientSecret: SECRETO_PROPIO }
    });
    assert.equal(almacen.obtener('itech')?.microsoft?.refreshToken, undefined);
    assert.equal(almacen.obtener('itech')?.microsoft?.conectadaComo, undefined);
    // Quitar la propia: de vuelta a la general, con token nuevo por conectar.
    await almacen.guardar('itech', {
      microsoft: { refreshToken: 'rt-falso-2', conectadaComo: 'i@falso.test' }
    });
    await almacen.guardar(
      'itech',
      { usuario: 'i@falso.test' },
      { quitarAppMicrosoft: true }
    );
    const guardado = almacen.obtener('itech')?.microsoft;
    assert.equal(guardado?.clientId, undefined);
    assert.equal(guardado?.clientSecret, undefined);
    assert.equal(guardado?.refreshToken, undefined);
    const e = almacen.efectiva('itech', undefined, 30, GENERAL);
    assert.equal(e?.microsoft?.clientId, ID_GENERAL);
  });

  it('el tenant solo (sin app propia) conserva el token', async () => {
    const { almacen } = await almacenNuevo();
    await almacen.guardar('a', {
      proveedor: 'microsoft',
      usuario: 'a@falso.test',
      microsoft: { refreshToken: 'rt-falso' }
    });
    await almacen.guardar('a', { microsoft: { tenant: TENANT } });
    assert.equal(almacen.obtener('a')?.microsoft?.refreshToken, 'rt-falso');
  });
});
