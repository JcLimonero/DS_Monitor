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
/**
 * Sin frecuencia declarada, una integracion que lleva mas de una hora sin
 * reportar se da por atrasada; y por Telegram nunca se avisa antes de una
 * hora, aunque la frecuencia declarada sea mas corta.
 */
export const SILENCIO_MS = 60 * 60_000;

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

/** Cuanto puede callar una integracion antes de darse por atrasada. */
export function umbralSilencioMs(e: Ejecucion): number {
  if (!e.cadaMinutos) {
    return SILENCIO_MS;
  }
  const esperado = e.cadaMinutos * 60_000;
  return Math.max(esperado * HOLGURA, esperado + HOLGURA_MINIMA_MS);
}

/** Cuanto lleva sin reportar. */
export function silencioMs(e: Ejecucion, ahora = new Date()): number {
  return ahora.getTime() - Date.parse(e.terminoEn);
}

/** El estado que se muestra: lo que mando, salvo que ya deberia haber vuelto a correr. */
export function estadoDe(e: Ejecucion, ahora = new Date()): EstadoEjecucion {
  if (silencioMs(e, ahora) > umbralSilencioMs(e)) {
    return 'atrasada';
  }
  return e.resultado;
}

/** Por integracion, sobre que corrida ya se aviso (para no repetir). */
export interface AvisoEjecucion {
  /** `terminoEn` de la corrida tras la cual se aviso que callo. */
  silencio?: string;
  /** `terminoEn` de la corrida con error que se aviso. */
  error?: string;
}

export type AvisosEjecuciones = Record<string, AvisoEjecucion>;

/**
 * Que hay que avisar por Telegram en este momento, y como queda el registro
 * de avisados. Cada problema se avisa una vez: el silencio, cuando pasa mas
 * de una hora (o la frecuencia declarada, si es mayor) sin corrida nueva; el
 * error, al primer fallo de una racha. Y cuando vuelve a reportar bien, una
 * vez que volvio.
 */
export function avisosPendientes(
  ejecuciones: Ejecuciones,
  avisadas: AvisosEjecuciones,
  ahora = new Date()
): { lineas: string[]; avisadas: AvisosEjecuciones } {
  const lineas: string[] = [];
  const nuevas: AvisosEjecuciones = {};
  for (const e of Object.values(ejecuciones)) {
    const previo = avisadas[e.clave] ?? {};
    const actual: AvisoEjecucion = { ...previo };
    const silencio = silencioMs(e, ahora);
    const callada = silencio > Math.max(umbralSilencioMs(e), SILENCIO_MS);
    const quien = `<b>${escapar(e.nombre)}</b> (${escapar(e.emisor)})`;

    if (callada) {
      if (previo.silencio !== e.terminoEn) {
        lineas.push(
          `⏰ ${quien}: sin señal desde hace ${enPalabras(silencio)}${
            e.cadaMinutos
              ? `, esperaba cada ${enPalabras(e.cadaMinutos * 60_000)}`
              : ''
          }. Última corrida: ${etiqueta(e.resultado)}${e.mensaje ? ` — ${escapar(e.mensaje)}` : ''}.`
        );
        actual.silencio = e.terminoEn;
      }
    } else if (previo.silencio) {
      lineas.push(`✅ ${quien}: volvió a reportar (${etiqueta(e.resultado)}).`);
      delete actual.silencio;
    }

    if (e.resultado === 'error') {
      if (!previo.error) {
        lineas.push(
          `❌ ${quien}: falló hace ${enPalabras(silencio)}${e.mensaje ? ` — ${escapar(e.mensaje)}` : ''}.`
        );
        actual.error = e.terminoEn;
      }
    } else if (previo.error) {
      lineas.push(`✅ ${quien}: volvió a correr bien.`);
      delete actual.error;
    }

    if (actual.silencio || actual.error) {
      nuevas[e.clave] = actual;
    }
  }
  return { lineas, avisadas: nuevas };
}

function etiqueta(r: ResultadoEjecucion): string {
  return r === 'ok' ? 'bien' : r === 'aviso' ? 'con aviso' : 'con error';
}

function escapar(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** "45 s", "20 min", "3 h", "2 días". */
export function enPalabras(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) {
    return `${s} s`;
  }
  const min = Math.round(s / 60);
  if (min < 60) {
    return `${min} min`;
  }
  const h = min / 60;
  if (h < 48) {
    return h < 10 && h % 1 >= 0.25 ? `${h.toFixed(1)} h` : `${Math.round(h)} h`;
  }
  return `${Math.round(h / 24)} días`;
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
