import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  LicenseAdjustment,
  LicenseUsage,
  ManualLicense
} from '../nucleo/contrato.js';
import { detectarAlertas } from '../ia/alertas.js';
import {
  MAX_HISTORIAL,
  MAX_MANUALES,
  migrarLicencias,
  aplicarAjustes,
  parchearAjuste,
  registrarRenovacion,
  renovacionVigente,
  sumarMeses,
  validarManual,
  validarRenovacion
} from './licencias.js';

const AHORA = new Date('2026-10-02T15:00:00.000Z');
const fijo = () => 'abc123';

const manual = (extra: Record<string, unknown> = {}): ManualLicense =>
  validarManual(
    { product: 'Claude Max', accountId: 'itech', cost: 100, ...extra },
    undefined,
    AHORA,
    fijo
  );

const deFuente = (extra: Partial<LicenseUsage> = {}): LicenseUsage => ({
  id: 'cursor-1',
  provider: 'cursor',
  product: 'Cursor Business',
  unit: 'asientos',
  used: 3,
  limit: 5,
  periodStart: '2026-09-05T12:00:00.000Z',
  periodEnd: '2026-10-05T12:00:00.000Z',
  cost: 80,
  currency: 'USD',
  renewsAt: '2026-10-05T12:00:00.000Z',
  manual: false,
  members: [],
  accountId: 'itech',
  updatedAt: AHORA.toISOString(),
  ...extra
});

describe('validarManual', () => {
  it('exige producto y cuenta y arma el id estable', () => {
    assert.throws(
      () => validarManual({ accountId: 'a' }, undefined, AHORA),
      /Falta el producto/
    );
    assert.throws(
      () => validarManual({ product: 'X' }, undefined, AHORA),
      /Falta la cuenta/
    );
    const l = manual();
    assert.equal(l.id, 'manual-claude-max-abc123');
    assert.equal(l.manual, true);
    assert.equal(l.unit, 'dinero');
    assert.equal(l.used, 100);
    assert.equal(l.currency, 'MXN');
    assert.equal(l.period, 'mensual');
    assert.equal(l.plan, 'Mensual');
  });

  it('valida costo, moneda y fecha', () => {
    assert.throws(() => manual({ cost: -1 }), /costo/);
    assert.throws(() => manual({ cost: 'caro' }), /costo/);
    assert.throws(() => manual({ currency: 'PESOS' }), /3 letras/);
    assert.throws(() => manual({ renewsAt: 'mañana' }), /fecha/);
    assert.throws(() => manual({ url: 'ftp://x' }), /http/);
    assert.equal(manual({ currency: 'usd' }).currency, 'USD');
    assert.equal(manual({ cost: 0 }).cost, 0);
  });

  it('sin fecha, la siguiente renovacion cae a un periodo de hoy', () => {
    assert.equal(
      manual().renewsAt?.slice(0, 10),
      '2026-11-02',
      'mensual: un mes'
    );
    assert.equal(
      manual({ period: 'anual' }).renewsAt?.slice(0, 10),
      '2027-10-02'
    );
    assert.equal(
      manual({ renewsAt: '2026-12-31' }).renewsAt,
      '2026-12-31T12:00:00.000Z'
    );
  });

  it('al editar conserva id, inicio del periodo y lo que no se manda', () => {
    const previa = manual({ notes: 'nota' });
    const editada = validarManual(
      { product: 'Claude Max 20x', accountId: 'itech', cost: 200 },
      previa,
      new Date('2026-10-10T00:00:00.000Z')
    );
    assert.equal(editada.id, previa.id);
    assert.equal(editada.periodStart, previa.periodStart);
    assert.equal(editada.renewsAt, previa.renewsAt);
    assert.equal(editada.used, 200);
    // Un null explicito quita el costo.
    assert.equal(
      validarManual({ product: 'X', accountId: 'a', cost: null }, previa, AHORA)
        .cost,
      undefined
    );
  });

  it('sin periodo (migracion), lo deduce del plan', () => {
    assert.equal(manual({ plan: 'Anual' }).period, 'anual');
    assert.equal(manual({ plan: 'Plan personal' }).period, 'mensual');
    assert.equal(
      manual({ plan: 'Anual', renewsAt: undefined }).renewsAt?.slice(0, 10),
      '2027-10-02'
    );
  });

  it('respeta un id manual que venga de la migracion', () => {
    assert.equal(manual({ id: 'manual-0b9f-11ee' }).id, 'manual-0b9f-11ee');
    assert.notEqual(manual({ id: 'otro' }).id, 'otro');
  });
});

