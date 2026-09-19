import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Donde se guardan las cosas.
 *
 * Todo lo que el puente persiste son documentos JSON chicos agrupados en
 * colecciones: `datos` (equipo, anotaciones, ejecuciones...), `ingesta` (lo
 * recibido por la API), `correo` (credenciales de buzones) e `integraciones`
 * (variables capturadas desde Ajustes). Cada almacen los tiene en memoria y
 * los escribe por aqui cuando cambian.
 *
 * Hay dos implementaciones: archivos (un `.json` por documento, para
 * desarrollo y como respaldo) y Postgres (una tabla `documentos`, lo que se
 * usa en produccion). Los almacenes no saben cual les toco.
 */
export interface Persistencia {
  /** Para el log de arranque. */
  readonly descripcion: string;
  /** Todos los documentos de una coleccion, por clave. */
  leerColeccion(coleccion: string): Promise<Map<string, unknown>>;
  guardar(coleccion: string, clave: string, valor: unknown): Promise<void>;
  borrar(coleccion: string, clave: string): Promise<void>;
  /** Cierra conexiones (Postgres); en archivos no hace nada. */
  cerrar(): Promise<void>;
  /**
   * SQL directo, solo en Postgres: los almacenes con tabla propia lo usan.
   * En archivos no existe y esos almacenes se guardan como documento.
   */
  sql?: Sql;
}

export type Fila = Record<string, unknown>;

export interface Sql {
  ejecutar(texto: string, parametros?: unknown[]): Promise<Fila[]>;
  /** Corre varias sentencias como una sola: todo o nada. */
  transaccion<T>(f: (ejecutar: Sql['ejecutar']) => Promise<T>): Promise<T>;
}

export const COLECCIONES = [
  'datos',
  'ingesta',
  'correo',
  'integraciones'
] as const;
export type Coleccion = (typeof COLECCIONES)[number];

/** Solo letras, numeros, punto, guion y guion bajo: termina en un nombre de archivo. */
export function claveValida(clave: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,80}$/i.test(clave);
}

/**
 * Un `.json` por documento, en el directorio de su coleccion.
 *
 * Se escribe primero con otro nombre y luego se renombra: un renombrado es
 * atomico en el mismo sistema de archivos, asi que un corte a media
 * escritura deja el archivo anterior intacto en lugar de uno a medias.
 */
export class PersistenciaArchivos implements Persistencia {
  readonly descripcion: string;

  constructor(private readonly directorios: Record<string, string>) {
    this.descripcion = `archivos en ${directorios['datos'] ?? Object.values(directorios)[0] ?? '.'}`;
  }

  directorioDe(coleccion: string): string {
    const dir = this.directorios[coleccion];
    if (!dir) {
      throw new Error(`No hay directorio para la colección "${coleccion}".`);
    }
    return dir;
  }

  async leerColeccion(coleccion: string): Promise<Map<string, unknown>> {
    const salida = new Map<string, unknown>();
    const dir = this.directorioDe(coleccion);
    let nombres: string[];
    try {
      nombres = await readdir(dir);
    } catch {
      return salida;
    }
    for (const nombre of nombres) {
      if (!nombre.endsWith('.json')) {
        continue;
      }
      try {
        salida.set(
          nombre.slice(0, -5),
          JSON.parse(await readFile(join(dir, nombre), 'utf8'))
        );
      } catch (error) {
        // Un archivo corrupto no impide arrancar ni leer los demas.
        console.warn(
          `[puente] no se pudo leer ${coleccion}/${nombre}, se ignora`,
          error
        );
      }
    }
    return salida;
  }

  async guardar(
    coleccion: string,
    clave: string,
    valor: unknown
  ): Promise<void> {
    if (!claveValida(clave)) {
      throw new Error(`Clave inválida para guardar: "${clave}"`);
    }
    const dir = this.directorioDe(coleccion);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const destino = join(dir, `${clave}.json`);
    const temporal = `${destino}.tmp`;
    await writeFile(temporal, JSON.stringify(valor, null, 2), { mode: 0o600 });
    await rename(temporal, destino);
  }

  async borrar(coleccion: string, clave: string): Promise<void> {
    await rm(join(this.directorioDe(coleccion), `${clave}.json`), {
      force: true
    });
  }

  async cerrar(): Promise<void> {
    // Nada que cerrar.
  }
}
