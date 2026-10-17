-- RAG: sensibilidad de lo indexado y proyecto en los fragmentos.
-- ADR-0001, decisiones 11 (costos) y 12 (proyecto como eje de filtro).
--
-- Aditiva e idempotente. El puente la corre solo al arrancar
-- (src/rag/esquema.ts, con lock_timeout y sin tocar la tabla si las columnas
-- ya estan); este archivo es el espejo para correrla a mano. Con psql:
--   SET lock_timeout = '5s';  -- antes de este archivo
--
-- El DEFAULT 'costos' es a proposito: se falla cerrado. Toda fila previa, y
-- toda fila que un codigo viejo inserte sin la columna, cuenta como costos
-- hasta que se reclasifique (npm run rag:backfill recorre Drive y la corrige
-- sin volver a embeber). No se quita despues del backfill.
--
-- Locks y costo: ADD COLUMN con DEFAULT constante no reescribe la tabla ni
-- reconstruye sus indices (el HNSW de embedding queda intacto). El CHECK se
-- valida con una lectura de la tabla bajo ACCESS EXCLUSIVE (no lee los
-- embeddings): milisegundos con decenas de miles de filas. El indice nuevo es
-- un btree chico y pide SHARE mientras se construye.
--
-- Rollback (el codigo anterior sigue funcionando con las columnas puestas, asi
-- que solo hace falta si se quiere dejar el esquema como estaba):
--   DROP INDEX IF EXISTS rag_fragmentos_empresa_sensibilidad;
--   ALTER TABLE rag_fragmentos DROP COLUMN IF EXISTS proyecto;
--   ALTER TABLE rag_fragmentos DROP COLUMN IF EXISTS sensibilidad;
--   ALTER TABLE rag_documentos DROP COLUMN IF EXISTS sensibilidad;

ALTER TABLE rag_documentos
  ADD COLUMN IF NOT EXISTS sensibilidad text NOT NULL DEFAULT 'costos'
  CONSTRAINT rag_documentos_sensibilidad_valida
  CHECK (sensibilidad IN ('general', 'costos'));

ALTER TABLE rag_fragmentos
  ADD COLUMN IF NOT EXISTS sensibilidad text NOT NULL DEFAULT 'costos'
  CONSTRAINT rag_fragmentos_sensibilidad_valida
  CHECK (sensibilidad IN ('general', 'costos'));

ALTER TABLE rag_fragmentos
  ADD COLUMN IF NOT EXISTS proyecto text;

CREATE INDEX IF NOT EXISTS rag_fragmentos_empresa_sensibilidad
  ON rag_fragmentos (empresa, sensibilidad);
