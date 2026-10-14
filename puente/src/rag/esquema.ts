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
export const SENTENCIAS_RAG: readonly string[] = [
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

let avisoUnaccent = false;

/** Crea la extension y las tablas. Se puede llamar en cada arranque. */
export async function asegurarEsquemaRag(sql: Sql): Promise<void> {
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
  for (const sentencia of SENTENCIAS_RAG) {
    await sql.ejecutar(sentencia);
  }
}
