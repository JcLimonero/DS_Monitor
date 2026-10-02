import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AJUSTES_VACIOS,
  MAX_BUZONES,
  aplicarParche,
  validarBuzon,
  validarDocumento,
  type AjustesPortal
} from './ajustes-portal.js';

const AHORA = '2026-10-02T12:00:00.000Z';
const POR = 'admin@ejemplo.mx';

const buzon = (id = 'correo-nuevo', extra: Record<string, unknown> = {}) => ({
  id,
  label: 'Nuevo',
  detail: 'nuevo@ejemplo.mx · IMAP',
  kind: 'imap',
  color: 'sky',
  enabled: true,
  ...extra
});

describe('validarBuzon', () => {
  it('acepta un buzon completo y recorta los textos', () => {
    const b = validarBuzon(
      buzon('correo-a', { label: `  ${'x'.repeat(80)} ` })
    );
    assert.equal(b.id, 'correo-a');
    assert.equal(b.label.length, 60);
    assert.equal(b.enabled, true);
  });

  it('exige el prefijo correo-, un tipo de correo y un color conocido', () => {
    assert.throws(() => validarBuzon(buzon('nuevo')), /correo-/);
    assert.throws(() => validarBuzon(buzon('correo-Mayus')), /correo-/);
    assert.throws(
      () => validarBuzon(buzon('correo-a', { kind: 'odoo' })),
      /tipo/
    );
    assert.throws(
      () => validarBuzon(buzon('correo-a', { color: 'chartreuse' })),
      /color/
    );
    assert.throws(
      () => validarBuzon(buzon('correo-a', { label: '  ' })),
      /etiqueta/
    );
    assert.throws(() => validarBuzon(null), /objeto/);
  });
});

describe('aplicarParche', () => {
  it('cuentaEnabled apaga y prende sin tocar lo demas', () => {
    const a = aplicarParche(
      AJUSTES_VACIOS,
      { cuentaEnabled: { id: 'claude', enabled: false } },
      AHORA,
      POR
    );
    assert.deepEqual(a.cuentasApagadas, { claude: false });
    assert.equal(a.actualizadoEn, AHORA);
    assert.equal(a.actualizadoPor, POR);
    const b = aplicarParche(
      a,
      { cuentaEnabled: { id: 'claude', enabled: true } },
      AHORA,
      POR
    );
    assert.deepEqual(b.cuentasApagadas, { claude: true });
    // El documento anterior no se muta.
    assert.deepEqual(a.cuentasApagadas, { claude: false });
    assert.deepEqual(AJUSTES_VACIOS.cuentasApagadas, {});
  });

  it('cuentaEnabled rechaza ids raros y valores que no son booleanos', () => {
    assert.throws(
      () =>
        aplicarParche(
          AJUSTES_VACIOS,
          { cuentaEnabled: { id: '../x', enabled: false } },
          AHORA,
          POR
        ),
      /id/
    );
    assert.throws(
      () =>
        aplicarParche(
          AJUSTES_VACIOS,
          { cuentaEnabled: { id: 'claude', enabled: 'no' } },
          AHORA,
          POR
        ),
      /booleano/
    );
  });

  it('modo solo acepta gateway o demo', () => {
    const a = aplicarParche(
      AJUSTES_VACIOS,
      { modo: { id: 'odoo-itech', modo: 'gateway' } },
      AHORA,
      POR
    );
    assert.deepEqual(a.modos, { 'odoo-itech': 'gateway' });
    assert.throws(
      () =>
        aplicarParche(
          AJUSTES_VACIOS,
          { modo: { id: 'odoo-itech', modo: 'local' } },
          AHORA,
          POR
        ),
      /modo/
    );
  });

  it('agregarBuzon suma uno y no deja duplicados', () => {
    const a = aplicarParche(
      AJUSTES_VACIOS,
      { agregarBuzon: buzon() },
      AHORA,
      POR
    );
    assert.equal(a.buzonesAgregados.length, 1);
    assert.throws(
      () => aplicarParche(a, { agregarBuzon: buzon() }, AHORA, POR),
      /Ya existe/
    );
  });

  it('agregarBuzon rechaza el id de un buzon de fabrica ya quitado', () => {
    const a = aplicarParche(
      AJUSTES_VACIOS,
      { quitarBuzon: 'correo-itech' },
      AHORA,
      POR
    );
    assert.throws(
      () =>
        aplicarParche(a, { agregarBuzon: buzon('correo-itech') }, AHORA, POR),
      /quitado/
    );
  });

  it('agregarBuzon respeta el maximo', () => {
    let a: AjustesPortal = AJUSTES_VACIOS;
    for (let i = 0; i < MAX_BUZONES; i++) {
      a = aplicarParche(a, { agregarBuzon: buzon(`correo-b${i}`) }, AHORA, POR);
    }
    assert.throws(
      () =>
        aplicarParche(a, { agregarBuzon: buzon('correo-uno-mas') }, AHORA, POR),
      /Máximo/
    );
  });

  it('quitarBuzon: uno agregado sale de la lista; uno de fabrica queda anotado', () => {
    let a = aplicarParche(
      AJUSTES_VACIOS,
      { agregarBuzon: buzon() },
      AHORA,
      POR
    );
    a = aplicarParche(
      a,
      { cuentaEnabled: { id: 'correo-nuevo', enabled: false } },
      AHORA,
      POR
    );
    a = aplicarParche(
      a,
      { modo: { id: 'correo-nuevo', modo: 'demo' } },
      AHORA,
      POR
    );
    a = aplicarParche(a, { quitarBuzon: 'correo-nuevo' }, AHORA, POR);
    assert.deepEqual(a.buzonesAgregados, []);
    assert.deepEqual(a.buzonesQuitados, []);
    assert.deepEqual(a.cuentasApagadas, {});
    assert.deepEqual(a.modos, {});

    const b = aplicarParche(a, { quitarBuzon: 'correo-gmail' }, AHORA, POR);
    assert.deepEqual(b.buzonesQuitados, ['correo-gmail']);
    // Quitarlo dos veces no lo repite.
    const c = aplicarParche(b, { quitarBuzon: 'correo-gmail' }, AHORA, POR);
    assert.deepEqual(c.buzonesQuitados, ['correo-gmail']);
  });

  it('quitarBuzon solo acepta ids de correo', () => {
    assert.throws(
      () =>
        aplicarParche(AJUSTES_VACIOS, { quitarBuzon: 'claude' }, AHORA, POR),
      /correo-/
    );
  });

  it('pide exactamente una operacion', () => {
    assert.throws(
      () => aplicarParche(AJUSTES_VACIOS, {}, AHORA, POR),
      /una sola/
    );
    assert.throws(
      () =>
        aplicarParche(
          AJUSTES_VACIOS,
          {
            quitarBuzon: 'correo-a',
            cuentaEnabled: { id: 'claude', enabled: false }
          },
          AHORA,
          POR
        ),
      /una sola/
    );
    assert.throws(
      () => aplicarParche(AJUSTES_VACIOS, 'x', AHORA, POR),
      /objeto/
    );
  });
});

