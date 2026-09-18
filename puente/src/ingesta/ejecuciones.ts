import { ErrorPuente } from '../nucleo/errores.js';

/**
 * La ultima corrida de cada integracion.
 *
 * Cada aplicacion que corre (una sincronizacion con Odoo, un barrido, un
 * cron) manda al terminar como le fue, con su token de emisor. Aqui se
 * guarda solo lo ultimo por integracion (no un historial): la pregunta que
 * contesta es "¿cuando corrio por ultima vez y como le fue?", y de paso
 * cuantas veces ha corrido y cuantas seguidas ha fallado.
 */
export type ResultadoEjecucion = 'ok' | 'aviso' | 'error';

/** Lo que se ve: el resultado que mando, o "atrasada" si ya deberia haber corrido. */
export type EstadoEjecucion = ResultadoEjecucion | 'atrasada';

export interface Ejecucion {
  /** `${emisor}/${integracion}`: la misma integracion en dos emisores son dos. */
  clave: string;
  /** Identificador corto que manda la aplicacion (odoo-sync, barrido-correo). */
  integracion: string;
  /** Como se muestra; si no mandan nombre, el identificador. */
  nombre: string;
  emisor: string;
  resultado: ResultadoEjecucion;
  mensaje?: string;
  /** Texto largo: el error completo, cifras, lo que quieran dejar. */
  detalle?: string;
  duracionMs?: number;
  empezoEn?: string;
  /** Cuando termino de correr (lo que manden, o cuando llego). */
  terminoEn: string;
  recibidoEn: string;
  /** Cada cuanto se espera que corra; con esto se marca "atrasada". */
  cadaMinutos?: number;
  corridas: number;
  ultimoOkEn?: string;
  ultimoErrorEn?: string;
  erroresSeguidos: number;
}

export type Ejecuciones = Record<string, Ejecucion>;

/** Lo que manda la aplicacion. Acepta `estado` o `resultado`, y `ok: true/false`. */
export interface EnvioEjecucion {
  integracion?: string;
  nombre?: string;
  estado?: string;
  resultado?: string;
  ok?: boolean;
  mensaje?: string;
  detalle?: string;
  duracionMs?: number;
  empezoEn?: string;
  terminoEn?: string;
  cadaMinutos?: number;
}

const RESULTADOS: ResultadoEjecucion[] = ['ok', 'aviso', 'error'];

/** Margen sobre la frecuencia esperada antes de marcar "atrasada". */
const HOLGURA = 1.5;
const HOLGURA_MINIMA_MS = 5 * 60_000;

/** Registra (o reemplaza) la ultima corrida de una integracion. */
export function registrarEjecucion(
  previas: Ejecuciones,
  emisor: string,
  envio: EnvioEjecucion,
  ahora = new Date()
): { ejecuciones: Ejecuciones; ejecucion: Ejecucion } {
  const integracion = (envio.integracion ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  if (!integracion) {
    throw new ErrorPuente(
      'Falta "integracion": un identificador corto de lo que corrió (odoo-sync, barrido-correo).',
      400
    );
  }
  const crudo = (envio.resultado ?? envio.estado ?? '')
    .toString()
    .toLowerCase();
  const resultado: ResultadoEjecucion | undefined = RESULTADOS.includes(
    crudo as ResultadoEjecucion
  )
    ? (crudo as ResultadoEjecucion)
    : typeof envio.ok === 'boolean'
      ? envio.ok
        ? 'ok'
        : 'error'
      : undefined;
  if (!resultado) {
    throw new ErrorPuente(
      'Falta "estado": ok, aviso o error (o "ok": true/false).',
      400
    );
  }
  const recibidoEn = ahora.toISOString();
  const terminoEn = fechaValida(envio.terminoEn) ?? recibidoEn;
  const empezoEn = fechaValida(envio.empezoEn);
  const clave = `${emisor}/${integracion}`;
  const previa = previas[clave];
  const duracionMs =
    numeroPositivo(envio.duracionMs) ??
    (empezoEn ? Date.parse(terminoEn) - Date.parse(empezoEn) : undefined);
  const ejecucion: Ejecucion = {
    clave,
    integracion,
    nombre: textoCorto(envio.nombre, 80) ?? previa?.nombre ?? integracion,
    emisor,
    resultado,
    mensaje: textoCorto(envio.mensaje, 240),
    detalle: textoCorto(envio.detalle, 4000),
    duracionMs:
      duracionMs !== undefined && duracionMs >= 0 ? duracionMs : undefined,
    empezoEn,
    terminoEn,
    recibidoEn,
    cadaMinutos: numeroPositivo(envio.cadaMinutos) ?? previa?.cadaMinutos,
    corridas: (previa?.corridas ?? 0) + 1,
    ultimoOkEn: resultado === 'ok' ? terminoEn : previa?.ultimoOkEn,
    ultimoErrorEn: resultado === 'error' ? terminoEn : previa?.ultimoErrorEn,
    erroresSeguidos:
      resultado === 'error' ? (previa?.erroresSeguidos ?? 0) + 1 : 0
  };
  return { ejecuciones: { ...previas, [clave]: ejecucion }, ejecucion };
}

/** El estado que se muestra: lo que mando, salvo que ya deberia haber vuelto a correr. */
export function estadoDe(e: Ejecucion, ahora = new Date()): EstadoEjecucion {
  if (e.cadaMinutos) {
    const esperado = e.cadaMinutos * 60_000;
    const tope = Math.max(esperado * HOLGURA, esperado + HOLGURA_MINIMA_MS);
    if (ahora.getTime() - Date.parse(e.terminoEn) > tope) {
      return 'atrasada';
    }
  }
  return e.resultado;
}

/** Las ejecuciones con su estado calculado, las que estan mal primero. */
export function listarEjecuciones(
  ejecuciones: Ejecuciones,
  ahora = new Date()
): (Ejecucion & { estado: EstadoEjecucion })[] {
  const peso: Record<EstadoEjecucion, number> = {
    error: 0,
    atrasada: 1,
    aviso: 2,
    ok: 3
  };
  return Object.values(ejecuciones)
    .map((e) => ({ ...e, estado: estadoDe(e, ahora) }))
    .sort(
      (a, b) =>
        peso[a.estado] - peso[b.estado] ||
        b.terminoEn.localeCompare(a.terminoEn)
    );
}

function fechaValida(v: unknown): string | undefined {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v))
    ? new Date(v).toISOString()
    : undefined;
}

function numeroPositivo(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0
    ? Math.round(n)
    : undefined;
}

function textoCorto(v: unknown, maximo: number): string | undefined {
  if (typeof v !== 'string') {
    return undefined;
  }
  const limpio = v.trim();
  return limpio ? limpio.slice(0, maximo) : undefined;
}