describe('sumarMeses', () => {
  it('no se pasa del fin de mes', () => {
    assert.equal(
      sumarMeses(new Date('2026-01-31T12:00:00Z'), 1)
        .toISOString()
        .slice(0, 10),
      '2026-02-28'
    );
    assert.equal(
      sumarMeses(new Date('2026-12-15T12:00:00Z'), 1)
        .toISOString()
        .slice(0, 10),
      '2027-01-15'
    );
  });
});

describe('parchearAjuste', () => {
  it('suma campos, valida y quita con null', () => {
    const a = parchearAjuste(undefined, { cost: '12.5', currency: 'usd' });
    assert.deepEqual(a, { cost: 12.5, currency: 'USD', history: [] });
    const b = parchearAjuste(a, { plan: 'Pro', hidden: true });
    assert.equal(b?.plan, 'Pro');
    assert.equal(b?.hidden, true);
    assert.equal(b?.cost, 12.5);
    const c = parchearAjuste(b, { cost: null, currency: null, hidden: false });
    assert.deepEqual(c, { plan: 'Pro', history: [] });
    assert.equal(parchearAjuste(c, { plan: '' }), undefined);
    assert.throws(() => parchearAjuste(undefined, { cost: -5 }), /costo/);
    assert.throws(() => parchearAjuste(undefined, { renewsAt: 'no' }), /fecha/);
  });

  it('no borra el historial aunque se quiten los campos', () => {
    const conHistorial: LicenseAdjustment = {
      cost: 5,
      history: [{ at: AHORA.toISOString(), by: 'a@b.c' }]
    };
    const r = parchearAjuste(conHistorial, { cost: null });
    assert.equal(r?.history.length, 1);
  });
});

describe('validarRenovacion', () => {
  it('exige id y la fecha de la siguiente renovacion, no en el pasado', () => {
    assert.throws(() => validarRenovacion({}, AHORA), /id/);
    assert.throws(
      () => validarRenovacion({ id: 'x' }, AHORA),
      /siguiente renovación/
    );
    assert.throws(
      () => validarRenovacion({ id: 'x', renuevaEn: '2026-09-01' }, AHORA),
      /pasado/
    );
    assert.throws(
      () =>
        validarRenovacion(
          { id: 'x', renuevaEn: '2026-11-02', costo: -1 },
          AHORA
        ),
      /costo/
    );
    const e = validarRenovacion(
      {
        id: 'x',
        renuevaEn: '2026-11-02',
        costo: '99',
        moneda: 'mxn',
        nota: ' ok '
      },
      AHORA
    );
    assert.deepEqual(e, {
      id: 'x',
      costo: 99,
      moneda: 'MXN',
      renuevaEn: '2026-11-02T12:00:00.000Z',
      nota: 'ok'
    });
  });
});

