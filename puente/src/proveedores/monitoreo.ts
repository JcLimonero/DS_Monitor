import type {
  ConfiguracionMonitoreo,
  DestinoMonitoreo
} from '../config/entorno.js';
import type {
  MonitorCheck,
  MonitorStatus,
  MonitorTarget
} from '../nucleo/contrato.js';

/**
 * Revisa los sitios y servicios desplegados.
 *
 * Esto vive en el puente y no en el navegador por dos razones: desde una
 * aplicacion de pagina unica no se puede por CORS, y aunque se pudiera cada
 * quien estaria midiendo su propia red en lugar del servicio.
 *
 * El historial por destino se guarda donde diga quien llama (la base, via
 * un almacen): las revisiones de las ultimas 24 horas tal cual, y por dia un
 * conteo (buenas/total) de los ultimos 30 dias. Con eso el 24 h y el 30 d
 * son reales y sobreviven a cada publicacion. Sin almacen, queda en memoria.
 */

/** Cuantas revisiones se sirven al portal para la grafica. */
const MAXIMO_HISTORIAL = 48;
const DIA_MS = 86_400_000;
const DIAS_RETENIDOS = 30;

/** Lo que se persiste por destino. */
export interface HistorialDestino {
  /** Revisiones de las ultimas 24 horas. */
  checks: MonitorCheck[];
  /** Por dia (YYYY-MM-DD): cuantas revisiones y cuantas buenas. */
  dias: Record<string, { ok: number; total: number }>;
}

export type HistorialMonitoreo = Record<string, HistorialDestino>;

/** Donde se guarda el historial; el almacen de datos lo implementa tal cual. */
export interface AlmacenHistorial {
  leer(): HistorialMonitoreo;
  escribir(valor: HistorialMonitoreo): Promise<unknown>;
}

/** Agrega una revision al historial de un destino, recortando lo viejo. */
export function conRevision(
  previo: HistorialDestino | undefined,
  revision: MonitorCheck,
  ahora = new Date()
): HistorialDestino {
  const limite = ahora.getTime() - DIA_MS;
  const checks = [...(previo?.checks ?? []), revision].filter(
    (c) => Date.parse(c.at) >= limite
  );
  const dia = revision.at.slice(0, 10);
  const desde = new Date(ahora.getTime() - DIAS_RETENIDOS * DIA_MS)
    .toISOString()
    .slice(0, 10);
  const dias: HistorialDestino['dias'] = {};
  for (const [d, v] of Object.entries(previo?.dias ?? {})) {
    if (d >= desde) {
      dias[d] = v;
    }
  }
  const hoy = dias[dia] ?? { ok: 0, total: 0 };
  dias[dia] = { ok: hoy.ok + (revision.ok ? 1 : 0), total: hoy.total + 1 };
  return { checks, dias };
}

/** Disponibilidad a 30 dias con los conteos diarios. */
export function disponibilidad30(h: HistorialDestino | undefined): number {
  let ok = 0;
  let total = 0;
  for (const v of Object.values(h?.dias ?? {})) {
    ok += v.ok;
    total += v.total;
  }
  return total === 0 ? 0 : Math.round((ok / total) * 1000) / 10;
}

/** Arriba de esto se considera degradado aunque responda bien. */
const LATENCIA_DEGRADADO_MS = 1_000;

const TIEMPO_LIMITE_MS = 10_000;

/** Historial por destino cuando no hay almacen (pruebas, desarrollo). */
let enMemoria: HistorialMonitoreo = {};

/**
 * Si la URL es https://, la misma en http://. Sirve para sitios que solo
 * escuchan en 80 o cuyo certificado no cubre el dominio: con HTTPS fallan
 * y con HTTP responden.
 */
export function urlHttpAlterna(url: string): string | undefined {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') {
      return undefined;
    }
    u.protocol = 'http:';
    return u.toString();
  } catch {
    return undefined;
  }
}

/** Fallo de red/TLS (sin código HTTP): conviene probar HTTP. */
function sinCodigoHttp(r: MonitorCheck): boolean {
  return !r.ok && r.statusCode === undefined;
}

async function pegarUrl(
  url: string,
  arranque: number,
  signal: AbortSignal
): Promise<MonitorCheck> {
  try {
    const respuesta = await fetch(url, {
      // HEAD basta para saber si responde y no descarga la pagina entera. Hay
      // servidores que no lo soportan; esos caen al GET de abajo.
      method: 'HEAD',
      redirect: 'follow',
      signal,
      headers: { 'user-agent': 'DSMonitor/0.1 (monitoreo)' }
    });

    if (respuesta.status === 405 || respuesta.status === 501) {
      const conGet = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal,
        headers: { 'user-agent': 'DSMonitor/0.1 (monitoreo)' }
      });
      return {
        at: new Date().toISOString(),
        ok: conGet.ok,
        latencyMs: Math.round(performance.now() - arranque),
        statusCode: conGet.status
      };
    }

    return {
      at: new Date().toISOString(),
      ok: respuesta.ok,
      latencyMs: Math.round(performance.now() - arranque),
      statusCode: respuesta.status
    };
  } catch {
    return {
      at: new Date().toISOString(),
      ok: false,
      latencyMs: Math.round(performance.now() - arranque)
    };
  }
}

