-- RAG vectorial de juntas (Fireflies).
-- Misma base de DS Monitor. Itech va en la columna empresa y las consultas
-- lo excluyen salvo peticion explicita. No toca las tablas del CRM.
--
-- Requiere pgvector 0.7+ (halfvec). En Render: el usuario ds_monitor es dueno
-- de la base y puede correr CREATE EXTENSION. En Coolify la imagen es
-- pgvector/pgvector:pg16.
--
-- El puente tambien corre esto al arrancar (src/rag/esquema.ts).

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE TABLE IF NOT EXISTS rag_documentos (
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
);

CREATE INDEX IF NOT EXISTS rag_documentos_empresa_cliente_fecha
  ON rag_documentos (empresa, cliente, fecha DESC);

CREATE TABLE IF NOT EXISTS rag_fragmentos (
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
);

CREATE INDEX IF NOT EXISTS rag_fragmentos_embedding_hnsw
  ON rag_fragmentos USING hnsw (embedding halfvec_cosine_ops);

CREATE INDEX IF NOT EXISTS rag_fragmentos_tsv
  ON rag_fragmentos USING gin (tsv);

CREATE INDEX IF NOT EXISTS rag_fragmentos_empresa_cliente
  ON rag_fragmentos (empresa, cliente);

CREATE TABLE IF NOT EXISTS rag_estado (
  clave text PRIMARY KEY,
  valor text NOT NULL,
  actualizado_en timestamptz NOT NULL DEFAULT now()
);