describe('registrarRenovacion', () => {
  const entrada = validarRenovacion(
    { id: 'cursor-1', renuevaEn: '2026-11-05', costo: 90, moneda: 'USD' },
    AHORA
  );

  it('en una licencia de proveedor deja todo en su ajuste', () => {
    const r = registrarRenovacion(
      { manuales: [], ajustes: {} },
      entrada,
      'ana@x.mx',
      AHORA
    );
    const a = r.ajustes['cursor-1'] as LicenseAdjustment;
    assert.equal(a.cost, 90);
    assert.equal(a.currency, 'USD');
    assert.equal(a.renewsAt, '2026-11-05T12:00:00.000Z');
    assert.equal(a.renewedAt, AHORA.toISOString());
    assert.equal(a.confirmedBy, 'ana@x.mx');
    assert.equal(a.history.length, 1);
    assert.equal(r.renovacion.by, 'ana@x.mx');
  });

  it('en una licencia a mano actualiza la licencia y el ajuste solo lleva la constancia', () => {
    const m = manual();
    const r = registrarRenovacion(
      { manuales: [m], ajustes: {} },
      { ...entrada, id: m.id, costo: 150 },
      'ana@x.mx',
      AHORA
    );
    const nueva = r.manuales[0] as ManualLicense;
    assert.equal(nueva.cost, 150);
    assert.equal(nueva.used, 150);
    assert.equal(nueva.renewsAt, '2026-11-05T12:00:00.000Z');
    assert.equal(nueva.renewedAt, AHORA.toISOString());
    const a = r.ajustes[m.id] as LicenseAdjustment;
    assert.equal(a.cost, undefined);
    assert.equal(a.renewsAt, undefined);
    assert.equal(a.history.length, 1);
  });

  it('con soloHistorial (dominios) no pone costo ni fecha en el ajuste', () => {
    const r = registrarRenovacion(
      { manuales: [], ajustes: {} },
      entrada,
      'a',
      AHORA,
      true
    );
    const a = r.ajustes['cursor-1'] as LicenseAdjustment;
    assert.equal(a.renewsAt, undefined);
    assert.equal(a.cost, undefined);
    assert.equal(a.history.length, 1);
  });

  it('el historial se queda en 24, con la mas reciente al final', () => {
    let estado: Parameters<typeof registrarRenovacion>[0] = {
      manuales: [],
      ajustes: {}
    };
    for (let i = 0; i < MAX_HISTORIAL + 6; i++) {
      estado = registrarRenovacion(
        estado,
        { ...entrada, nota: `n${i}` },
        'a',
        new Date(AHORA.getTime() + i * 1000)
      );
    }
    const h = (estado.ajustes['cursor-1'] as LicenseAdjustment).history;
    assert.equal(h.length, MAX_HISTORIAL);
    assert.equal(h[h.length - 1]?.note, `n${MAX_HISTORIAL + 5}`);
    assert.equal(h[0]?.note, 'n6');
  });
});

describe('renovacionVigente', () => {
  const futuro = '2026-11-05T12:00:00.000Z';
  const viejo = '2026-10-05T12:00:00.000Z';
  it('el ajuste gana mientras sea vigente aunque el proveedor siga con la vieja', () => {
    assert.equal(renovacionVigente(viejo, futuro, AHORA), futuro);
    assert.equal(renovacionVigente(undefined, futuro, AHORA), futuro);
    assert.equal(renovacionVigente(viejo, undefined, AHORA), viejo);
  });
  it('un ajuste vencido cede ante una fecha posterior del proveedor', () => {
    const despues = new Date('2026-11-20T00:00:00.000Z');
    assert.equal(
      renovacionVigente('2026-12-05T12:00:00.000Z', futuro, despues),
      '2026-12-05T12:00:00.000Z'
    );
    // Si el proveedor no avanzo, sigue la del ajuste (vencida, sin confirmar).
    assert.equal(renovacionVigente(viejo, futuro, despues), futuro);
  });
});

describe('aplicarAjustes', () => {
  it('pone las correcciones, oculta y agrega las manuales al final', () => {
    const a = deFuente();
    const b = deFuente({ id: 'figma-1', product: 'Figma' });
    const m = manual();
    const r = aplicarAjustes(
      [a, b],
      [m],
      {
        'cursor-1': {
          cost: 90,
          renewsAt: '2026-11-05T12:00:00.000Z',
          renewedAt: AHORA.toISOString(),
          confirmedBy: 'ana@x.mx',
          history: []
        },
        'figma-1': { hidden: true, history: [] }
      },
      AHORA
    );
    assert.deepEqual(
      r.map((l) => l.id),
      ['cursor-1', m.id]
    );
    const cursor = r[0] as LicenseUsage;
    assert.equal(cursor.cost, 90);
    assert.equal(cursor.currency, 'USD');
    assert.equal(cursor.renewsAt, '2026-11-05T12:00:00.000Z');
    assert.equal(cursor.renewedAt, AHORA.toISOString());
    assert.equal(cursor.renewalConfirmedBy, 'ana@x.mx');
    // Unidad asientos: el consumo no se toca.
    assert.equal(cursor.used, 3);
  });

  it('en unidad dinero lo consumido es el costo corregido', () => {
    const l = deFuente({ unit: 'dinero', used: 80 });
    const [r] = aplicarAjustes(
      [l],
      [],
      { 'cursor-1': { cost: 120, history: [] } },
      AHORA
    );
    assert.equal(r?.used, 120);
  });
});

