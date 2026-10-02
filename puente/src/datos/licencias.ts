import type {
  LicenseAdjustment,
  LicenseProvider,
  LicenseRenewal,
  LicenseUsage,
  ManualLicense,
  ManualLicensePeriod
} from '../nucleo/contrato.js';

/**
 * Las licencias que se capturan o se corrigen a mano.
 *
 * Antes vivian en el localStorage de cada navegador: lo que se capturaba en
 * una laptop no lo veia la television del carrusel. Ahora viven en el puente:
 *
 * - `licencias_manuales`: las que no llegan por ninguna fuente (se agregan a
 *   mano, con id `manual-<slug>-<rand>`).
 * - `licencias_ajustes`: por id de licencia (de una fuente o manual), lo que se
 *   corrigio o se confirmo encima de lo que manda el proveedor, mas el
 *   historial de confirmaciones de renovacion.
 *
 * Todo aqui es puro (recibe y devuelve datos); rutas.ts lo guarda.
 */

export type Ajustes = Record<string, LicenseAdjustment>;

/** Cuantas confirmaciones de renovacion se conservan por licencia. */
export const MAX_HISTORIAL = 24;

const DIA_MS = 86_400_000;
const PROVEEDORES: LicenseProvider[] = [
  'anthropic',
  'cursor',
  'figma',
  'vercel',
  'otro'
];
const PERIODOS: ManualLicensePeriod[] = ['mensual', 'anual', 'otro'];

// --- Piezas de validacion --------------------------------------------------

function texto(valor: unknown, maximo = 200): string | undefined {
  return typeof valor === 'string' && valor.trim() !== ''
    ? valor.trim().slice(0, maximo)
    : undefined;
}