export interface RevisionMonitoreo extends MonitorCheck {
  /** URL con la que se midió (puede ser http tras un fallo de https). */
  urlEfectiva: string;
}

/**
 * Revisa un destino una vez. Nunca lanza: un fallo tambien es un resultado.
 * Si https falla sin código HTTP (TLS, timeout, conexión), reintenta en http.
 */
export async function revisar(
  destino: DestinoMonitoreo
): Promise<RevisionMonitoreo> {
  const intentar = async (url: string): Promise<MonitorCheck> => {
    const control = new AbortController();
    const temporizador = setTimeout(() => control.abort(), TIEMPO_LIMITE_MS);
    const arranque = performance.now();
    try {
      return await pegarUrl(url, arranque, control.signal);
    } finally {
      clearTimeout(temporizador);
    }
  };

  const primera = await intentar(destino.url);
  if (!sinCodigoHttp(primera)) {
    return { ...primera, urlEfectiva: destino.url };
  }
  const alternativa = urlHttpAlterna(destino.url);
  if (!alternativa) {
    return { ...primera, urlEfectiva: destino.url };
  }
  const segunda = await intentar(alternativa);
  if (segunda.ok || segunda.statusCode !== undefined) {
    return { ...segunda, urlEfectiva: alternativa };
  }
  return { ...primera, urlEfectiva: destino.url };
}

/** Porcentaje de revisiones exitosas, de 0 a 100 con un decimal. */
export function disponibilidad(revisiones: readonly MonitorCheck[]): number {
  if (revisiones.length === 0) {
    return 0;
  }
  const buenas = revisiones.filter((revision) => revision.ok).length;
  return Math.round((buenas / revisiones.length) * 1000) / 10;
}

/**
 * Decide el estado a partir de la ultima revision.
 *
 * Degradado es responder bien pero lento: es un estado real y distinto de estar
 * caido, y esconderlo dentro de "operativo" es como no vigilar.
 */
export function estadoDe(ultima: MonitorCheck | undefined): MonitorStatus {
  if (!ultima) {
    return 'desconocido';
  }
  if (!ultima.ok) {
    return 'caido';
  }
  return ultima.latencyMs >= LATENCIA_DEGRADADO_MS ? 'degradado' : 'operativo';
}

export async function destinosMonitoreados(
  config: ConfiguracionMonitoreo,
  almacen?: AlmacenHistorial
): Promise<MonitorTarget[]> {
  // En paralelo: en serie, veinte destinos con diez segundos de limite cada uno
  // podrian tardar tres minutos en contestar una sola peticion del portal.
  const revisiones = await Promise.all(
    config.destinos.map((destino) => revisar(destino))
  );
  const ahora = new Date();
  const historial: HistorialMonitoreo = { ...(almacen?.leer() ?? enMemoria) };

  const salida = config.destinos.map((destino, indice) => {
    const revision = revisiones[indice] as RevisionMonitoreo;
    const actualizado = conRevision(historial[destino.id], revision, ahora);
    historial[destino.id] = actualizado;

    const estado = estadoDe(revision);
    return {
      id: destino.id,
      name: destino.name,
      kind: destino.kind,
      // La URL con la que respondió (http si https falló por TLS/red).
      url: revision.urlEfectiva,
      environment: destino.environment,
      status: estado,
      latencyMs: revision.ok ? revision.latencyMs : undefined,
      uptime24h: disponibilidad(actualizado.checks),
      uptime30d: disponibilidad30(actualizado),
      lastCheck: revision.at,
      history: actualizado.checks.slice(-MAXIMO_HISTORIAL),
      incident:
        estado === 'caido'
          ? `No respondió${revision.statusCode ? ` (${revision.statusCode})` : ''}`
          : estado === 'degradado'
            ? `Respondió en ${revision.latencyMs} ms`
            : undefined,
      accountId: config.accountId
    };
  });

  // Un destino que ya no se vigila se olvida.
  for (const id of Object.keys(historial)) {
    if (!config.destinos.some((d) => d.id === id)) {
      delete historial[id];
    }
  }
  if (almacen) {
    await almacen.escribir(historial).catch((error) => {
      console.warn(
        '[puente] no se pudo guardar el historial de monitoreo',
        error
      );
    });
  } else {
    enMemoria = historial;
  }
  return salida;
}

/** Para las pruebas: deja el historial en blanco. */
export function olvidarHistorial(): void {
  enMemoria = {};
}