describe('alertas de renovacion con la fecha confirmada', () => {
  const ahora = new Date('2026-10-03T12:00:00.000Z');
  it('sale "se renueva" antes de confirmar y deja de salir despues', () => {
    // Cursor renueva el 5 de octubre (en 2 dias), con costo.
    const licencias = [deFuente()];
    const antes = detectarAlertas(licencias, [], {}, ahora).filter(
      (a) => a.tipo === 'renueva'
    );
    assert.equal(antes.length, 1);

    const r = registrarRenovacion(
      { manuales: [], ajustes: {} },
      validarRenovacion(
        { id: 'cursor-1', renuevaEn: '2026-11-05', costo: 80 },
        ahora
      ),
      'ana@x.mx',
      ahora
    );
    // El proveedor sigue mandando la fecha vieja: gana la confirmada.
    const despues = detectarAlertas(
      aplicarAjustes(licencias, [], r.ajustes, ahora),
      [],
      {},
      ahora
    ).filter((a) => a.tipo === 'renueva');
    assert.equal(despues.length, 0);
  });
});

describe('fechas que se normalizan', () => {
  it('rechaza 2026-02-30 y acepta 2028-02-29', () => {
    assert.throws(() => manual({ renewsAt: '2026-02-30' }), /fecha/);
    assert.throws(
      () => validarRenovacion({ id: 'x', renuevaEn: '2026-11-31' }, AHORA),
      /fecha/
    );
    assert.equal(
      manual({ renewsAt: '2028-02-29' }).renewsAt,
      '2028-02-29T12:00:00.000Z'
    );
    assert.throws(() => manual({ renewsAt: '2027-02-29' }), /fecha/);
  });
});

describe('periodo coherente', () => {
  it('renovar con una fecha anterior a la vigente no deja el inicio despues del fin', () => {
    const m = manual({ renewsAt: '2026-12-31' });
    const r = registrarRenovacion(
      { manuales: [m], ajustes: {} },
      validarRenovacion({ id: m.id, renuevaEn: '2026-10-10' }, AHORA),
      'a',
      AHORA
    );
    const n = r.manuales[0] as ManualLicense;
    assert.ok(Date.parse(n.periodStart) <= Date.parse(n.periodEnd));
    assert.equal(n.renewsAt, '2026-10-10T12:00:00.000Z');
  });

  it('corregir la fecha a una anterior al inicio tampoco lo invierte', () => {
    const previa = manual({ renewsAt: '2026-12-31' });
    const editada = validarManual(
      { ...previa, renewsAt: '2026-01-05' },
      previa,
      AHORA
    );
    assert.ok(Date.parse(editada.periodStart) <= Date.parse(editada.periodEnd));
  });
});