describe('validarDocumento', () => {
  it('acepta un documento completo y lo sella con fecha y autor', () => {
    const doc = validarDocumento(
      {
        cuentasApagadas: { claude: false, 'correo-nuevo': true },
        modos: { 'odoo-itech': 'gateway' },
        buzonesAgregados: [buzon()],
        buzonesQuitados: ['correo-gmail', 'correo-gmail']
      },
      AHORA,
      POR
    );
    assert.equal(doc.actualizadoEn, AHORA);
    assert.equal(doc.actualizadoPor, POR);
    assert.deepEqual(doc.buzonesQuitados, ['correo-gmail']);
    assert.equal(doc.buzonesAgregados[0]?.id, 'correo-nuevo');
  });

  it('un documento vacio es valido (descartar lo local)', () => {
    const doc = validarDocumento({}, AHORA, POR);
    assert.deepEqual(doc.buzonesAgregados, []);
    assert.equal(doc.actualizadoEn, AHORA);
  });

  it('rechaza buzones repetidos, modos invalidos y tipos equivocados', () => {
    assert.throws(
      () =>
        validarDocumento({ buzonesAgregados: [buzon(), buzon()] }, AHORA, POR),
      /repetido/
    );
    assert.throws(
      () => validarDocumento({ modos: { a: 'local' } }, AHORA, POR),
      /modo/
    );
    assert.throws(
      () => validarDocumento({ cuentasApagadas: { a: 'no' } }, AHORA, POR),
      /verdadero o falso/
    );
    assert.throws(
      () => validarDocumento({ buzonesAgregados: 'x' }, AHORA, POR),
      /lista/
    );
    assert.throws(() => validarDocumento([], AHORA, POR), /objeto/);
    assert.throws(
      () => validarDocumento({ buzonesQuitados: ['claude'] }, AHORA, POR),
      /correo-/
    );
  });

  it('respeta el maximo de buzones', () => {
    const muchos = Array.from({ length: MAX_BUZONES + 1 }, (_, i) =>
      buzon(`correo-b${i}`)
    );
    assert.throws(
      () => validarDocumento({ buzonesAgregados: muchos }, AHORA, POR),
      /Máximo/
    );
  });
});
