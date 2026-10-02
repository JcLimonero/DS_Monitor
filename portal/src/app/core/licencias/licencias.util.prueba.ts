import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LicenseAdjustment, LicenseUsage, ManualLicense } from '../models';
import {
  aplicarLicencias,
  claseTono,
  combinarConLocales,
  estadoRenovacion,
  periodoEnMeses,
  renovacionVigente,
  sugerirProximaRenovacion,
  sumarMeses
} from './licencias.util';

const HOY = new Date(2026, 9, 2, 10, 0, 0); // 2 oct 2026, hora local

const licencia = (extra: Partial<LicenseUsage> = {}): LicenseUsage => ({
  id: 'l1',
  provider: 'otro',
  product: 'Hosting',
  plan: 'Mensual',
  unit: 'dinero',
  used: 100,
  periodStart: '2026-09-05T12:00:00.000Z',
  periodEnd: '2026-10-05T12:00:00.000Z',
  cost: 100,
  currency: 'MXN',
  renewsAt: '2026-10-05T12:00:00.000Z',
  manual: false,
  members: [],
  accountId: 'itech',
  updatedAt: HOY.toISOString(),
  ...extra
});

const diasDesdeHoy = (dias: number): string =>
  new Date(HOY.getTime() + dias * 86_400_000).toISOString();

describe('sumarMeses', () => {
  it('suma meses de calendario sin pasarse del fin de mes', () => {
    assert.equal(sumarMeses('2026-10-05', 1), '2026-11-05');
    assert.equal(sumarMeses('2026-12-15', 1), '2027-01-15');
    assert.equal(sumarMeses('2026-01-31', 1), '2026-02-28');
    assert.equal(sumarMeses('2028-01-31', 1), '2028-02-29');
    assert.equal(sumarMeses('2026-10-05', 12), '2027-10-05');
    assert.equal(sumarMeses('2026-03-31', 11), '2027-02-28');
  });
});

describe('periodoEnMeses', () => {
  it('lee el periodo, luego el plan y al final la duración', () => {
    assert.equal(
      periodoEnMeses({ ...licencia(), period: 'anual' } as LicenseUsage),
      12
    );
    assert.equal(periodoEnMeses(licencia({ plan: 'Cursor annual' })), 12);
    assert.equal(periodoEnMeses(licencia({ plan: 'Team monthly' })), 1);
    assert.equal(
      periodoEnMeses(
        licencia({
          plan: undefined,
          periodStart: '2025-10-05T12:00:00.000Z',
          periodEnd: '2026-10-05T12:00:00.000Z'
        })
      ),
      12
    );
    assert.equal(periodoEnMeses(licencia({ plan: undefined })), 1);
  });
});

describe('sugerirProximaRenovacion', () => {
  it('con renovación futura suma un periodo a esa fecha', () => {
    assert.equal(
      sugerirProximaRenovacion(
        licencia({ renewsAt: '2026-10-05T12:00:00.000Z' }),
        HOY
      ),
      '2026-11-05'
    );
    assert.equal(
      sugerirProximaRenovacion(
        licencia({ plan: 'Anual', renewsAt: '2026-10-05T12:00:00.000Z' }),
        HOY
      ),
      '2027-10-05'
    );
  });

  it('con renovación vencida da la primera fecha en el futuro, sin desviar el día', () => {
    assert.equal(
      sugerirProximaRenovacion(
        licencia({ renewsAt: '2026-07-31T12:00:00.000Z' }),
        HOY
      ),
      '2026-10-31'
    );
    assert.equal(
      sugerirProximaRenovacion(
        licencia({ plan: 'Anual', renewsAt: '2024-03-10T12:00:00.000Z' }),
        HOY
      ),
      '2027-03-10'
    );
  });

  it('sin fecha cuenta desde hoy', () => {
    assert.equal(
      sugerirProximaRenovacion(licencia({ renewsAt: undefined }), HOY),
      '2026-11-02'
    );
  });
});

