import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ErrorNoEncontrado,
  ErrorPuente,
  describir
} from '../nucleo/errores.js';

/**
 * Router minimo.
 *
 * El puente son ocho rutas GET que devuelven JSON. Un marco completo traeria
 * decenas de dependencias a un servicio que guarda todas las credenciales de la
 * empresa, y no aportaria nada que no quepa en este archivo.
 */

export type Manejador = (contexto: Contexto) => Promise<unknown>;

export type Metodo = 'GET' | 'POST';

export interface Contexto {
  /** Segmentos de la ruta ya separados, sin los vacios. */
  segmentos: string[];
  parametros: URLSearchParams;
  /** Cuerpo ya interpretado, solo en POST. */
  cuerpo?: unknown;
  /** Encabezados de la peticion, para autenticar el envio. */
  encabezados: Record<string, string | undefined>;
}

interface Ruta {
  metodo: Metodo;
  /** Patron por segmentos; `:algo` captura cualquier valor. */
  patron: string[];
  manejador: Manejador;
}

export class Router {
  private readonly rutas: Ruta[] = [];

  get(patron: string, manejador: Manejador): this {
    this.rutas.push({ metodo: 'GET', patron: partir(patron), manejador });
    return this;
  }

  post(patron: string, manejador: Manejador): this {
    this.rutas.push({ metodo: 'POST', patron: partir(patron), manejador });
    return this;
  }

  async resolver(
    ruta: string,
    parametros: URLSearchParams,
    metodo: Metodo = 'GET',
    cuerpo?: unknown,
    encabezados: Record<string, string | undefined> = {}
  ): Promise<unknown> {
    const segmentos = partir(ruta);
    let existeConOtroMetodo = false;

    for (const candidata of this.rutas) {
      if (!coincide(candidata.patron, segmentos)) {
        continue;
      }
      if (candidata.metodo !== metodo) {
        existeConOtroMetodo = true;
        continue;
      }
      return candidata.manejador({
        segmentos,
        parametros,
        cuerpo,
        encabezados
      });
    }

    if (existeConOtroMetodo) {
      // Distinguirlo del 404 le ahorra media hora a quien esta integrando un
      // envio y mando GET donde iba POST.
      throw new ErrorPuente(`${ruta} existe, pero no acepta ${metodo}`, 405);
    }
    throw new ErrorNoEncontrado(ruta);
  }
}

function partir(ruta: string): string[] {
  return ruta.split('/').filter((parte) => parte !== '');
}

function coincide(patron: string[], segmentos: string[]): boolean {
  if (patron.length !== segmentos.length) {
    return false;
  }
  return patron.every(
    (parte, indice) => parte.startsWith(':') || parte === segmentos[indice]
  );
}

export interface OpcionesServidor {
  origenesPermitidos: string[];
  /** Prefijo bajo el que cuelga el puente, por ejemplo "/api/portal". */
  prefijo: string;
  /** Tope del cuerpo de un envio. Sin tope, cualquiera llena la memoria. */
  maximoCuerpoBytes: number;
}

/**
 * Lee y interpreta el cuerpo de un POST.
 *
 * Corta en cuanto se pasa del tope en lugar de acumular todo y medir al final:
 * de otro modo el tope no protegeria de nada.
 */
async function leerCuerpo(
  peticion: IncomingMessage,
  metodo: Metodo,
  maximoBytes: number
): Promise<unknown> {
  if (metodo !== 'POST') {
    return undefined;
  }

  const partes: Buffer[] = [];
  let total = 0;

  for await (const parte of peticion) {
    const trozo = parte as Buffer;
    total += trozo.length;
    if (total > maximoBytes) {
      peticion.destroy();
      throw new ErrorPuente(
        `El envío supera el tope de ${Math.round(maximoBytes / 1024)} kB`,
        413
      );
    }
    partes.push(trozo);
  }

  if (total === 0) {
    throw new ErrorPuente('El envío llegó sin cuerpo', 400);
  }

  try {
    return JSON.parse(Buffer.concat(partes).toString('utf8'));
  } catch (error) {
    throw new ErrorPuente(
      `El cuerpo no es JSON válido: ${describir(error)}`,
      400
    );
  }
}

/**
 * Convierte una peticion de Node en una respuesta JSON.
 *
 * Todo error termina aqui: el portal siempre recibe un JSON con `error`, nunca
 * una pagina de excepcion ni una conexion cortada, porque de eso depende que la
 * pantalla de Ajustes pueda decir que fuente fallo y por que.
 */
export function manejar(
  router: Router,
  opciones: OpcionesServidor
): (peticion: IncomingMessage, respuesta: ServerResponse) => void {
  return (peticion, respuesta) => {
    const url = new URL(peticion.url ?? '/', 'http://interno');
    const origen = peticion.headers.origin;

    if (origen && opciones.origenesPermitidos.includes(origen)) {
      respuesta.setHeader('access-control-allow-origin', origen);
      respuesta.setHeader('access-control-allow-credentials', 'true');
      respuesta.setHeader('vary', 'Origin');
    }

    if (peticion.method === 'OPTIONS') {
      respuesta.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
      respuesta.setHeader(
        'access-control-allow-headers',
        'content-type, authorization'
      );
      respuesta.writeHead(204).end();
      return;
    }

    if (peticion.method !== 'GET' && peticion.method !== 'POST') {
      responder(respuesta, 405, { error: 'Solo se permiten GET y POST' });
      return;
    }

    const metodo = peticion.method as Metodo;
    const ruta = quitarPrefijo(url.pathname, opciones.prefijo);
    const encabezados = peticion.headers as Record<string, string | undefined>;

    leerCuerpo(peticion, metodo, opciones.maximoCuerpoBytes)
      .then((cuerpo) =>
        router.resolver(ruta, url.searchParams, metodo, cuerpo, encabezados)
      )
      .then((datos) => responder(respuesta, 200, datos))
      .catch((error: unknown) => {
        if (error instanceof ErrorPuente) {
          if (error.estado >= 500) {
            console.error(
              `[puente] ${error.name}: ${error.message}`,
              error.causa ?? ''
            );
          }
          responder(respuesta, error.estado, { error: error.message });
          return;
        }
        console.error('[puente] error inesperado', error);
        responder(respuesta, 500, { error: describir(error) });
      });
  };
}

function quitarPrefijo(ruta: string, prefijo: string): string {
  if (prefijo && ruta.startsWith(prefijo)) {
    return ruta.slice(prefijo.length) || '/';
  }
  return ruta;
}

function responder(
  respuesta: ServerResponse,
  estado: number,
  datos: unknown
): void {
  const cuerpo = JSON.stringify(datos);
  respuesta.writeHead(estado, {
    'content-type': 'application/json; charset=utf-8',
    // El portal ya pone su propio cache; guardar aqui serviria datos viejos sin
    // que el navegador lo note.
    'cache-control': 'no-store'
  });
  respuesta.end(cuerpo);
}
