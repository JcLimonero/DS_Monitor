import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizarManual } from '../licencias/licencias.util';
import {
  limpiarEdiciones,
  limpiarManuales,
  sanearEdicion
} from './local-settings';
import { totalSpend } from '../state/portal.selectors';
import type { LicenseUsage } from '../models';

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

describe('una corrección local con basura no descuadra el gasto', () => {
  it('quita costo negativo o no numérico, moneda que no son 3 letras y fechas absurdas', () => {
    assert.deepEqual(sanearEdicion({ cost: -500, currency: 'MXN' }), {
      currency: 'MXN'
    });
    assert.deepEqual(sanearEdicion({ cost: 'abc', currency: 5 }), {});
    assert.deepEqual(sanearEdicion({ cost: 1e999, currency: '$' }), {});
    assert.deepEqual(
      sanearEdicion({ renewsAt: '0001-01-01T00:00:00.000Z', plan: ' Anual ' }),
      { plan: 'Anual' }
    );
    assert.deepEqual(sanearEdicion({ cost: 1200, currency: 'usd' }), {
      cost: 1200,
      currency: 'USD'
    });
  });

  it('hidden solo vale si es exactamente true', () => {
    assert.equal(sanearEdicion({ hidden: 'yes' })?.hidden, undefined);
    assert.equal(sanearEdicion({ hidden: 1 })?.hidden, undefined);
    assert.equal(sanearEdicion({ hidden: true })?.hidden, true);
  });

  it('limpiarEdiciones aplica el saneado a cada id', () => {
    const r = limpiarEdiciones({
      'dominios-zeta-com-mx': { cost: -500, currency: 'MXN' },
      otra: { cost: 99, currency: 'MXN' }
    });
    assert.equal(r['dominios-zeta-com-mx']?.cost, undefined);
    assert.equal(r['otra']?.cost, 99);
  });

  it('totalSpend suma solo costos numéricos', () => {
    const licencias = [
      { cost: 100 },
      { cost: Number.NaN },
      { cost: undefined },
      { cost: '50' as unknown as number },
      { cost: 25 }
    ] as unknown as LicenseUsage[];
    assert.equal(totalSpend(licencias), 125);
  });
});
