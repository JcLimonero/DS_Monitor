import { ErrorProveedor } from './errores.js';

/**
 * Cliente HTTP para hablar con los proveedores.
 *
 * Node 22 ya trae `fetch`, asi que esto solo agrega lo que de todas formas
 * habria que escribir: tiempo limite, un reintento para los fallos que sirve
 * reintentar, y un error que dice de que proveedor vino y con que codigo.
 */

const TIEMPO_LIMITE_MS = 15_000;

/** Codigos que vale la pena reintentar: el resto no mejora por insistir. */
const REINTENTABLES = new Set([408, 429, 500, 502, 503, 504]);

export interface OpcionesPeticion {
  metodo?: 'GET' | 'POST';
  encabezados?: Record<string, string>;
  cuerpo?: unknown;
  /** Milisegundos antes de abortar. */
  tiempoLimiteMs?: number;
  /** Cuantas veces reintentar un fallo reintentable. */
  reintentos?: number;
}

export async function pedirJson<T>(
  proveedor: string,
  url: string,
  opciones: OpcionesPeticion = {}
): Promise<T> {
  const {
    metodo = 'GET',
    encabezados = {},
    cuerpo,
    tiempoLimiteMs = TIEMPO_LIMITE_MS,
    reintentos = 1
  } = opciones;

  let ultimoError: unknown;

  for (let intento = 0; intento <= reintentos; intento++) {
    const control = new AbortController();
    const temporizador = setTimeout(() => control.abort(), tiempoLimiteMs);

    try {
      const respuesta = await fetch(url, {
        method: metodo,
        headers: {
          accept: 'application/json',
          // Anthropic pide identificarse en las integraciones; no estorba en
          // los demas y ayuda a rastrear de donde salio la peticion.
          'user-agent': 'PortalDealerSolutions/0.1 (puente)',
          ...(cuerpo !== undefined
            ? { 'content-type': 'application/json' }
            : {}),
          ...encabezados
        },
        body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
        signal: control.signal
      });

      if (!respuesta.ok) {
        const texto = await respuesta.text().catch(() => '');
        const error = new ErrorProveedor(
          proveedor,
          `respondio ${respuesta.status}${texto ? ` · ${recortar(texto)}` : ''}`,
          respuesta.status === 401 || respuesta.status === 403 ? 502 : 502
        );
        if (REINTENTABLES.has(respuesta.status) && intento < reintentos) {
          ultimoError = error;
          await esperar(400 * (intento + 1));
          continue;
        }
        throw error;
      }

      return (await respuesta.json()) as T;
    } catch (error) {
      // Un abort o un fallo de red si vale la pena reintentarlo una vez.
      const esDeRed =
        error instanceof TypeError || (error as Error)?.name === 'AbortError';
      if (esDeRed && intento < reintentos) {
        ultimoError = error;
        await esperar(400 * (intento + 1));
        continue;
      }
      if (error instanceof ErrorProveedor) {
        throw error;
      }
      throw new ErrorProveedor(proveedor, mensajeDeRed(error), 502, error);
    } finally {
      clearTimeout(temporizador);
    }
  }

  throw ultimoError instanceof ErrorProveedor
    ? ultimoError
    : new ErrorProveedor(
        proveedor,
        mensajeDeRed(ultimoError),
        502,
        ultimoError
      );
}

function mensajeDeRed(error: unknown): string {
  if ((error as Error)?.name === 'AbortError') {
    return 'no respondio a tiempo';
  }
  return `no se pudo conectar (${(error as Error)?.message ?? String(error)})`;
}

/** Los cuerpos de error pueden venir enormes; en la bitacora estorban. */
function recortar(texto: string, maximo = 200): string {
  const limpio = texto.replace(/\s+/g, ' ').trim();
  return limpio.length > maximo ? `${limpio.slice(0, maximo)}…` : limpio;
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

/** Arma una URL con sus parametros, saltando los que vienen vacios. */
export function conParametros(
  base: string,
  parametros: Record<string, string | undefined>
): string {
  const url = new URL(base);
  for (const [clave, valor] of Object.entries(parametros)) {
    if (valor !== undefined && valor !== '') {
      url.searchParams.set(clave, valor);
    }
  }
  return url.toString();
}
