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

export interface Contexto {
  /** Segmentos de la ruta ya separados, sin los vacios. */
  segmentos: string[];
  parametros: URLSearchParams;
}

interface Ruta {
  /** Patron por segmentos; `:algo` captura cualquier valor. */
  patron: string[];
  manejador: Manejador;
}

export class Router {
  private readonly rutas: Ruta[] = [];

  get(patron: string, manejador: Manejador): this {
    this.rutas.push({ patron: partir(patron), manejador });
    return this;
  }

  async resolver(ruta: string, parametros: URLSearchParams): Promise<unknown> {
    const segmentos = partir(ruta);
    for (const candidata of this.rutas) {
      if (coincide(candidata.patron, segmentos)) {
        return candidata.manejador({ segmentos, parametros });
      }
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
      respuesta.setHeader('access-control-allow-methods', 'GET, OPTIONS');
      respuesta.setHeader('access-control-allow-headers', 'content-type');
      respuesta.writeHead(204).end();
      return;
    }

    if (peticion.method !== 'GET') {
      responder(respuesta, 405, { error: 'Solo se permite GET' });
      return;
    }

    const ruta = quitarPrefijo(url.pathname, opciones.prefijo);

    router
      .resolver(ruta, url.searchParams)
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
