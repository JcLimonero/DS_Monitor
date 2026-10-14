import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ErrorProveedor } from '../nucleo/errores.js';
import { DIM_EMBEDDING, embeddingsDe, literalHalfvec } from './embeddings.js';

function vector(semilla: number): number[] {
  return Array.from({ length: DIM_EMBEDDING }, (_, i) =>
    i === 0 ? semilla : 0
  );
}

describe('embeddings de OpenRouter', () => {
  it('respeta el indice del lote y reintenta un 429', async () => {
    const esperas: number[] = [];
    let llamadas = 0;
    const vectores = await embeddingsDe(
      { apiKey: 'sk-test', modelo: 'openai/text-embedding-3-small' },
      ['uno', 'dos'],
      {
        lote: 8,
        dormir: async (ms) => {
          esperas.push(ms);
        },
        fetch: async () => {
          llamadas += 1;
          if (llamadas === 1) {
            return new Response(
              JSON.stringify({ error: { message: 'rate' } }),
              {
                status: 429
              }
            );
          }
          return new Response(
            JSON.stringify({
              data: [
                { index: 1, embedding: vector(2) },
                { index: 0, embedding: vector(1) }
              ]
            }),
            { status: 200 }
          );
        }
      }
    );
    assert.equal(llamadas, 2);
    assert.deepEqual(esperas, [400]);
    assert.equal(vectores[0]?.[0], 1);
    assert.equal(vectores[1]?.[0], 2);
    assert.equal(vectores[0]?.length, DIM_EMBEDDING);
    assert.ok(literalHalfvec(vectores[0] as number[]).startsWith('[1,'));
  });

  it('rechaza un vector de otro tamano', async () => {
    await assert.rejects(
      () =>
        embeddingsDe(
          { apiKey: 'sk-test', modelo: 'openai/text-embedding-3-small' },
          ['uno'],
          {
            fetch: async () =>
              new Response(
                JSON.stringify({ data: [{ index: 0, embedding: [1, 2] }] }),
                {
                  status: 200
                }
              )
          }
        ),
      (error: unknown) => error instanceof ErrorProveedor
    );
  });
});
