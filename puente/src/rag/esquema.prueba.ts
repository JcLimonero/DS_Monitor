import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { SENTENCIAS_RAG, sentenciasRag } from './esquema.js';

describe('migracion pgvector', () => {
  it('el SQL versionado trae extension, halfvec, HNSW y spanish', async () => {
    const sql = await readFile('migraciones/001-rag-vectorial.sql', 'utf8');
    assert.match(sql, /CREATE EXTENSION IF NOT EXISTS vector/);
    assert.match(sql, /CREATE EXTENSION IF NOT EXISTS unaccent/);
    assert.match(sql, /halfvec\(1536\)/);
    assert.match(sql, /USING hnsw \(embedding halfvec_cosine_ops\)/);
    assert.match(sql, /to_tsvector\('spanish', texto\)/);
    assert.match(sql, /empresa text NOT NULL/);
    const unido = SENTENCIAS_RAG.join('\n');
    assert.match(unido, /halfvec\(1536\)/);
    assert.match(unido, /rag_fragmentos_embedding_hnsw/);
    assert.doesNotMatch(unido, /crm_/);
  });
});

describe('migracion de sensibilidad y proyecto', () => {
  it('el espejo 002 trae las mismas columnas, el CHECK y el indice que el arranque', async () => {
    const espejo = await readFile(
      'migraciones/002-rag-sensibilidad.sql',
      'utf8'
    );
    const unido = SENTENCIAS_RAG.join('\n');
    for (const texto of [espejo, unido]) {
      assert.match(
        texto,
        /sensibilidad text NOT NULL DEFAULT 'costos'\s+CONSTRAINT rag_documentos_sensibilidad_valida\s+CHECK \(sensibilidad IN \('general', 'costos'\)\)/
      );
      assert.match(
        texto,
        /sensibilidad text NOT NULL DEFAULT 'costos'\s+CONSTRAINT rag_fragmentos_sensibilidad_valida\s+CHECK \(sensibilidad IN \('general', 'costos'\)\)/
      );
      assert.match(texto, /ADD COLUMN IF NOT EXISTS proyecto text/);
      assert.match(
        texto,
        /rag_fragmentos_empresa_sensibilidad\s+ON rag_fragmentos \(empresa, sensibilidad\)/
      );
    }
  });

  it('el arranque revisa el catalogo y limita la espera por el candado', () => {
    const alteraciones = SENTENCIAS_RAG.filter((s) =>
      /ALTER TABLE|CREATE INDEX IF NOT EXISTS rag_fragmentos_empresa_sensibilidad/.test(
        s
      )
    );
    assert.equal(alteraciones.length, 4);
    for (const sentencia of alteraciones) {
      assert.match(sentencia, /IF NOT EXISTS|IS NULL/);
      assert.match(sentencia, /set_config\('lock_timeout', '5s', true\)/);
    }
    assert.match(
      sentenciasRag('250ms').join('\n'),
      /set_config\('lock_timeout', '250ms', true\)/
    );
    assert.throws(
      () => sentenciasRag("1s', true); DROP TABLE x; --"),
      /Espera/
    );
  });
});
