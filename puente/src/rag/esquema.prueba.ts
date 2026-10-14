import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { SENTENCIAS_RAG } from './esquema.js';

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
