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
 * El historial se guarda en memoria mientras el proceso viva. Es suficiente
 * para la grafica de las ultimas horas; para retencion de verdad habria que
 * escribirlo a una base, y eso es otro trabajo.
 */

/** Cuantas revisiones conserva el historial de cada destino. */
const MAXIMO_HISTORIAL = 48;

/** Arriba de esto se considera degradado aunque responda bien. */
const LATENCIA_DEGRADADO_MS = 1_000;

const TIEMPO_LIMITE_MS = 10_000;

/** Historial por destino, en memoria. */
const historial = new Map<string, MonitorCheck[]>();

/** Revisa un destino una vez. Nunca lanza: un fallo tambien es un resultado. */
export async function revisar(
  destino: DestinoMonitoreo
): Promise<MonitorCheck> {
  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), TIEMPO_LIMITE_MS);
  const arranque = performance.now();

  try {
    const respuesta = await fetch(destino.url, {
      // HEAD basta para saber si responde y no descarga la pagina entera. Hay
      // servidores que no lo soportan; esos caen al GET de abajo.
      method: 'HEAD',
      redirect: 'follow',
      signal: control.signal,
      headers: { 'user-agent': 'DSMonitor/0.1 (monitoreo)' }
    });

    if (respuesta.status === 405 || respuesta.status === 501) {
      const conGet = await fetch(destino.url, {
        method: 'GET',
        redirect: 'follow',
        signal: control.signal,
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
  } finally {
    clearTimeout(temporizador);
  }
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
  config: ConfiguracionMonitoreo
): Promise<MonitorTarget[]> {
  // En paralelo: en serie, veinte destinos con diez segundos de limite cada uno
  // podrian tardar tres minutos en contestar una sola peticion del portal.
  const revisiones = await Promise.all(
    config.destinos.map((destino) => revisar(destino))
  );

  return config.destinos.map((destino, indice) => {
    const revision = revisiones[indice] as MonitorCheck;
    const previas = historial.get(destino.id) ?? [];
    const actualizado = [...previas, revision].slice(-MAXIMO_HISTORIAL);
    historial.set(destino.id, actualizado);

    const estado = estadoDe(revision);
    return {
      id: destino.id,
      name: destino.name,
      kind: destino.kind,
      url: destino.url,
      environment: destino.environment,
      status: estado,
      latencyMs: revision.ok ? revision.latencyMs : undefined,
      uptime24h: disponibilidad(actualizado),
      // A treinta dias haria falta persistencia; mientras no la haya se reporta
      // lo mismo que a veinticuatro horas en lugar de inventar una cifra.
      uptime30d: disponibilidad(actualizado),
      lastCheck: revision.at,
      history: actualizado,
      incident:
        estado === 'caido'
          ? `No respondió${revision.statusCode ? ` (${revision.statusCode})` : ''}`
          : estado === 'degradado'
            ? `Respondió en ${revision.latencyMs} ms`
            : undefined,
      accountId: config.accountId
    };
  });
}

/** Para las pruebas: deja el historial en blanco. */
export function olvidarHistorial(): void {
  historial.clear();
}
