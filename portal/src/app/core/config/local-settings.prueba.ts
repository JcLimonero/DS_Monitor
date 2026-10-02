import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizarManual } from '../licencias/licencias.util';
import { limpiarEdiciones, limpiarManuales } from './local-settings';

describe('lo guardado en localStorage que pudo corromperse', () => {
  it('limpiarManuales deja solo objetos con id y producto', () => {
    const r = limpiarManuales([
      null,
      undefined,
      3,
      'x',
      [],
      { id: '', product: 'a' },
      { id: 'manual-1' },
      { id: 'manual-2', product: 'Bien' }
    ]);
    assert.deepEqual(
      r.map((l) => l.id),
      ['manual-2']
    );
    assert.deepEqual(limpiarManuales(null), []);
    assert.deepEqual(limpiarManuales({ id: 'x' }), []);
  });

  it('limpiarEdiciones deja solo objetos', () => {
    const r = limpiarEdiciones({ a: null, b: 4, c: [], d: { cost: 1 } });
    assert.deepEqual(Object.keys(r), ['d']);
    assert.deepEqual(limpiarEdiciones(null), {});
    assert.deepEqual(limpiarEdiciones([1]), {});
  });
});

describe('una licencia local incompleta no rompe el portal', () => {
  it('rellena lo que el resto del portal da por supuesto', () => {
    const [l] = limpiarManuales([{ id: 'x', product: 'p', accountId: 'c' }]);
    assert.ok(l);
    assert.equal(l.provider, 'otro');
    assert.equal(l.unit, 'dinero');
    assert.equal(l.used, 0);
    assert.deepEqual(l.members, []);
    assert.equal(l.manual, true);
    assert.equal(l.currency, 'MXN');
    assert.ok(Date.parse(l.periodStart) <= Date.parse(l.periodEnd));
    assert.ok(!Number.isNaN(Date.parse(l.updatedAt)));
    // Lo que la pagina de Licencias hace con cada una no lanza.
    assert.doesNotThrow(() => l.provider.localeCompare('a'));
    assert.doesNotThrow(() => l.product.localeCompare('a'));
  });

  it('la basura se queda fuera o se sanea sin lanzar', () => {
    const basura = [
      {
        id: 'a',
        product: 'p',
        provider: 7,
        unit: {},
        members: 'x',
        used: 'mucho',
        cost: -3,
        currency: '$',
        renewsAt: '0001-01-01',
        periodStart: 'no',
        periodEnd: 5,
        accountId: 9,
        updatedAt: []
      },
      { id: 'b', product: '   ' },
      { id: ['c'], product: 'p' },
      { product: 'sin id' },
      'texto',
      42,
      null,
      [],
      true
    ];
    let r: ReturnType<typeof limpiarManuales> = [];
    assert.doesNotThrow(() => {
      r = limpiarManuales(basura);
    });
    assert.deepEqual(
      r.map((l) => l.id),
      ['a']
    );
    const a = r[0];
    assert.equal(a?.provider, 'otro');
    assert.equal(a?.unit, 'dinero');
    assert.deepEqual(a?.members, []);
    assert.equal(a?.cost, undefined);
    assert.equal(a?.currency, 'MXN');
    assert.equal(a?.renewsAt, undefined);
    assert.equal(a?.accountId, '');
    assert.equal(a?.used, 0);
    assert.ok(
      Date.parse(a?.periodStart ?? '') <= Date.parse(a?.periodEnd ?? '')
    );
    for (const v of [undefined, 3, 'x', [], { id: 1 }]) {
      assert.equal(normalizarManual(v), undefined);
    }
  });
});