describe('migrarLicencias', () => {
  const vacio = { manuales: [], ajustes: {} };

  it('una moneda "$" vieja no bloquea la subida: sube la manual y la edicion saneada', () => {
    const r = migrarLicencias(
      vacio,
      {
        manuales: [
          {
            id: 'manual-aaaa-1111',
            product: 'Hosting',
            accountId: 'itech',
            cost: 100,
            currency: 'MXN'
          }
        ],
        ajustes: { 'cursor-1': { cost: 55, currency: '$' } }
      },
      AHORA
    );
    assert.equal(r.migradas, 2);
    assert.equal(r.manuales.length, 1);
    assert.equal(r.ajustes['cursor-1']?.cost, 55);
    assert.equal(r.ajustes['cursor-1']?.currency, undefined);
    assert.deepEqual(
      r.saneadas.map((x) => [x.id, x.campo]),
      [['cursor-1', 'currency']]
    );
    assert.deepEqual(r.descartadas, []);
  });

  it('sanea por registro: liga, fecha y costo malos se quitan; el irrecuperable se descarta', () => {
    const r = migrarLicencias(
      vacio,
      {
        manuales: [
          {
            product: 'Mala',
            accountId: 'itech',
            currency: '$',
            url: 'javascript:alert(1)',
            renewsAt: 'mañana',
            cost: -5,
            provider: 'inventado'
          },
          { id: 'manual-sin-producto', accountId: 'itech' },
          null,
          { product: 'Buena', accountId: 'itech', cost: 10 }
        ]
      },
      AHORA
    );
    assert.equal(r.migradas, 2);
    const campos = r.saneadas.map((x) => x.campo).sort();
    assert.deepEqual(campos, [
      'cost',
      'currency',
      'provider',
      'renewsAt',
      'url'
    ]);
    const mala = r.manuales.find((m) => m.product === 'Mala') as ManualLicense;
    assert.equal(mala.currency, 'MXN');
    assert.equal(mala.cost, undefined);
    assert.equal(mala.url, undefined);
    assert.equal(mala.provider, 'otro');
    assert.equal(r.descartadas.length, 2);
    assert.equal(r.descartadas[0]?.tipo, 'manual');
    assert.match(r.descartadas[0]?.motivo ?? '', /producto/);
  });

  it('conserva renewedAt, historial, periodo y periodStart capturados sin puente', () => {
    const r = migrarLicencias(
      vacio,
      {
        manuales: [
          {
            id: 'manual-bbbb-2222',
            product: 'Anual raro',
            accountId: 'itech',
            period: 'otro',
            periodStart: '2026-03-01T12:00:00.000Z',
            renewsAt: '2027-03-01T12:00:00.000Z'
          }
        ],
        ajustes: {
          'manual-bbbb-2222': {
            cost: 900,
            renewedAt: '2026-09-01T10:00:00.000Z',
            confirmedBy: 'este navegador',
            history: [
              {
                at: '2026-09-01T10:00:00.000Z',
                by: 'este navegador',
                cost: 900
              }
            ]
          },
          'figma-1': {
            renewedAt: '2026-09-02T10:00:00.000Z',
            history: [
              { at: '2026-09-02T10:00:00.000Z', by: 'x', renewsAt: 'mal' },
              { by: 'sin fecha' }
            ],
            hidden: true
          }
        }
      },
      AHORA
    );
    const m = r.manuales[0] as ManualLicense;
    assert.equal(m.period, 'otro');
    assert.equal(m.periodStart, '2026-03-01T12:00:00.000Z');
    // La correccion de una manual se pliega en la licencia.
    assert.equal(m.cost, 900);
    const am = r.ajustes['manual-bbbb-2222'] as LicenseAdjustment;
    assert.equal(am.cost, undefined);
    assert.equal(am.renewedAt, '2026-09-01T10:00:00.000Z');
    assert.equal(am.history.length, 1);
    const af = r.ajustes['figma-1'] as LicenseAdjustment;
    assert.equal(af.hidden, true);
    assert.equal(af.renewedAt, '2026-09-02T10:00:00.000Z');
    assert.equal(af.history.length, 1);
    assert.equal(af.history[0]?.renewsAt, undefined);
    assert.ok(r.saneadas.some((x) => x.campo === 'history'));
  });

  it('no pisa lo del servidor y respeta los topes', () => {
    const existente = manual();
    const r = migrarLicencias(
      {
        manuales: [existente],
        ajustes: { 'cursor-1': { cost: 1, history: [] } }
      },
      {
        manuales: [{ ...existente, product: 'Otra' }],
        ajustes: { 'cursor-1': { cost: 99 } }
      },
      AHORA
    );
    assert.equal(r.migradas, 0);
    assert.equal(r.manuales[0]?.product, 'Claude Max');
    assert.equal(r.ajustes['cursor-1']?.cost, 1);

    const llenas = Array.from({ length: MAX_MANUALES }, (_, i) =>
      manual({ id: `manual-lleno-${i}` })
    );
    const tope = migrarLicencias(
      { manuales: llenas, ajustes: {} },
      { manuales: [{ product: 'Una mas', accountId: 'a' }] },
      AHORA
    );
    assert.equal(tope.migradas, 0);
    assert.match(tope.descartadas[0]?.motivo ?? '', /200/);
  });

  it('un id de ajuste invalido se descarta sin romper el resto', () => {
    const r = migrarLicencias(
      vacio,
      { ajustes: { 'con espacios': { cost: 1 }, 'ok-1': { cost: 2 } } },
      AHORA
    );
    assert.equal(r.migradas, 1);
    assert.equal(r.descartadas[0]?.tipo, 'ajuste');
  });
});