describe('estadoRenovacion', () => {
  it('vencida sin confirmar pregunta si ya se renovó, en rojo', () => {
    const e = estadoRenovacion(licencia({ renewsAt: diasDesdeHoy(-3) }), HOY);
    assert.equal(e.tipo, 'vencida');
    assert.equal(e.tono, 'danger');
    assert.equal(e.texto, 'Vencida: ¿ya se renovó?');
  });

  it('próxima: hoy, mañana y en N días, en ámbar', () => {
    assert.equal(
      estadoRenovacion(licencia({ renewsAt: diasDesdeHoy(0) }), HOY).texto,
      'Renueva hoy'
    );
    assert.equal(
      estadoRenovacion(licencia({ renewsAt: diasDesdeHoy(1) }), HOY).texto,
      'Renueva mañana'
    );
    const e = estadoRenovacion(licencia({ renewsAt: diasDesdeHoy(9) }), HOY);
    assert.equal(e.tipo, 'proxima');
    assert.equal(e.tono, 'warn');
    assert.equal(e.texto, 'Renueva en 9 días');
  });

  it('confirmada y lejos de la siguiente: verde con la fecha de la confirmación', () => {
    const e = estadoRenovacion(
      licencia({
        renewsAt: diasDesdeHoy(30),
        renewedAt: HOY.toISOString()
      }),
      HOY
    );
    assert.equal(e.tipo, 'confirmada');
    assert.equal(e.tono, 'ok');
    assert.match(e.texto, /^Renovada · confirmada el /);
    // La versión corta cabe en las tarjetas del carrusel en celular.
    assert.match(e.corto, /^Renovada · /);
    assert.ok(e.corto.length < e.texto.length);
  });

  it('confirmada pero la siguiente ya está cerca vuelve a avisar', () => {
    const e = estadoRenovacion(
      licencia({ renewsAt: diasDesdeHoy(6), renewedAt: diasDesdeHoy(-24) }),
      HOY
    );
    assert.equal(e.tipo, 'proxima');
  });

  it('sin confirmar y lejos: neutro; sin fecha: sin fecha', () => {
    const e = estadoRenovacion(licencia({ renewsAt: diasDesdeHoy(60) }), HOY);
    assert.equal(e.tipo, 'lejana');
    assert.equal(e.tono, 'neutro');
    assert.equal(
      estadoRenovacion(licencia({ renewsAt: undefined }), HOY).tipo,
      'sinfecha'
    );
  });

  it('cada tono usa un token del tema', () => {
    assert.equal(claseTono('ok'), 'text-ok');
    assert.equal(claseTono('warn'), 'text-warn');
    assert.equal(claseTono('danger'), 'text-danger');
    assert.equal(claseTono('neutro'), 'text-ink-muted');
  });
});

describe('renovacionVigente', () => {
  const futuro = '2026-11-05T12:00:00.000Z';
  const viejo = '2026-10-05T12:00:00.000Z';
  it('el ajuste gana mientras esté vigente aunque el proveedor mande la vieja', () => {
    assert.equal(renovacionVigente(viejo, futuro, HOY), futuro);
    assert.equal(renovacionVigente(viejo, undefined, HOY), viejo);
  });
  it('un ajuste vencido cede ante una fecha posterior del proveedor', () => {
    const despues = new Date(2026, 10, 20);
    assert.equal(
      renovacionVigente('2026-12-05T12:00:00.000Z', futuro, despues),
      '2026-12-05T12:00:00.000Z'
    );
    assert.equal(renovacionVigente(viejo, futuro, despues), futuro);
  });
});

describe('aplicarLicencias', () => {
  const ajuste = (extra: Partial<LicenseAdjustment>): LicenseAdjustment => ({
    history: [],
    ...extra
  });

  it('corrige, oculta y deja las manuales al final', () => {
    const a = licencia({ id: 'a', unit: 'asientos', used: 3 });
    const b = licencia({ id: 'b' });
    const m = licencia({ id: 'manual-x', manual: true });
    const r = aplicarLicencias(
      [a, b],
      [m],
      {
        a: ajuste({
          cost: 150,
          renewsAt: '2026-11-05T12:00:00.000Z',
          renewedAt: '2026-10-02T16:00:00.000Z',
          confirmedBy: 'ana@x.mx'
        }),
        b: ajuste({ hidden: true })
      },
      HOY
    );
    assert.deepEqual(
      r.map((l) => l.id),
      ['a', 'manual-x']
    );
    assert.equal(r[0]?.cost, 150);
    assert.equal(r[0]?.currency, 'MXN');
    assert.equal(r[0]?.renewsAt, '2026-11-05T12:00:00.000Z');
    assert.equal(r[0]?.renewalConfirmedBy, 'ana@x.mx');
    // Unidad asientos: el consumo queda como llegó.
    assert.equal(r[0]?.used, 3);
  });

  it('en unidad dinero lo consumido es el costo corregido', () => {
    const [r] = aplicarLicencias(
      [licencia()],
      [],
      { l1: ajuste({ cost: 250 }) },
      HOY
    );
    assert.equal(r?.used, 250);
  });

  it('sin ajustes deja todo igual', () => {
    const a = licencia();
    assert.deepEqual(aplicarLicencias([a], [], {}, HOY), [a]);
  });
});

