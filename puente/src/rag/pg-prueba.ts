import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import type { Fila, Sql } from '../datos/persistencia.js';
import { DIM_EMBEDDING } from '../proveedores/embeddings.js';

/**
 * Apoyo de las pruebas contra un Postgres real (no es una prueba: no termina
 * en .prueba.ts, asi que `npm test` no lo corre solo).
 *
 * TEST_DATABASE_URL apunta a una base desechable con pgvector. Cada corrida
 * crea un esquema de nombre aleatorio, fija el search_path de TODAS sus
 * conexiones a el (mas `public`, donde viven las extensiones) y lo elimina
 * al terminar. Nada de lo que se hace aqui toca otro esquema, y la URL tiene
 * que ser de la maquina local.
 */

const HOSTS_LOCALES = new Set(['localhost', '127.0.0.1', '[::1]']);

/** La URL de la base de prueba, o nada si no esta definida (las pruebas se omiten). */
export function urlDePrueba(): string | undefined {
  const url = process.env['TEST_DATABASE_URL']?.trim();
  return url ? url : undefined;
}

/**
 * Se niega a seguir si la URL no es de la maquina local. Tambien rechaza
 * `?host=` / `?hostaddr=`, que cambiarian el destino real de la conexion.
 */
export function exigirBaseLocal(url: string): void {
  let analizada: URL;
  try {
    analizada = new URL(url);
  } catch {
    throw new Error('TEST_DATABASE_URL no es una URL valida.');
  }
  if (!['postgres:', 'postgresql:'].includes(analizada.protocol)) {
    throw new Error('TEST_DATABASE_URL tiene que ser una URL de Postgres.');
  }
  if (!HOSTS_LOCALES.has(analizada.hostname.toLowerCase())) {
    throw new Error(
      'TEST_DATABASE_URL tiene que apuntar a localhost, 127.0.0.1 o ::1: las pruebas no corren contra otra maquina.'
    );
  }
  if (
    analizada.searchParams.has('host') ||
    analizada.searchParams.has('hostaddr')
  ) {
    throw new Error('TEST_DATABASE_URL no puede traer host= ni hostaddr=.');
  }
}

export interface EsquemaPrueba {
  /** Nombre del esquema aleatorio (prueba_rag_ + 16 hex). */
  nombre: string;
  pool: pg.Pool;
  sql: Sql;
  /** Sentencias sueltas que devuelven filas, en el esquema de la prueba. */
  filas(texto: string, parametros?: unknown[]): Promise<Fila[]>;
  /** Elimina SOLO este esquema y cierra las conexiones. */
  cerrar(): Promise<void>;
}

const NOMBRE_VALIDO = /^prueba_rag_[0-9a-f]{16}$/;

/** Crea las extensiones en public (una vez) y un esquema nuevo con su pool. */
export async function abrirEsquemaAleatorio(
  url: string
): Promise<EsquemaPrueba> {
  exigirBaseLocal(url);
  const nombre = `prueba_rag_${randomBytes(8).toString('hex')}`;
  if (!NOMBRE_VALIDO.test(nombre)) {
    throw new Error('Nombre de esquema inesperado.');
  }
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  try {
    await extension(admin, 'vector', true);
    await extension(admin, 'unaccent', false);
    await admin.query(`CREATE SCHEMA ${nombre}`);
  } finally {
    await admin.end();
  }
  const pool = new pg.Pool({
    connectionString: url,
    max: 4,
    options: `-c search_path=${nombre},public`
  });
  const sql: Sql = {
    ejecutar: async (texto, parametros = []) =>
      (await pool.query(texto, parametros)).rows as Fila[],
    transaccion: async (f) => {
      const cliente = await pool.connect();
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
  const actual = await sql.ejecutar('SELECT current_schema() AS esquema');
  if (actual[0]?.['esquema'] !== nombre) {
    await pool.end();
    throw new Error('El search_path de la prueba no quedo en su esquema.');
  }
  return {
    nombre,
    pool,
    sql,
    filas: sql.ejecutar,
    cerrar: async () => {
      try {
        if (NOMBRE_VALIDO.test(nombre)) {
          await pool.query(`DROP SCHEMA IF EXISTS ${nombre} CASCADE`);
        }
      } finally {
        await pool.end();
      }
    }
  };
}

/** CREATE EXTENSION en public; dos corridas a la vez pueden chocar y no importa. */
async function extension(
  cliente: pg.Client,
  nombre: string,
  obligatoria: boolean
): Promise<void> {
  try {
    await cliente.query(
      `CREATE EXTENSION IF NOT EXISTS ${nombre} SCHEMA public`
    );
  } catch (error) {
    const codigo = (error as { code?: string }).code;
    if (codigo === '23505' || codigo === '42710') {
      return;
    }
    if (obligatoria) {
      throw error;
    }
  }
}

/** Vector de 1536 dimensiones que depende solo del texto: el mismo texto da el mismo vector. */
export function vectorDeterminista(texto: string): number[] {
  const hash = createHash('sha256').update(texto).digest();
  let estado = hash.readUInt32LE(0) || 1;
  return Array.from({ length: DIM_EMBEDDING }, () => {
    // mulberry32
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  });
}
