import {
  LicenseAdjustment,
  LicenseUsage,
  ManualLicense,
  ManualLicensePeriod,
  daysToRenewal
} from '../models';
import { plural } from '../util/text.util';

/**
 * La parte pura de renovar licencias: sugerir la siguiente fecha, decir en qué
 * estado de renovación está una licencia y combinar lo que mandan las fuentes
 * con las correcciones y altas que viven en el puente. La del puente
 * (`puente/src/datos/licencias.ts`) aplica la misma regla para las alertas.
 */

/** A partir de aquí una renovación cercana se marca como aviso. */
export const DIAS_AVISO_RENOVACION = 14;

const DIA_MS = 86_400_000;

export type TonoRenovacion = 'ok' | 'warn' | 'danger' | 'neutro';

export interface EstadoRenovacion {
  tipo: 'confirmada' | 'proxima' | 'lejana' | 'vencida' | 'sinfecha';
  tono: TonoRenovacion;
  texto: string;
  /** Lo mismo, más corto, para tarjetas chicas (carrusel en celular). */
  corto: string;
  /** Días que faltan (negativo si ya pasó); `undefined` sin fecha. */
  dias?: number;
}

const DIA_CORTO = new Intl.DateTimeFormat('es-MX', {
  day: 'numeric',
  month: 'short'
});

/** `2026-11-05` de una fecha ISO (el día que se capturó, sin zona horaria). */
export function diaDe(iso: string | undefined): string | undefined {
  return iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : undefined;
}

/** Hoy como `YYYY-MM-DD` en la zona de quien mira. */
export function hoyYmd(hoy = new Date()): string {
  const m = String(hoy.getMonth() + 1).padStart(2, '0');
  const d = String(hoy.getDate()).padStart(2, '0');
  return `${hoy.getFullYear()}-${m}-${d}`;
}