describe('la confirmación caduca si el proveedor mueve su fecha', () => {
  const ajuste: LicenseAdjustment = {
    renewsAt: '2026-11-05T12:00:00.000Z',
    renewedAt: '2026-10-02T16:00:00.000Z',
    confirmedBy: 'ana@x.mx',
    history: []
  };

  it('mientras el ajuste vale, el chip dice Renovada', () => {
    const [l] = aplicarLicencias([licencia()], [], { l1: ajuste }, HOY);
    assert.equal(l?.renewedAt, ajuste.renewedAt);
    assert.equal(estadoRenovacion(l as LicenseUsage, HOY).tipo, 'confirmada');
  });

  it('con el ajuste vencido y una fecha posterior del proveedor, ya no', () => {
    const despues = new Date(2026, 10, 20, 10);
    const [l] = aplicarLicencias(
      [licencia({ renewsAt: '2026-12-05T12:00:00.000Z' })],
      [],
      { l1: ajuste },
      despues
    );
    assert.equal(l?.renewsAt, '2026-12-05T12:00:00.000Z');
    assert.equal(l?.renewedAt, undefined);
    assert.equal(l?.renewalConfirmedBy, undefined);
    assert.notEqual(
      estadoRenovacion(l as LicenseUsage, despues).tipo,
      'confirmada'
    );
  });
});

describe('combinarConLocales (vista provisional antes de migrar)', () => {
  const enServidor = (id: string): ManualLicense =>
    ({
      ...licencia({ id, manual: true }),
      manual: true,
      period: 'mensual'
    }) as ManualLicense;

  it('agrega lo del navegador que el servidor no tiene y lo marca', () => {
    const r = combinarConLocales(
      {
        manuales: [enServidor('manual-a')],
        ajustes: { 'cursor-1': { cost: 1, history: [] } }
      },
      {
        manuales: [
          licencia({ id: 'manual-a', manual: true }),
          licencia({ id: 'manual-b', manual: true, plan: 'Anual' })
        ],
        ajustes: {
          'cursor-1': { cost: 99 },
          'figma-1': { cost: 5, currency: 'USD' }
        }
      }
    );
    assert.deepEqual(
      r.manuales.map((m) => m.id),
      ['manual-a', 'manual-b']
    );
    assert.equal(r.manuales[1]?.period, 'anual');
    assert.deepEqual([...r.manualesSoloLocal], ['manual-b']);
    // Lo del servidor manda; lo local solo entra donde no hay.
    assert.equal(r.ajustes['cursor-1']?.cost, 1);
    assert.equal(r.ajustes['figma-1']?.cost, 5);
    assert.deepEqual(r.ajustes['figma-1']?.history, []);
    assert.deepEqual([...r.ajustesSoloLocal], ['figma-1']);
  });

  it('el gasto y los avisos ven lo provisional (pasa por aplicarLicencias)', () => {
    const r = combinarConLocales(
      { manuales: [], ajustes: {} },
      {
        manuales: [licencia({ id: 'manual-b', manual: true, cost: 70 })],
        ajustes: {}
      }
    );
    const todas = aplicarLicencias([], r.manuales, r.ajustes, HOY);
    assert.equal(
      todas.reduce((s, l) => s + (l.cost ?? 0), 0),
      70
    );
  });

  it('tolera un localStorage corrupto (null, tipos raros) sin lanzar', () => {
    const r = combinarConLocales(
      { manuales: [], ajustes: {} },
      {
        manuales: [null, 7, 'x', { id: 3 }, { id: 'manual-ok', product: 'Ok' }],
        ajustes: { a: null, b: 'x', c: [1], d: { cost: 1, history: 'mal' } }
      }
    );
    assert.deepEqual(
      r.manuales.map((m) => m.id),
      ['manual-ok']
    );
    assert.deepEqual([...r.ajustesSoloLocal], ['d']);
    assert.deepEqual(r.ajustes['d']?.history, []);
  });
});
