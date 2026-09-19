import pg from 'pg';
import type { Fila, Persistencia, Sql } from './persistencia.js';

/**
 * Los documentos en una tabla de Postgres (la base de Render).
 *
 *   documentos(coleccion, clave, valor jsonb, actualizado_en)
 *
 * Un renglon por documento, igual que un archivo por documento: asi la
 * migracion desde archivos es copiar, y lo que ya esta en memoria en cada
 * almacen no cambia. Mas adelante lo que se quiera consultar de verdad
 * (pendientes, trazabilidad) puede irse a tablas propias.
 */
export class PersistenciaPostgres implements Persistencia {
  readonly descripcion: string;
  readonly sql: Sql;
  private readonly pool: pg.Pool;

  constructor(url: string) {
    const host = /@([^/:?]+)/.exec(url)?.[1] ?? '';
    // La URL interna de Render (sin dominio) va sin TLS; la externa de Render
    // lo exige, igual que cualquier URL con sslmode=require. Una base local
    // (Docker, localhost) va sin TLS.
    const conTls = /\.render\.com$/.test(host) || /sslmode=require/.test(url);
    this.pool = new pg.Pool({
      connectionString: url,
      max: 4,
      ssl: conTls ? { rejectUnauthorized: false } : undefined
    });
    this.descripcion = `Postgres en ${host || 'la base configurada'}`;
    this.sql = {
      ejecutar: async (texto, parametros = []) =>
        (await this.pool.query(texto, parametros)).rows as Fila[],
      transaccion: async (f) => {
        const cliente = await this.pool.connect();
        try {
          await cliente.query('BEGIN');
          const salida = await f(
            async (texto, parametros = []) =>
              (await cliente.query(texto, parametros)).rows as Fila[]
          );
          await cliente.query('COMMIT');
          return salida;
        } catch (error) {
          await cliente.query('ROLLBACK').catch(() => undefined);
          throw error;
        } finally {
          cliente.release();
        }
      }
    };
  }

  /** Crea la tabla si no existe. Se llama una vez al arrancar. */
  async preparar(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS documentos (
        coleccion text NOT NULL,
        clave text NOT NULL,
        valor jsonb NOT NULL,
        actualizado_en timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (coleccion, clave)
      )
    `);
  }

  /** Cuantos documentos hay en total; 0 = base recien creada. */
  async total(): Promise<number> {
    const r = await this.pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM documentos'
    );
    return Number(r.rows[0]?.n ?? 0);
  }

  async leerColeccion(coleccion: string): Promise<Map<string, unknown>> {
    const r = await this.pool.query<{ clave: string; valor: unknown }>(
      'SELECT clave, valor FROM documentos WHERE coleccion = $1',
      [coleccion]
    );
    return new Map(r.rows.map((fila) => [fila.clave, fila.valor]));
  }

  async guardar(
    coleccion: string,
    clave: string,
    valor: unknown
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO documentos (coleccion, clave, valor, actualizado_en)
       VALUES ($1, $2, $3::jsonb, now())
       ON CONFLICT (coleccion, clave)
       DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = now()`,
      [coleccion, clave, JSON.stringify(valor)]
    );
  }

  async borrar(coleccion: string, clave: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM documentos WHERE coleccion = $1 AND clave = $2',
      [coleccion, clave]
    );
  }

  async cerrar(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * Copia todo lo que hay en una persistencia a otra (archivos → Postgres la
 * primera vez que arranca con base). Devuelve cuantos documentos copio.
 */
export async function copiarPersistencia(
  de: Persistencia,
  a: Persistencia,
  colecciones: readonly string[]
): Promise<number> {
  let copiados = 0;
  for (const coleccion of colecciones) {
    for (const [clave, valor] of await de.leerColeccion(coleccion)) {
      await a.guardar(coleccion, clave, valor);
      copiados++;
    }
  }
  return copiados;
}
