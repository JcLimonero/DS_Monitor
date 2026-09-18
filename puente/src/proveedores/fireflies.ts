import { ErrorProveedor } from '../nucleo/errores.js';

/**
 * Fireflies.ai: las notas de las juntas, directo de su API (GraphQL con
 * API key, de Settings → Developer). De cada transcripcion se toma el
 * resumen, los acuerdos que Fireflies ya detecto y el texto, para
 * emparejarla con la junta del calendario (por titulo y fecha) y sacar
 * acuerdos sin que nadie copie nada.
 */
export interface ConfiguracionFireflies {
  apiKey: string;
}

export interface Transcripcion {
  id: string;
  titulo: string;
  fecha: string;
  duracionMin?: number;
  url?: string;
  resumen?: string;
  acuerdos?: string;
  temas?: string[];
  participantes: string[];
  /** Las primeras frases, para el modelo. */
  texto?: string;
}

interface RespuestaGraphql<T> {
  data?: T;
  errors?: { message?: string }[];
}

async function graphql<T>(
  config: ConfiguracionFireflies,
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const respuesta = await fetch('https://api.fireflies.ai/graphql', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ query, variables })
  });
  const datos = (await respuesta
    .json()
    .catch(() => ({}))) as RespuestaGraphql<T>;
  if (!respuesta.ok || datos.errors?.length || !datos.data) {
    throw new ErrorProveedor(
      'fireflies',
      datos.errors?.[0]?.message ?? `respondió ${respuesta.status}`,
      respuesta.status === 401 || respuesta.status === 403 ? 503 : 502
    );
  }
  return datos.data;
}

interface TranscripcionCruda {
  id: string;
  title?: string;
  date?: number | string;
  duration?: number;
  transcript_url?: string;
  participants?: string[];
  summary?: {
    overview?: string;
    action_items?: string;
    keywords?: string[];
    shorthand_bullet?: string;
  };
  sentences?: { text?: string; speaker_name?: string }[];
}

const LISTA = `query ($limit: Int, $fromDate: DateTime) {
  transcripts(limit: $limit, fromDate: $fromDate) {
    id title date duration transcript_url participants
    summary { overview action_items keywords shorthand_bullet }
  }
}`;

const UNA = `query ($id: String!) {
  transcript(id: $id) {
    id title date duration transcript_url participants
    summary { overview action_items keywords shorthand_bullet }
    sentences { text speaker_name }
  }
}`;

function aTranscripcion(t: TranscripcionCruda): Transcripcion {
  const fecha =
    typeof t.date === 'number'
      ? new Date(t.date).toISOString()
      : t.date
        ? new Date(t.date).toISOString()
        : '';
  return {
    id: t.id,
    titulo: t.title ?? '(sin título)',
    fecha,
    duracionMin: t.duration ? Math.round(t.duration) : undefined,
    url: t.transcript_url,
    resumen: t.summary?.overview ?? t.summary?.shorthand_bullet,
    acuerdos: t.summary?.action_items,
    temas: t.summary?.keywords,
    participantes: t.participants ?? [],
    texto: t.sentences
      ?.map(
        (s) => `${s.speaker_name ? `${s.speaker_name}: ` : ''}${s.text ?? ''}`
      )
      .join('\n')
      .slice(0, 12_000)
  };
}

/** Las transcripciones recientes, sin el texto completo. */
export async function transcripcionesRecientes(
  config: ConfiguracionFireflies,
  dias = 30,
  limite = 50
): Promise<Transcripcion[]> {
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString();
  const datos = await graphql<{ transcripts?: TranscripcionCruda[] }>(
    config,
    LISTA,
    { limit: limite, fromDate: desde }
  );
  return (datos.transcripts ?? []).map(aTranscripcion);
}

export async function transcripcion(
  config: ConfiguracionFireflies,
  id: string
): Promise<Transcripcion> {
  const datos = await graphql<{ transcript?: TranscripcionCruda }>(
    config,
    UNA,
    { id }
  );
  if (!datos.transcript) {
    throw new ErrorProveedor('fireflies', 'no existe esa transcripción', 404);
  }
  return aTranscripcion(datos.transcript);
}

/**
 * La transcripcion que corresponde a una junta: mismo dia y titulo parecido,
 * o en su defecto la unica de ese dia que empieza cerca de la hora.
 */
export function emparejar(
  junta: { title: string; start: string },
  transcripciones: Transcripcion[]
): Transcripcion | undefined {
  const inicio = Date.parse(junta.start);
  const mismoRato = transcripciones.filter(
    (t) => t.fecha && Math.abs(Date.parse(t.fecha) - inicio) < 2 * 3_600_000
  );
  if (mismoRato.length === 0) {
    return undefined;
  }
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const objetivo = norm(junta.title);
  return (
    mismoRato.find((t) => norm(t.titulo) === objetivo) ??
    mismoRato.find(
      (t) =>
        norm(t.titulo).includes(objetivo) || objetivo.includes(norm(t.titulo))
    ) ??
    (mismoRato.length === 1 ? mismoRato[0] : undefined)
  );
}

/** Lo que se le da al modelo como notas de la junta. */
export function notasDe(t: Transcripcion): string {
  return [
    t.resumen ? `Resumen: ${t.resumen}` : undefined,
    t.acuerdos
      ? `Acuerdos detectados por Fireflies:\n${t.acuerdos}`
      : undefined,
    t.texto ? `Transcripción:\n${t.texto}` : undefined
  ]
    .filter((x) => x)
    .join('\n\n');
}
