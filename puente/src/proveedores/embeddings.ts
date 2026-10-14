import { ErrorProveedor } from '../nucleo/errores.js';

/** text-embedding-3-small. halfvec(1536) depende de este tamano. */
export const DIM_EMBEDDING = 1536;
export const MODELO_EMBEDDING_OMISION = 'openai/text-embedding-3-small';

const URL_EMBEDDINGS = 'https://openrouter.ai/api/v1/embeddings';
const LOTE = 32;
const REINTENTOS = 3;

export interface ConfigEmbeddings {
  apiKey: string;
  modelo: string;
}

export interface DependenciasEmbeddings {
  fetch?: typeof fetch;
  dormir?: (ms: number) => Promise<void>;
  lote?: number;
}

interface RespuestaEmbeddings {
  data?: { embedding?: unknown; index?: number }[];
  error?: { message?: string };
}

/**
 * Embeddings por OpenRouter, en lotes y con reintentos.
 *
 * El orden de salida es el de entrada. Un vector que no traiga 1536
 * dimensiones se rechaza: no se guarda un halfvec a medias.
 */
export async function embeddingsDe(
  config: ConfigEmbeddings,
  textos: readonly string[],
  deps: DependenciasEmbeddings = {}
): Promise<number[][]> {
  if (textos.length === 0) {
    return [];
  }
  const pedir = deps.fetch ?? fetch;
  const dormir =
    deps.dormir ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const lote = deps.lote ?? LOTE;
  const salida: number[][] = new Array(textos.length);
  for (let i = 0; i < textos.length; i += lote) {
    const trozo = textos.slice(i, i + lote);
    const vectores = await loteConReintento(config, trozo, pedir, dormir);
    vectores.forEach((vector, j) => {
      salida[i + j] = vector;
    });
  }
  return salida;
}

async function loteConReintento(
  config: ConfigEmbeddings,
  textos: readonly string[],
  pedir: typeof fetch,
  dormir: (ms: number) => Promise<void>
): Promise<number[][]> {
  let ultimo = 'no respondió';
  for (let intento = 0; intento < REINTENTOS; intento++) {
    if (intento > 0) {
      await dormir(400 * 3 ** (intento - 1));
    }
    try {
      return await unLote(config, textos, pedir);
    } catch (error) {
      ultimo = error instanceof Error ? error.message : String(error);
      const reintenta =
        error instanceof ErrorProveedor &&
        (error.estado === 429 || error.estado >= 500);
      if (!reintenta || intento === REINTENTOS - 1) {
        throw error;
      }
    }
  }
  throw new ErrorProveedor('openrouter', ultimo, 502);
}

async function unLote(
  config: ConfigEmbeddings,
  textos: readonly string[],
  pedir: typeof fetch
): Promise<number[][]> {
  let respuesta: Response;
  try {
    respuesta = await pedir(URL_EMBEDDINGS, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
        'http-referer': 'https://portal.dealersolutions.com.mx',
        'x-title': 'DS Monitor'
      },
      body: JSON.stringify({
        model: config.modelo,
        input: textos.length === 1 ? textos[0] : [...textos]
      }),
      signal: AbortSignal.timeout(60_000)
    });
  } catch (error) {
    throw new ErrorProveedor(
      'openrouter',
      `no respondió al pedir embeddings: ${error instanceof Error ? error.message : String(error)}`,
      502
    );
  }
  const datos = (await respuesta
    .json()
    .catch(() => ({}))) as RespuestaEmbeddings;
  if (!respuesta.ok) {
    const estado =
      respuesta.status === 429 || respuesta.status >= 500
        ? respuesta.status
        : respuesta.status === 401 || respuesta.status === 402
          ? 503
          : 502;
    throw new ErrorProveedor(
      'openrouter',
      `embeddings respondió ${respuesta.status}: ${(datos.error?.message ?? '').slice(0, 200)}`,
      estado
    );
  }
  const filas = datos.data ?? [];
  const porIndice = new Map<number, number[]>();
  for (const fila of filas) {
    const indice = fila.index ?? porIndice.size;
    porIndice.set(indice, vectorDe(fila.embedding));
  }
  return textos.map((_, i) => {
    const vector = porIndice.get(i);
    if (!vector) {
      throw new ErrorProveedor(
        'openrouter',
        'la respuesta de embeddings no trae todos los vectores',
        502
      );
    }
    return vector;
  });
}

function vectorDe(valor: unknown): number[] {
  if (!Array.isArray(valor) || valor.length !== DIM_EMBEDDING) {
    throw new ErrorProveedor(
      'openrouter',
      `se esperaban ${DIM_EMBEDDING} dimensiones y llegaron ${Array.isArray(valor) ? valor.length : 0}`,
      502
    );
  }
  const numeros = valor.map((n) => Number(n));
  if (numeros.some((n) => !Number.isFinite(n))) {
    throw new ErrorProveedor(
      'openrouter',
      'un embedding trae un valor que no es número',
      502
    );
  }
  return numeros;
}

/** Literal que Postgres acepta como halfvec. */
export function literalHalfvec(vector: readonly number[]): string {
  if (vector.length !== DIM_EMBEDDING) {
    throw new ErrorProveedor(
      'openrouter',
      `el embedding no tiene ${DIM_EMBEDDING} dimensiones`,
      502
    );
  }
  return `[${vector.join(',')}]`;
}
