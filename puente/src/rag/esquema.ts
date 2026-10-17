import type { Sql } from '../datos/persistencia.js';

/**
 * Tablas del RAG vectorial.
 *
 * No pasan por AlmacenTabla: un embedding no se carga a memoria ni se
 * reescribe en un documento JSON. Se consultan con SQL directo.
 *
 * halfvec(1536) es la mitad de un vector de text-embedding-3-small. Hace
 * falta pgvector 0.7 o mas nuevo (la imagen pgvector/pgvector:pg16, o
 * CREATE EXTENSION vector en el Postgres 16 de Render).
 */
const TABLAS_RAG: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS rag_documentos (
      id text PRIMARY KEY,
      drive_file_id text UNIQUE NOT NULL,
      drive_url text,
      ruta text,
      titulo text NOT NULL,
      fecha timestamptz,
      empresa text NOT NULL,
      cliente text,
      proyecto text,
      tipo text,
      participantes text[],
      frontmatter jsonb NOT NULL DEFAULT '{}'::jsonb,
      huella text NOT NULL,
      modelo_emb text NOT NULL,
      drive_modificado_en timestamptz,
      actualizado_en timestamptz NOT NULL DEFAULT now()
    )`,
  `CREATE INDEX IF NOT EXISTS rag_documentos_empresa_cliente_fecha
      ON rag_documentos (empresa, cliente, fecha DESC)`,
  `CREATE TABLE IF NOT EXISTS rag_fragmentos (
      id bigserial PRIMARY KEY,
      documento_id text NOT NULL REFERENCES rag_documentos(id) ON DELETE CASCADE,
      orden int NOT NULL,
      seccion text,
      empresa text NOT NULL,
      cliente text,
      fecha timestamptz,
      texto text NOT NULL,
      tokens int,
      embedding halfvec(1536) NOT NULL,
      tsv tsvector GENERATED ALWAYS AS (to_tsvector('spanish', texto)) STORED,
      UNIQUE (documento_id, orden)
    )`,
  `CREATE INDEX IF NOT EXISTS rag_fragmentos_embedding_hnsw
      ON rag_fragmentos USING hnsw (embedding halfvec_cosine_ops)`,
  `CREATE INDEX IF NOT EXISTS rag_fragmentos_tsv
      ON rag_fragmentos USING gin (tsv)`,
  `CREATE INDEX IF NOT EXISTS rag_fragmentos_empresa_cliente
      ON rag_fragmentos (empresa, cliente)`,
  `CREATE TABLE IF NOT EXISTS rag_estado (
      clave text PRIMARY KEY,
      valor text NOT NULL,
      actualizado_en timestamptz NOT NULL DEFAULT now()
    )`
];

/** Cuanto espera un ALTER/CREATE INDEX por su candado antes de rendirse. */
export const LOCK_TIMEOUT_RAG = '5s';

/**
 * Agrega una columna solo si falta, sin tocar la tabla cuando ya esta.
 *
 * Un ALTER TABLE pide ACCESS EXCLUSIVE aunque la columna ya exista, y si
 * espera detras de una consulta larga bloquea a todas las que llegan
 * despues. Por eso se revisa antes en el catalogo y, si hay que alterar, se
 * limita la espera con un lock_timeout local a la sentencia (set_config con
 * is_local = true): si no consigue el candado a tiempo falla, y el siguiente
 * arranque o consulta del RAG lo reintenta. Los DEFAULT son constantes: en
 * Postgres 11 o mas nuevo no reescriben la tabla ni reconstruyen sus
 * indices (HNSW incluido).
 */
function agregarColumna(
  tabla: string,
  columna: string,
  definicion: string,
  espera: string
): string {
  return `DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_attribute
         WHERE attrelid = '${tabla}'::regclass
           AND attname = '${columna}'
           AND NOT attisdropped
      ) THEN
        PERFORM set_config('lock_timeout', '${espera}', true);
        ALTER TABLE ${tabla} ADD COLUMN IF NOT EXISTS ${columna} ${definicion};
      END IF;
    END
    $$`;
}

/** Igual que agregarColumna, para un indice (CREATE INDEX pide SHARE: frena escrituras). */
function crearIndiceSiFalta(
  nombre: string,
  definicion: string,
  espera: string
): string {
  return `DO $$
    BEGIN
      IF to_regclass('${nombre}') IS NULL THEN
        PERFORM set_config('lock_timeout', '${espera}', true);
        CREATE INDEX IF NOT EXISTS ${nombre} ${definicion};
      END IF;
    END
    $$`;
}

/**
 * Sensibilidad de lo indexado (ADR-0001, decision 11) y proyecto (decision 12).
 *
 * El DEFAULT de sensibilidad es 'costos' a proposito: se falla cerrado. Toda
 * fila que ya existia, y toda fila que un codigo viejo (o un INSERT que se
 * olvide de la columna) deje sin clasificar, cuenta como costos hasta que se
 * reclasifique con `npm run rag:backfill`. Un 'general' por omision dejaria
 * los precios visibles justo en la ventana en que aun no se han marcado.
 * Por eso el DEFAULT no se quita despues del backfill.
 *
 * Es aditivo: el codigo anterior sigue funcionando con las columnas nuevas.
 */
export function sentenciasRag(
  espera: string = LOCK_TIMEOUT_RAG
): readonly string[] {
  if (!/^\d+(ms|s|min)$/.test(espera)) {
    throw new Error(`Espera de candado no valida: ${espera}`);
  }
  return [
    ...TABLAS_RAG,
    agregarColumna(
      'rag_documentos',
      'sensibilidad',
      `text NOT NULL DEFAULT 'costos'
          CONSTRAINT rag_documentos_sensibilidad_valida
          CHECK (sensibilidad IN ('general', 'costos'))`,
      espera
    ),
    agregarColumna(
      'rag_fragmentos',
      'sensibilidad',
      `text NOT NULL DEFAULT 'costos'
          CONSTRAINT rag_fragmentos_sensibilidad_valida
          CHECK (sensibilidad IN ('general', 'costos'))`,
      espera
    ),
    agregarColumna('rag_fragmentos', 'proyecto', 'text', espera),
    crearIndiceSiFalta(
      'rag_fragmentos_empresa_sensibilidad',
      'ON rag_fragmentos (empresa, sensibilidad)',
      espera
    )
  ];
}

export const SENTENCIAS_RAG: readonly string[] = sentenciasRag();

let avisoUnaccent = false;

/**
 * Crea la extension y las tablas, y agrega las columnas que falten. Se puede
 * llamar en cada arranque: no toca lo que ya esta.
 */
export async function asegurarEsquemaRag(
  sql: Sql,
  opciones: { lockTimeout?: string } = {}
): Promise<void> {
  await sql.ejecutar('CREATE EXTENSION IF NOT EXISTS vector');
  try {
    await sql.ejecutar('CREATE EXTENSION IF NOT EXISTS unaccent');
  } catch (error) {
    if (!avisoUnaccent) {
      avisoUnaccent = true;
      const mensaje = error instanceof Error ? error.message : String(error);
      console.warn(
        `[puente] RAG: no se pudo activar unaccent (${mensaje}). La búsqueda en español sigue con el diccionario spanish.`
      );
    }
  }
  const sentencias = opciones.lockTimeout
    ? sentenciasRag(opciones.lockTimeout)
    : SENTENCIAS_RAG;
  for (const sentencia of sentencias) {
    await sql.ejecutar(sentencia);
  }
}