/** Una fecha de calendario más `meses` meses, sin pasarse del fin de mes. */
export function sumarMeses(ymd: string, meses: number): string {
  const [a, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const total = a * 12 + (m - 1) + meses;
  const anio = Math.floor(total / 12);
  const mes = total % 12;
  const ultimo = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  const dia = Math.min(d, ultimo);
  return `${anio}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** La fecha de calendario como ISO al mediodía UTC (el día no se mueve por zona). */
export function ymdAIso(ymd: string): string {
  return `${ymd}T12:00:00.000Z`;
}

/**
 * Cada cuántos meses se paga. Una licencia a mano lo dice (`period`); las
 * demás se deducen del plan ("anual", "monthly"…) y, si no, de lo que dura su
 * periodo.
 */
export function periodoEnMeses(licencia: LicenseUsage): number {
  const periodo = (licencia as { period?: ManualLicensePeriod }).period;
  if (periodo === 'anual') {
    return 12;
  }
  if (periodo === 'mensual') {
    return 1;
  }
  const plan = (licencia.plan ?? '').toLowerCase();
  if (/anual|annual|year/.test(plan)) {
    return 12;
  }
  if (/mensual|monthly|month/.test(plan)) {
    return 1;
  }
  const dias =
    (Date.parse(licencia.periodEnd) - Date.parse(licencia.periodStart)) /
    DIA_MS;
  return Number.isFinite(dias) && dias > 200 ? 12 : 1;
}

/**
 * La siguiente renovación que se propone al confirmar: la fecha actual más un
 * periodo; si esa fecha ya está vencida, la primera que cae en el futuro
 * (contando siempre desde el día original, para que 31 ene → 28 feb → 31 mar).
 */
export function sugerirProximaRenovacion(
  licencia: LicenseUsage,
  hoy = new Date()
): string {
  const base = diaDe(licencia.renewsAt) ?? hoyYmd(hoy);
  const paso = periodoEnMeses(licencia);
  const limite = hoyYmd(hoy);
  let siguiente = sumarMeses(base, paso);
  for (let k = 2; siguiente <= limite && k < 600; k++) {
    siguiente = sumarMeses(base, paso * k);
  }
  return siguiente;
}

/** Cómo va la renovación de una licencia, para el chip de la tarjeta. */
export function estadoRenovacion(
  licencia: LicenseUsage,
  hoy = new Date()
): EstadoRenovacion {
  const dias = daysToRenewal(licencia, hoy);
  if (dias === undefined) {
    return {
      tipo: 'sinfecha',
      tono: 'neutro',
      texto: 'Sin fecha de renovación',
      corto: 'Sin fecha'
    };
  }
  if (dias < 0) {
    return {
      tipo: 'vencida',
      tono: 'danger',
      texto: 'Vencida: ¿ya se renovó?',
      corto: 'Vencida: ¿renovó?',
      dias
    };
  }
  const cuando =
    dias === 0
      ? 'Renueva hoy'
      : dias === 1
        ? 'Renueva mañana'
        : `Renueva en ${plural(dias, 'día')}`;
  if (dias <= DIAS_AVISO_RENOVACION) {
    return {
      tipo: 'proxima',
      tono: 'warn',
      texto: cuando,
      corto: cuando,
      dias
    };
  }
  if (licencia.renewedAt) {
    const dia = DIA_CORTO.format(new Date(licencia.renewedAt));
    return {
      tipo: 'confirmada',
      tono: 'ok',
      texto: `Renovada · confirmada el ${dia}`,
      corto: `Renovada · ${dia}`,
      dias
    };
  }
  return { tipo: 'lejana', tono: 'neutro', texto: cuando, corto: cuando, dias };
}

/** La clase de color del texto para un tono (tokens del tema, sin inventar). */
export function claseTono(tono: TonoRenovacion): string {
  switch (tono) {
    case 'ok':
      return 'text-ok';
    case 'warn':
      return 'text-warn';
    case 'danger':
      return 'text-danger';
    default:
      return 'text-ink-muted';
  }
}

/** El chip (fondo suave y texto del tono) de un estado de renovación. */
export function claseChip(tono: TonoRenovacion): string {
  switch (tono) {
    case 'ok':
      return 'bg-ok/10 text-ok';
    case 'warn':
      return 'bg-warn/10 text-warn';
    case 'danger':
      return 'bg-danger/10 text-danger';
    default:
      return 'bg-surface-muted text-ink-muted';
  }
}

/**
 * La fecha de renovación que vale: la del ajuste mientras siga vigente. Si el
 * ajuste ya venció y el proveedor manda una fecha posterior, el proveedor ya
 * renovó por su lado y manda él.
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
 * La confirmación de renovación vale mientras la fecha vigente sea la que se
 * dejó al confirmar. Si el proveedor ya movió la suya, la confirmación es de un
 * periodo anterior y el chip no debe seguir diciendo "Renovada".
 */
export function confirmacionVigente(
  ajuste: LicenseAdjustment,
  renewsAtVigente: string | undefined
): boolean {
  return !ajuste.renewsAt || ajuste.renewsAt === renewsAtVigente;
}

/**
 * Lo que llegó de las fuentes con las correcciones encima, sin las ocultas, y
 * con las licencias a mano al final.
 */
export function aplicarLicencias(
  deFuentes: readonly LicenseUsage[],
  manuales: readonly LicenseUsage[],
  ajustes: Readonly<Record<string, LicenseAdjustment>>,
  ahora = new Date()
): LicenseUsage[] {
  return [...deFuentes, ...manuales]
    .filter((licencia) => !ajustes[licencia.id]?.hidden)
    .map((licencia) => {
      const a = ajustes[licencia.id];
      if (!a) {
        return licencia;
      }
      const cost = a.cost ?? licencia.cost;
      const currency = a.currency ?? licencia.currency;
      const plan = a.plan ?? licencia.plan;
      const renewsAt = renovacionVigente(licencia.renewsAt, a.renewsAt, ahora);
      const corregida: LicenseUsage = {
        ...licencia,
        ...(cost !== undefined ? { cost } : {}),
        ...(currency ? { currency } : {}),
        ...(plan ? { plan } : {}),
        ...(renewsAt ? { renewsAt } : {}),
        ...(a.renewedAt && confirmacionVigente(a, renewsAt)
          ? { renewedAt: a.renewedAt }
          : {}),
        ...(a.renewedAt && a.confirmedBy && confirmacionVigente(a, renewsAt)
          ? { renewalConfirmedBy: a.confirmedBy }
          : {})
      };
      // Cuando la unidad es dinero, lo consumido del periodo es el costo.
      return corregida.unit === 'dinero' && a.cost !== undefined
        ? { ...corregida, used: a.cost }
        : corregida;
    });
}

const PROVEEDORES: LicenseUsage['provider'][] = [
  'anthropic',
  'cursor',
  'figma',
  'vercel',
  'otro'
];
const UNIDADES: LicenseUsage['unit'][] = [
  'asientos',
  'tokens',
  'solicitudes',
  'dinero'
];
const MS_MINIMO = Date.UTC(2000, 0, 1);
const MS_MAXIMO = Date.UTC(2100, 11, 31);

/** Una fecha ISO dentro de 2000-2100, o `undefined`. */
function fechaSana(valor: unknown): string | undefined {
  if (typeof valor !== 'string') {
    return undefined;
  }
  const ms = Date.parse(valor);
  return Number.isFinite(ms) && ms >= MS_MINIMO && ms <= MS_MAXIMO
    ? new Date(ms).toISOString()
    : undefined;
}

/**
 * Una licencia a mano guardada en este navegador, con todo lo que el resto del
 * portal da por supuesto (proveedor, unidad, miembros, fechas del periodo...)
 * relleno con valores por omisión. `undefined` si no tiene ni id ni producto.
 * Nunca lanza, sea cual sea el contenido del localStorage.
 */
export function normalizarManual(
  crudo: unknown,
  ahora = new Date()
): ManualLicense | undefined {
  if (!crudo || typeof crudo !== 'object' || Array.isArray(crudo)) {
    return undefined;
  }
  const c = crudo as Record<string, unknown>;
  const id = typeof c['id'] === 'string' ? c['id'].trim() : '';
  const product = typeof c['product'] === 'string' ? c['product'].trim() : '';
  if (!id || !product) {
    return undefined;
  }
  const texto = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined;
  const cost =
    typeof c['cost'] === 'number' &&
    Number.isFinite(c['cost']) &&
    c['cost'] >= 0
      ? c['cost']
      : undefined;
  const currency = /^[A-Za-z]{3}$/.test(texto(c['currency']) ?? '')
    ? (texto(c['currency']) as string).toUpperCase()
    : 'MXN';
  const plan = texto(c['plan']);
  const periodo = c['period'];
  const period: ManualLicensePeriod =
    periodo === 'mensual' || periodo === 'anual' || periodo === 'otro'
      ? periodo
      : /anual/i.test(plan ?? '')
        ? 'anual'
        : 'mensual';
  const renewsAt = fechaSana(c['renewsAt']);
  const ahoraIso = ahora.toISOString();
  const inicio = fechaSana(c['periodStart']) ?? ahoraIso;
  const fin = fechaSana(c['periodEnd']) ?? renewsAt ?? inicio;
  const provider = PROVEEDORES.includes(c['provider'] as never)
    ? (c['provider'] as LicenseUsage['provider'])
    : 'otro';
  const unit = UNIDADES.includes(c['unit'] as never)
    ? (c['unit'] as LicenseUsage['unit'])
    : 'dinero';
  const renewedAt = fechaSana(c['renewedAt']);
  const url = texto(c['url']);
  const limite =
    typeof c['limit'] === 'number' && Number.isFinite(c['limit'])
      ? c['limit']
      : undefined;
  return {
    id,
    provider,
    product,
    ...(plan ? { plan } : {}),
    unit,
    used:
      typeof c['used'] === 'number' && Number.isFinite(c['used'])
        ? c['used']
        : (cost ?? 0),
    ...(limite !== undefined ? { limit: limite } : {}),
    // El periodo nunca termina antes de empezar.
    periodStart: Date.parse(inicio) > Date.parse(fin) ? fin : inicio,
    periodEnd: fin,
    ...(cost !== undefined ? { cost } : {}),
    currency,
    ...(renewsAt ? { renewsAt } : {}),
    ...(renewedAt ? { renewedAt } : {}),
    ...(renewedAt && texto(c['renewalConfirmedBy'])
      ? { renewalConfirmedBy: texto(c['renewalConfirmedBy']) as string }
      : {}),
    manual: true,
    members: [],
    accountId: texto(c['accountId']) ?? '',
    ...(url ? { url } : {}),
    updatedAt: fechaSana(c['updatedAt']) ?? ahoraIso,
    period,
    ...(texto(c['notes']) ? { notes: texto(c['notes']) as string } : {})
  };
}

/** Una licencia a mano guardada antes de que existiera el periodo. */
export function manualDeLocal(licencia: LicenseUsage): ManualLicense {
  return (
    normalizarManual(licencia) ?? {
      ...(licencia as ManualLicense),
      manual: true,
      period: 'mensual'
    }
  );
}

export interface EstadoServidor {
  manuales: readonly ManualLicense[];
  ajustes: Readonly<Record<string, LicenseAdjustment>>;
}

export interface LicenciasConLocales {
  manuales: ManualLicense[];
  ajustes: Record<string, LicenseAdjustment>;
  /** Licencias a mano que solo existen en este navegador (aún no subidas). */
  manualesSoloLocal: Set<string>;
  /** Correcciones que solo existen en este navegador. */
  ajustesSoloLocal: Set<string>;
}

/**
 * Lo del servidor más, provisionalmente, lo que este navegador capturó antes de
 * que existiera el servidor y todavía no se sube. Solo entran los ids que el
 * servidor no tiene (lo del servidor manda). Tolera un localStorage
 * corrupto: lo que no es un objeto bien formado se ignora.
 */
export function combinarConLocales(
  servidor: EstadoServidor,
  local: {
    manuales: readonly unknown[];
    ajustes: Readonly<Record<string, unknown>>;
  }
): LicenciasConLocales {
  const ids = new Set(servidor.manuales.map((m) => m.id));
  const manualesSoloLocal = new Set<string>();
  const provisionales: ManualLicense[] = [];
  for (const l of local.manuales) {
    const m = normalizarManual(l);
    if (!m || ids.has(m.id) || manualesSoloLocal.has(m.id)) {
      continue;
    }
    manualesSoloLocal.add(m.id);
    provisionales.push(m);
  }
  const ajustes: Record<string, LicenseAdjustment> = { ...servidor.ajustes };
  const ajustesSoloLocal = new Set<string>();
  for (const [id, e] of Object.entries(local.ajustes)) {
    if (
      servidor.ajustes[id] ||
      !e ||
      typeof e !== 'object' ||
      Array.isArray(e)
    ) {
      continue;
    }
    const edicion = e as Partial<LicenseAdjustment>;
    ajustes[id] = {
      ...edicion,
      history: Array.isArray(edicion.history) ? edicion.history : []
    };
    ajustesSoloLocal.add(id);
  }
  return {
    manuales: [...servidor.manuales, ...provisionales],
    ajustes,
    manualesSoloLocal,
    ajustesSoloLocal
  };
}