describe('la confirmacion caduca si el proveedor mueve su fecha', () => {
  it('con el ajuste vencido y una fecha posterior del proveedor, ya no sale "renovada"', () => {
    const despues = new Date('2026-11-20T00:00:00.000Z');
    const ajustes = {
      'cursor-1': {
        renewsAt: '2026-11-05T12:00:00.000Z',
        renewedAt: AHORA.toISOString(),
        confirmedBy: 'ana@x.mx',
        history: []
      }
    };
    const [movida] = aplicarAjustes(
      [deFuente({ renewsAt: '2026-12-05T12:00:00.000Z' })],
      [],
      ajustes,
      despues
    );
    assert.equal(movida?.renewsAt, '2026-12-05T12:00:00.000Z');
    assert.equal(movida?.renewedAt, undefined);
    assert.equal(movida?.renewalConfirmedBy, undefined);
    // Mientras el ajuste vale, la confirmacion se ve.
    const [vigente] = aplicarAjustes([deFuente()], [], ajustes, AHORA);
    assert.equal(vigente?.renewedAt, AHORA.toISOString());
  });
});

describe('fechas absurdas', () => {
  it('rechaza fuera de 2000-2100 y la migracion las quita', () => {
    assert.throws(() => manual({ renewsAt: '0001-01-01' }), /rango/);
    assert.throws(() => manual({ renewsAt: '2101-01-01' }), /rango/);
    assert.throws(() => manual({ renewsAt: '9999-12-31T00:00:00Z' }), /rango/);
    assert.equal(
      manual({ renewsAt: '2000-01-01' }).renewsAt,
      '2000-01-01T12:00:00.000Z'
    );
    const r = migrarLicencias(
      { manuales: [], ajustes: {} },
      {
        manuales: [{ product: 'Rara', accountId: 'a', renewsAt: '0001-01-01' }],
        ajustes: { 'x-1': { cost: 3, renewsAt: '0001-01-01' } }
      },
      AHORA
    );
    assert.equal(r.migradas, 2);
    assert.deepEqual(r.saneadas.map((x) => x.campo).sort(), [
      'renewsAt',
      'renewsAt'
    ]);
    assert.equal(r.ajustes['x-1']?.renewsAt, undefined);
  });
});

describe('migracion: nada se pierde en silencio', () => {
  it('avisa los conflictos cuando el servidor ya tenia el id con otros datos', () => {
    const enServidor = manual({ cost: 100, plan: 'Mensual' });
    const r = migrarLicencias(
      { manuales: [enServidor], ajustes: {} },
      {
        manuales: [
          {
            id: enServidor.id,
            product: 'Claude Max',
            accountId: 'itech',
            cost: 250,
            currency: 'MXN',
            plan: 'Mensual'
          }
        ]
      },
      AHORA
    );
    assert.equal(r.migradas, 0);
    assert.equal(r.manuales[0]?.cost, 100);
    assert.deepEqual(
      r.conflictos.map((c) => [c.id, c.producto, c.campo, c.local, c.servidor]),
      [[enServidor.id, 'Claude Max', 'costo', '250', '100']]
    );
  });

  it('con los mismos datos no hay conflicto', () => {
    const enServidor = manual({ cost: 100, renewsAt: '2026-12-01' });
    const r = migrarLicencias(
      { manuales: [enServidor], ajustes: {} },
      {
        manuales: [
          {
            id: enServidor.id,
            product: 'Claude Max',
            accountId: 'itech',
            cost: 100,
            renewsAt: '2026-12-01T09:00:00.000Z'
          }
        ]
      },
      AHORA
    );
    assert.deepEqual(r.conflictos, []);
  });

  it('un ajuste local distinto del del servidor tambien se avisa', () => {
    const r = migrarLicencias(
      { manuales: [], ajustes: { 'cursor-1': { cost: 1, history: [] } } },
      { ajustes: { 'cursor-1': { cost: 99 } } },
      AHORA
    );
    assert.equal(r.ajustes['cursor-1']?.cost, 1);
    assert.equal(r.conflictos[0]?.campo, 'costo');
    assert.equal(r.conflictos[0]?.local, '99');
  });

  it('un id repetido dentro de la misma subida figura como descartado', () => {
    const r = migrarLicencias(
      { manuales: [], ajustes: {} },
      {
        manuales: [
          { id: 'manual-dup-1', product: 'Uno', accountId: 'a' },
          { id: 'manual-dup-1', product: 'Dos', accountId: 'a' }
        ]
      },
      AHORA
    );
    assert.equal(r.migradas, 1);
    assert.equal(r.manuales[0]?.product, 'Uno');
    assert.deepEqual(r.descartadas, [
      {
        id: 'manual-dup-1',
        tipo: 'manual',
        motivo: 'id repetido en la misma subida'
      }
    ]);
  });
});