/** Vacio, null o ausente: `undefined`. Algo que no es un numero >= 0: error. */
function costoValido(valor: unknown, campo: string): number | undefined {
  if (valor === undefined || valor === null || valor === '') {
    return undefined;
  }
  const n = typeof valor === 'number' ? valor : Number(valor);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${campo} debe ser un número de 0 en adelante.`);
  }
  return Math.round(n * 100) / 100;
}

function monedaValida(valor: unknown, campo: string): string | undefined {
  const m = texto(valor);
  if (m === undefined) {
    return undefined;
  }
  if (!/^[A-Za-z]{3}$/.test(m)) {
    throw new Error(`${campo} debe ser de 3 letras, por ejemplo MXN.`);
  }
  return m.toUpperCase();
}

/**
 * Una fecha ISO. Acepta `2026-11-05` (queda al mediodia UTC, para que el dia no
 * se mueva con la zona horaria) o una fecha completa.
 */
const FECHA_MINIMA_MS = Date.UTC(2000, 0, 1);
const FECHA_MAXIMA_MS = Date.UTC(2100, 11, 31, 23, 59, 59);

export function fechaValida(valor: unknown, campo: string): string | undefined {
  const t = texto(valor, 40);
  if (t === undefined) {
    return undefined;
  }
  const solaFecha = /^\d{4}-\d{2}-\d{2}$/.test(t);
  const ms = Date.parse(solaFecha ? `${t}T12:00:00.000Z` : t);
  // "2026-02-30" no es una fecha: Date la correria al 2 de marzo en silencio.
  if (
    Number.isNaN(ms) ||
    (solaFecha && new Date(ms).toISOString().slice(0, 10) !== t)
  ) {
    throw new Error(`${campo} debe ser una fecha válida.`);
  }
  // Un 0001-01-01 o un 9999 es basura de un formulario, no una renovacion.
  if (ms < FECHA_MINIMA_MS || ms > FECHA_MAXIMA_MS) {
    throw new Error(`${campo} está fuera de rango (2000 a 2100).`);
  }
  return new Date(ms).toISOString();
}

function urlValida(valor: unknown): string | undefined {
  const t = texto(valor, 500);
  if (t === undefined) {
    return undefined;
  }
  try {
    const u = new URL(t);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      throw new Error('protocolo');
    }
    return u.toString();
  } catch {
    throw new Error('La liga debe empezar con http:// o https://.');
  }
}

/** Cuantas licencias a mano y cuantos ajustes caben (el puente no es una base de datos). */
export const MAX_MANUALES = 200;
export const MAX_AJUSTES = 500;
const MAX_ID = 120;

/** Un id de licencia razonable: hasta 120 caracteres de `[A-Za-z0-9_.:-]`. */
export function idLimpio(valor: unknown): string | undefined {
  return typeof valor === 'string' &&
    valor.length <= MAX_ID &&
    /^[\w.:-]+$/.test(valor)
    ? valor
    : undefined;
}

function slug(producto: string): string {
  return (
    producto
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'licencia'
  );
}

/** Una fecha mas `meses` meses, sin pasarse del fin de mes (31 ene → 28 feb). */
export function sumarMeses(fecha: Date, meses: number): Date {
  const d = new Date(fecha.getTime());
  const dia = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + meses);
  const ultimo = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)
  ).getUTCDate();
  d.setUTCDate(Math.min(dia, ultimo));
  return d;
}

// --- Licencias a mano ------------------------------------------------------

/**
 * Una licencia a mano bien formada, o el motivo por el que no. Con `previa` es
 * una edicion: conserva el id, el inicio del periodo y lo que no se mande.
 */
export function validarManual(
  crudo: unknown,
  previa: ManualLicense | undefined,
  ahora: Date,
  aleatorio: () => string = () => Math.random().toString(36).slice(2, 8)
): ManualLicense {
  const c = (crudo ?? {}) as Record<string, unknown>;
  const product = texto(c['product'], 80);
  if (!product) {
    throw new Error('Falta el producto.');
  }
  const accountId = texto(c['accountId'], 80);
  if (!accountId) {
    throw new Error('Falta la cuenta a la que se carga la licencia.');
  }
  const proveedor = texto(c['provider']) ?? previa?.provider ?? 'otro';
  if (!PROVEEDORES.includes(proveedor as LicenseProvider)) {
    throw new Error(`El proveedor "${proveedor}" no es válido.`);
  }
  // Una licencia que viene de un navegador (migracion) no traia periodo: se
  // deduce del plan ("Anual") y, si no dice, se asume mensual.
  const period = (texto(c['period']) ??
    previa?.period ??
    (/anual/i.test(texto(c['plan']) ?? '')
      ? 'anual'
      : 'mensual')) as ManualLicensePeriod;
  if (!PERIODOS.includes(period)) {
    throw new Error('El periodo debe ser mensual, anual u otro.');
  }
  const cost = 'cost' in c ? costoValido(c['cost'], 'El costo') : previa?.cost;
  const currency =
    ('currency' in c ? monedaValida(c['currency'], 'La moneda') : undefined) ??
    previa?.currency ??
    'MXN';
  const renovacion =
    'renewsAt' in c
      ? fechaValida(c['renewsAt'], 'La fecha de renovación')
      : previa?.renewsAt;
  // Sin fecha, la siguiente renovacion cae a un periodo de hoy.
  const renewsAt =
    renovacion ?? sumarMeses(ahora, period === 'anual' ? 12 : 1).toISOString();
  const plan =
    texto(c['plan'], 80) ??
    (period === 'anual'
      ? 'Anual'
      : period === 'mensual'
        ? 'Mensual'
        : undefined);
  const id =
    previa?.id ??
    (typeof c['id'] === 'string' && /^manual-[\w-]{4,80}$/.test(c['id'])
      ? c['id']
      : `manual-${slug(product)}-${aleatorio()}`);
  const notes = texto(c['notes'], 500);
  const url = 'url' in c ? urlValida(c['url']) : previa?.url;
  // Lo que se capturo sin puente trae su propio inicio de periodo y su
  // confirmacion; en una edicion manda lo que ya estaba.
  const inicioCrudo = previa
    ? previa.periodStart
    : (('periodStart' in c
        ? fechaValida(c['periodStart'], 'El inicio del periodo')
        : undefined) ?? ahora.toISOString());
  // El periodo nunca empieza despues de terminar (p. ej. al corregir la fecha a una anterior).
  const inicio =
    Date.parse(inicioCrudo) > Date.parse(renewsAt) ? renewsAt : inicioCrudo;
  const renewedAt = previa
    ? previa.renewedAt
    : 'renewedAt' in c
      ? fechaValida(c['renewedAt'], 'La fecha de la confirmación')
      : undefined;
  const confirmadoPor = previa
    ? previa.renewalConfirmedBy
    : texto(c['renewalConfirmedBy'], 120);
  const licencia: ManualLicense = {
    id,
    provider: proveedor as LicenseProvider,
    product,
    ...(plan ? { plan } : {}),
    unit: 'dinero',
    used: cost ?? 0,
    periodStart: inicio,
    periodEnd: renewsAt,
    ...(cost !== undefined ? { cost } : {}),
    currency,
    renewsAt,
    ...(renewedAt ? { renewedAt } : {}),
    ...(renewedAt && confirmadoPor
      ? { renewalConfirmedBy: confirmadoPor }
      : {}),
    manual: true,
    members: [],
    accountId,
    ...(url ? { url } : {}),
    updatedAt: ahora.toISOString(),
    period,
    ...(notes ? { notes } : {})
  };
  return licencia;
}

// --- Ajustes ---------------------------------------------------------------

/**
 * Aplica un parche a la correccion de una licencia. Un campo con `null` (o
 * vacio) la quita; un campo ausente no se toca. Devuelve `undefined` cuando ya
 * no queda nada que guardar (ni campos ni historial).
 */
export function parchearAjuste(
  previo: LicenseAdjustment | undefined,
  parche: unknown
): LicenseAdjustment | undefined {
  const p = (parche ?? {}) as Record<string, unknown>;
  const nuevo: LicenseAdjustment = {
    ...(previo ?? { history: [] }),
    history: [...(previo?.history ?? [])]
  };
  const quitar = (v: unknown) => v === null || v === '';
  if ('cost' in p) {
    const cost = costoValido(p['cost'], 'El costo');
    if (cost === undefined) {
      delete nuevo.cost;
    } else {
      nuevo.cost = cost;
    }
  }
  if ('currency' in p) {
    const moneda = monedaValida(p['currency'], 'La moneda');
    if (moneda === undefined) {
      delete nuevo.currency;
    } else {
      nuevo.currency = moneda;
    }
  }
  if ('plan' in p) {
    const plan = quitar(p['plan']) ? undefined : texto(p['plan'], 80);
    if (plan === undefined) {
      delete nuevo.plan;
    } else {
      nuevo.plan = plan;
    }
  }
  if ('renewsAt' in p) {
    const fecha = fechaValida(p['renewsAt'], 'La fecha de renovación');
    if (fecha === undefined) {
      delete nuevo.renewsAt;
    } else {
      nuevo.renewsAt = fecha;
    }
  }
  if ('hidden' in p) {
    if (p['hidden'] === true) {
      nuevo.hidden = true;
    } else {
      delete nuevo.hidden;
    }
  }
  const vacio =
    nuevo.cost === undefined &&
    nuevo.currency === undefined &&
    nuevo.plan === undefined &&
    nuevo.renewsAt === undefined &&
    !nuevo.hidden &&
    !nuevo.renewedAt &&
    nuevo.history.length === 0;
  return vacio ? undefined : nuevo;
}

// --- Renovacion ------------------------------------------------------------

export interface EntradaRenovacion {
  id: string;
  costo?: number;
  moneda?: string;
  renuevaEn: string;
  nota?: string;
}

/** La entrada de `POST /licencias/renovar`, validada. */
export function validarRenovacion(
  crudo: unknown,
  ahora: Date
): EntradaRenovacion {
  const c = (crudo ?? {}) as Record<string, unknown>;
  const id = idLimpio(c['id']);
  if (!id) {
    throw new Error('Falta el id de la licencia.');
  }
  const renuevaEn = fechaValida(c['renuevaEn'], 'La fecha de renovación');
  if (!renuevaEn) {
    throw new Error('Falta la fecha de la siguiente renovación.');
  }
  // Un dia de tolerancia por la zona horaria de quien captura.
  if (Date.parse(renuevaEn) < ahora.getTime() - DIA_MS) {
    throw new Error(
      'La siguiente renovación no puede estar en el pasado: pon la fecha del próximo cobro.'
    );
  }
  const costo = costoValido(c['costo'], 'El costo');
  const moneda = monedaValida(c['moneda'], 'La moneda');
  const nota = texto(c['nota'], 300);
  return {
    id,
    ...(costo !== undefined ? { costo } : {}),
    ...(moneda ? { moneda } : {}),
    renuevaEn,
    ...(nota ? { nota } : {})
  };
}

/**
 * Donde empieza el periodo nuevo: en la fecha de renovacion que ya tenia; si
 * esa no es anterior a la nueva (se confirmo con una fecha menor), en la
 * confirmacion, y nunca despues del fin.
 */
function inicioDelPeriodo(
  m: ManualLicense,
  fin: string,
  confirmada: string
): string {
  for (const candidato of [m.renewsAt, m.periodStart, confirmada]) {
    if (candidato && Date.parse(candidato) < Date.parse(fin)) {
      return candidato;
    }
  }
  return fin;
}

export interface EstadoLicencias {
  manuales: ManualLicense[];
  ajustes: Ajustes;
}

/**
 * Registra "ya se renovo": `renewedAt = ahora`, quien lo confirmo, y deja el
 * costo, la moneda y la siguiente fecha vigentes. En una licencia a mano esos
 * tres campos se actualizan en la licencia misma (una sola fuente de verdad);
 * en una de proveedor quedan en su ajuste, encima de lo que mande el
 * proveedor. Con `soloHistorial` (los dominios, que guardan su propia fecha y
 * costo) el ajuste solo lleva la confirmacion.
 */
export function registrarRenovacion(
  estado: EstadoLicencias,
  entrada: EntradaRenovacion,
  por: string,
  ahora: Date,
  soloHistorial = false
): EstadoLicencias & { renovacion: LicenseRenewal } {
  const en = ahora.toISOString();
  const renovacion: LicenseRenewal = {
    at: en,
    by: por,
    ...(entrada.costo !== undefined ? { cost: entrada.costo } : {}),
    ...(entrada.moneda ? { currency: entrada.moneda } : {}),
    renewsAt: entrada.renuevaEn,
    ...(entrada.nota ? { note: entrada.nota } : {})
  };
  const previo = estado.ajustes[entrada.id];
  const historial = [...(previo?.history ?? []), renovacion].slice(
    -MAX_HISTORIAL
  );
  const manual = estado.manuales.find((m) => m.id === entrada.id);
  const enLicencia = manual !== undefined || soloHistorial;
  const ajuste: LicenseAdjustment = {
    ...(previo ?? {}),
    ...(enLicencia
      ? {}
      : {
          ...(entrada.costo !== undefined ? { cost: entrada.costo } : {}),
          ...(entrada.moneda ? { currency: entrada.moneda } : {}),
          renewsAt: entrada.renuevaEn
        }),
    renewedAt: en,
    confirmedBy: por,
    history: historial
  };
  const manuales = manual
    ? estado.manuales.map((m) =>
        m.id !== manual.id
          ? m
          : {
              ...m,
              ...(entrada.costo !== undefined
                ? { cost: entrada.costo, used: entrada.costo }
                : {}),
              ...(entrada.moneda ? { currency: entrada.moneda } : {}),
              renewsAt: entrada.renuevaEn,
              periodStart: inicioDelPeriodo(m, entrada.renuevaEn, en),
              periodEnd: entrada.renuevaEn,
              renewedAt: en,
              renewalConfirmedBy: por,
              updatedAt: en
            }
      )
    : estado.manuales;
  return {
    manuales,
    ajustes: { ...estado.ajustes, [entrada.id]: ajuste },
    renovacion
  };
}

// --- Combinar con lo que mandan las fuentes --------------------------------

/**
 * La fecha de renovacion que vale: la del ajuste mientras siga vigente. Si el
 * ajuste ya venció y el proveedor manda una fecha posterior, el proveedor ya
 * renovo por su lado y manda el.
 */
export function renovacionVigente(
  deFuente: string | undefined,
  delAjuste: string | undefined,
  ahora: Date
): string | undefined {
  if (!delAjuste) {
    return deFuente;
  }
  if (
    deFuente &&
    Date.parse(delAjuste) <= ahora.getTime() &&
    Date.parse(deFuente) > Date.parse(delAjuste)
  ) {
    return deFuente;
  }
  return delAjuste;
}

/**
 * La confirmacion de renovacion vale mientras la fecha vigente sea la que se
 * dejo al confirmar. Si el proveedor ya movio la suya (el ajuste vencio y mando
 * una posterior), la confirmacion es de un periodo anterior y no se muestra.
 */
export function confirmacionVigente(
  ajuste: LicenseAdjustment,
  renewsAtVigente: string | undefined
): boolean {
  return !ajuste.renewsAt || ajuste.renewsAt === renewsAtVigente;
}

/**
 * Lo que llego de las fuentes con las correcciones encima, sin las ocultas, y
 * con las licencias a mano al final. Es lo que ven las alertas, el resumen y
 * (con la misma regla, en el portal) el tablero.
 */
export function aplicarAjustes(
  deFuentes: readonly LicenseUsage[],
  manuales: readonly LicenseUsage[],
  ajustes: Ajustes,
  ahora: Date
): LicenseUsage[] {
  return [...deFuentes, ...manuales]
    .filter((l) => !ajustes[l.id]?.hidden)
    .map((l) => {
      const a = ajustes[l.id];
      if (!a) {
        return l;
      }
      const cost = a.cost ?? l.cost;
      const renewsAt = renovacionVigente(l.renewsAt, a.renewsAt, ahora);
      const corregida: LicenseUsage = {
        ...l,
        ...(cost !== undefined ? { cost } : {}),
        ...((a.currency ?? l.currency)
          ? { currency: a.currency ?? l.currency }
          : {}),
        ...((a.plan ?? l.plan) ? { plan: a.plan ?? l.plan } : {}),
        ...(renewsAt ? { renewsAt } : {}),
        ...(a.renewedAt && confirmacionVigente(a, renewsAt)
          ? { renewedAt: a.renewedAt }
          : {}),
        ...(a.confirmedBy && a.renewedAt && confirmacionVigente(a, renewsAt)
          ? { renewalConfirmedBy: a.confirmedBy }
          : {})
      };
      // Cuando la unidad es dinero, lo consumido del periodo es el costo.
      return corregida.unit === 'dinero' && a.cost !== undefined
        ? { ...corregida, used: a.cost }
        : corregida;
    });
}

// --- Migracion desde un navegador -------------------------------------------

export interface Saneada {
  id: string;
  campo: string;
  motivo: string;
}

export interface Descartada {
  id: string;
  tipo: 'manual' | 'ajuste';
  motivo: string;
}

export interface Conflicto {
  id: string;
  producto: string;
  campo: string;
  local: string;
  servidor: string;
}

export interface ResultadoMigracion extends EstadoLicencias {
  /** Cuantos registros entraron (licencias a mano + ajustes). */
  migradas: number;
  /** Campos que venian mal y se corrigieron o quitaron para poder subir el registro. */
  saneadas: Saneada[];
  /** Registros que no se pudieron subir (siguen en el navegador). */
  descartadas: Descartada[];
  /** Ya existian en el servidor con otros datos: se conservo lo del servidor. */
  conflictos: Conflicto[];
}

type Validador = (valor: unknown) => unknown;

/**
 * Prueba cada campo de `c`; el que no pasa se quita (el registro se sube sin
 * el) y se anota en `saneadas`. Los formularios viejos aceptaban cualquier cosa
 * (una moneda "$", un costo negativo): un dato malo no debe dejar sin subir
 * una licencia entera.
 */
function sanearCampos(
  id: string,
  c: Record<string, unknown>,
  campos: [string, Validador, string][],
  saneadas: Saneada[]
): void {
  for (const [campo, validar, motivo] of campos) {
    const v = c[campo];
    if (v === undefined || v === null || v === '') {
      continue;
    }
    try {
      validar(v);
    } catch {
      delete c[campo];
      saneadas.push({ id, campo, motivo });
    }
  }
}

const VALIDADORES_COMUNES: [string, Validador, string][] = [
  ['cost', (v) => costoValido(v, 'El costo'), 'costo no válido, se quitó'],
  [
    'currency',
    (v) => monedaValida(v, 'La moneda'),
    'moneda no válida, se usó la de omisión (MXN)'
  ],
  [
    'renewsAt',
    (v) => fechaValida(v, 'La fecha de renovación'),
    'fecha de renovación no válida, se quitó'
  ],
  [
    'renewedAt',
    (v) => fechaValida(v, 'La fecha de la confirmación'),
    'fecha de confirmación no válida, se quitó'
  ]
];

/** Una licencia a mano de un navegador, con sus campos malos corregidos. */
export function sanearManual(
  crudo: unknown,
  ahora: Date
): { licencia: ManualLicense; saneadas: Saneada[] } {
  const c = { ...((crudo ?? {}) as Record<string, unknown>) };
  const id = typeof c['id'] === 'string' ? c['id'] : '(sin id)';
  const saneadas: Saneada[] = [];
  sanearCampos(
    id,
    c,
    [
      ...VALIDADORES_COMUNES,
      ['url', urlValida, 'liga no válida, se quitó'],
      [
        'periodStart',
        (v) => fechaValida(v, 'El inicio del periodo'),
        'inicio de periodo no válido, se quitó'
      ],
      [
        'provider',
        (v) => {
          if (!PROVEEDORES.includes(v as LicenseProvider)) {
            throw new Error('proveedor');
          }
        },
        'proveedor no válido, se usó "otro"'
      ],
      [
        'period',
        (v) => {
          if (!PERIODOS.includes(v as ManualLicensePeriod)) {
            throw new Error('periodo');
          }
        },
        'periodo no válido, se dedujo del plan'
      ]
    ],
    saneadas
  );
  return { licencia: validarManual(c, undefined, ahora), saneadas };
}

/**
 * Una correccion de un navegador, saneada campo por campo. Conserva la
 * confirmacion de renovacion y su historial. `undefined` si no quedo nada.
 */
export function sanearAjuste(
  id: string,
  crudo: unknown
): { ajuste?: LicenseAdjustment; saneadas: Saneada[] } {
  const c = { ...((crudo ?? {}) as Record<string, unknown>) };
  const saneadas: Saneada[] = [];
  sanearCampos(id, c, VALIDADORES_COMUNES, saneadas);
  const ajuste: LicenseAdjustment = { history: [] };
  const costo = costoValido(c['cost'], 'El costo');
  if (costo !== undefined) {
    ajuste.cost = costo;
  }
  const moneda = monedaValida(c['currency'], 'La moneda');
  if (moneda) {
    ajuste.currency = moneda;
  }
  const plan = texto(c['plan'], 80);
  if (plan) {
    ajuste.plan = plan;
  }
  const renueva = fechaValida(c['renewsAt'], 'La fecha de renovación');
  if (renueva) {
    ajuste.renewsAt = renueva;
  }
  if (c['hidden'] === true) {
    ajuste.hidden = true;
  }
  const confirmada = fechaValida(c['renewedAt'], 'La fecha de la confirmación');
  if (confirmada) {
    ajuste.renewedAt = confirmada;
    ajuste.confirmedBy = texto(c['confirmedBy'], 120) ?? 'este navegador';
  }
  if (Array.isArray(c['history'])) {
    let descartadas = 0;
    const historial: LicenseRenewal[] = [];
    for (const h of c['history'] as unknown[]) {
      const e = (h && typeof h === 'object' ? h : {}) as Record<
        string,
        unknown
      >;
      try {
        const at = fechaValida(e['at'], 'La fecha de la confirmación');
        if (!at) {
          throw new Error('sin fecha');
        }
        const entrada: LicenseRenewal = {
          at,
          by: texto(e['by'], 120) ?? 'este navegador'
        };
        const parcial = { ...e };
        const mal: Saneada[] = [];
        sanearCampos(id, parcial, VALIDADORES_COMUNES, mal);
        if (mal.length > 0) {
          descartadas++;
        }
        const cost = costoValido(parcial['cost'], 'El costo');
        if (cost !== undefined) {
          entrada.cost = cost;
        }
        const currency = monedaValida(parcial['currency'], 'La moneda');
        if (currency) {
          entrada.currency = currency;
        }
        const renewsAt = fechaValida(
          parcial['renewsAt'],
          'La fecha de renovación'
        );
        if (renewsAt) {
          entrada.renewsAt = renewsAt;
        }
        const note = texto(e['note'], 300);
        if (note) {
          entrada.note = note;
        }
        historial.push(entrada);
      } catch {
        descartadas++;
      }
    }
    if (descartadas > 0) {
      saneadas.push({
        id,
        campo: 'history',
        motivo: `${descartadas} confirmaciones del historial traían datos no válidos (se quitaron o se corrigieron)`
      });
    }
    ajuste.history = historial.slice(-MAX_HISTORIAL);
  }
  const vacio =
    ajuste.cost === undefined &&
    !ajuste.currency &&
    !ajuste.plan &&
    !ajuste.renewsAt &&
    !ajuste.hidden &&
    !ajuste.renewedAt &&
    ajuste.history.length === 0;
  return { ...(vacio ? {} : { ajuste }), saneadas };
}

/**
 * Sube lo capturado en un navegador sin pisar lo que el servidor ya tiene (por
 * id). Cada registro se sanea por su cuenta: un dato malo se corrige o se
 * quita y se reporta; solo el registro irrecuperable se descarta (y el portal
 * lo deja en el navegador). La correccion de una licencia a mano nueva se
 * pliega en la licencia misma, como hace `ajustes/guardar`.
 */
export function migrarLicencias(
  estado: EstadoLicencias,
  entrada: { manuales?: unknown; ajustes?: unknown },
  ahora: Date
): ResultadoMigracion {
  let manuales = estado.manuales;
  const ajustes: Ajustes = { ...estado.ajustes };
  const saneadas: Saneada[] = [];
  const descartadas: Descartada[] = [];
  const conflictos: Conflicto[] = [];
  const nuevas = new Set<string>();
  const deEstaSubida = new Set<string>();
  let migradas = 0;

  const crudasManuales = Array.isArray(entrada.manuales)
    ? entrada.manuales
    : [];
  for (const cruda of crudasManuales) {
    const id = (cruda as { id?: unknown } | null)?.id;
    const nombre = typeof id === 'string' ? id : '(sin id)';
    if (typeof id === 'string' && deEstaSubida.has(id)) {
      descartadas.push({
        id,
        tipo: 'manual',
        motivo: 'id repetido en la misma subida'
      });
      continue;
    }
    if (typeof id === 'string') {
      deEstaSubida.add(id);
      const enServidor = manuales.find((m) => m.id === id);
      if (enServidor) {
        // Gana el servidor, pero lo que difiere se avisa: el navegador se limpia.
        conflictos.push(...conflictosDe(enServidor, cruda, ahora));
        continue;
      }
    }
    if (manuales.length >= MAX_MANUALES) {
      descartadas.push({
        id: nombre,
        tipo: 'manual',
        motivo: `el servidor admite hasta ${MAX_MANUALES} licencias a mano`
      });
      continue;
    }
    try {
      const r = sanearManual(cruda, ahora);
      if (manuales.some((m) => m.id === r.licencia.id)) {
        continue;
      }
      manuales = [...manuales, r.licencia];
      nuevas.add(r.licencia.id);
      saneadas.push(...r.saneadas);
      migradas++;
    } catch (error) {
      descartadas.push({
        id: nombre,
        tipo: 'manual',
        motivo: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const crudosAjustes =
    entrada.ajustes && typeof entrada.ajustes === 'object'
      ? Object.entries(entrada.ajustes as Record<string, unknown>)
      : [];
  for (const [id, cruda] of crudosAjustes) {
    if (!idLimpio(id)) {
      descartadas.push({
        id: id.slice(0, 60),
        tipo: 'ajuste',
        motivo: 'el id de la licencia no es válido'
      });
      continue;
    }
    if (ajustes[id]) {
      const local = sanearAjuste(id, cruda).ajuste;
      if (local) {
        conflictos.push(...conflictosAjuste(id, ajustes[id], local));
      }
      continue;
    }
    const r = sanearAjuste(id, cruda);
    if (!r.ajuste) {
      continue;
    }
    if (Object.keys(ajustes).length >= MAX_AJUSTES) {
      descartadas.push({
        id,
        tipo: 'ajuste',
        motivo: `el servidor admite hasta ${MAX_AJUSTES} correcciones`
      });
      continue;
    }
    saneadas.push(...r.saneadas);
    let ajuste = r.ajuste;
    if (manuales.some((m) => m.id === id)) {
      // La correccion de una licencia a mano va en la licencia misma.
      const { cost, currency, plan, renewsAt, ...resto } = ajuste;
      if (nuevas.has(id)) {
        manuales = manuales.map((m) =>
          m.id !== id
            ? m
            : validarManual(
                {
                  ...m,
                  ...(cost !== undefined ? { cost } : {}),
                  ...(currency ? { currency } : {}),
                  ...(plan ? { plan } : {}),
                  ...(renewsAt ? { renewsAt } : {})
                },
                m,
                ahora
              )
        );
      }
      ajuste = resto;
      if (!ajuste.hidden && !ajuste.renewedAt && ajuste.history.length === 0) {
        migradas++;
        continue;
      }
    }
    ajustes[id] = ajuste;
    migradas++;
  }

  return { manuales, ajustes, migradas, saneadas, descartadas, conflictos };
}

const dia = (iso: string | undefined) => (iso ? iso.slice(0, 10) : '');

/** Los campos que se muestran al usuario cuando local y servidor difieren. */
function camposComparables(c: {
  cost?: number;
  currency?: string;
  plan?: string;
  renewsAt?: string;
}): Record<string, string> {
  return {
    costo: c.cost === undefined ? '' : String(c.cost),
    moneda: c.currency ?? '',
    plan: c.plan ?? '',
    renovación: dia(c.renewsAt)
  };
}

function diferencias(
  id: string,
  producto: string,
  local: Record<string, string>,
  servidor: Record<string, string>,
  presentes: string[]
): Conflicto[] {
  return presentes
    .filter((campo) => local[campo] !== servidor[campo])
    .map((campo) => ({
      id,
      producto,
      campo,
      local: local[campo] || '(vacío)',
      servidor: servidor[campo] || '(vacío)'
    }));
}

/** Lo que una licencia a mano del navegador dice distinto de la que ya hay. */
function conflictosDe(
  enServidor: ManualLicense,
  cruda: unknown,
  ahora: Date
): Conflicto[] {
  try {
    const c = (cruda ?? {}) as Record<string, unknown>;
    const { licencia } = sanearManual(cruda, ahora);
    const local = camposComparables(licencia);
    // Solo lo que el navegador realmente traia (sin los valores por omision).
    const claves: [string, string][] = [
      ['cost', 'costo'],
      ['currency', 'moneda'],
      ['plan', 'plan'],
      ['renewsAt', 'renovación']
    ];
    const presentes = claves
      .filter(([k]) => c[k] !== undefined && c[k] !== null && c[k] !== '')
      .map(([, campo]) => campo);
    return diferencias(
      enServidor.id,
      enServidor.product,
      local,
      camposComparables(enServidor),
      presentes
    );
  } catch {
    return [];
  }
}

function conflictosAjuste(
  id: string,
  servidor: LicenseAdjustment,
  local: LicenseAdjustment
): Conflicto[] {
  const presentes = Object.entries(camposComparables(local))
    .filter(([, v]) => v !== '')
    .map(([k]) => k);
  return diferencias(
    id,
    id,
    camposComparables(local),
    camposComparables(servidor),
    presentes
  );
}
