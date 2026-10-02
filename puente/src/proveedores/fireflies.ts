import { ErrorBorradoNoPermitido, ErrorProveedor } from '../nucleo/errores.js';

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
  /** Toda la conversacion, frase por frase (solo al pedir una transcripcion). */
  frases?: Frase[];
}

export interface Frase {
  texto: string;
  hablante?: string;
  /** Segundos desde el inicio de la llamada. */
  inicioSeg?: number;
}

interface RespuestaGraphql<T> {
  data?: T;
  errors?: {
    message?: string;
    code?: string;
    extensions?: { code?: string };
  }[];
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
      respuesta.status === 401 || respuesta.status === 403 ? 503 : 502,
      // El codigo del error (por ejemplo require_elevated_privilege) sirve
      // para distinguir "no tienes permiso" de "fallo la red".
      {
        codigo: datos.errors?.[0]?.extensions?.code ?? datos.errors?.[0]?.code,
        http: respuesta.status
      }
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
  sentences?: { text?: string; speaker_name?: string; start_time?: number }[];
}

const LISTA = `query ($limit: Int, $skip: Int, $fromDate: DateTime) {
  transcripts(limit: $limit, skip: $skip, fromDate: $fromDate) {
    id title date duration transcript_url participants
    summary { overview action_items keywords shorthand_bullet }
  }
}`;

const UNA = `query ($id: String!) {
  transcript(id: $id) {
    id title date duration transcript_url participants
    summary { overview action_items keywords shorthand_bullet }
    sentences { text speaker_name start_time }
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
      .slice(0, 12_000),
    frases: t.sentences
      ? t.sentences
          .map((s) => ({
            texto: (s.text ?? '').trim(),
            hablante: s.speaker_name?.trim() || undefined,
            inicioSeg:
              typeof s.start_time === 'number' && Number.isFinite(s.start_time)
                ? s.start_time
                : undefined
          }))
          .filter((f) => f.texto !== '')
      : undefined
  };
}

/**
 * Las transcripciones recientes, sin el texto completo. Con `dias` en 0 no hay
 * limite de fecha; `saltar` pagina (la API entrega hasta 50 por llamada).
 */
export async function transcripcionesRecientes(
  config: ConfiguracionFireflies,
  dias = 30,
  limite = 50,
  saltar = 0
): Promise<Transcripcion[]> {
  const desde =
    dias > 0
      ? new Date(Date.now() - dias * 86_400_000).toISOString()
      : undefined;
  const datos = await graphql<{ transcripts?: TranscripcionCruda[] }>(
    config,
    LISTA,
    { limit: limite, skip: saltar || undefined, fromDate: desde }
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

const BORRAR = `mutation ($id: String!) {
  deleteTranscript(id: $id) { id title }
}`;

/** Codigos de Fireflies que significan "esta cuenta no puede borrar". */
const CODIGOS_SIN_PERMISO = new Set([
  'require_elevated_privilege',
  'forbidden',
  'unauthorized',
  'paid_required',
  'account_cancelled',
  'api_key_missing',
  'invalid_api_key'
]);

/**
 * Decide si un fallo al borrar es de permisos/plan (no tiene caso insistir en
 * esta corrida) y no de red o de un instante. Pura para poder probarla.
 */
export function esSinPermisoDeBorrado(error: unknown): boolean {
  if (!(error instanceof ErrorProveedor)) {
    return false;
  }
  const causa = error.causa as { codigo?: string; http?: number } | undefined;
  if (causa?.codigo && CODIGOS_SIN_PERMISO.has(causa.codigo)) {
    return true;
  }
  if (causa?.http === 401 || causa?.http === 403) {
    return true;
  }
  return /privilege|permission|forbidden|not allowed|upgrade|plan|admin|owner/i.test(
    error.message
  );
}

/**
 * Borra la transcripcion en Fireflies. Es irreversible. Si el plan o el
 * usuario de la API key no pueden borrar, lanza `ErrorBorradoNoPermitido`
 * (mensaje claro, sin tumbar el proceso: quien llama lo anota y sigue). Una
 * transcripcion que ya no existe cuenta como borrada.
 */
export async function borrarTranscripcion(
  config: ConfiguracionFireflies,
  id: string
): Promise<void> {
  try {
    await graphql<unknown>(config, BORRAR, { id });
  } catch (error) {
    if (error instanceof ErrorProveedor) {
      const causa = error.causa as { codigo?: string } | undefined;
      if (
        causa?.codigo === 'object_not_found' ||
        /not found|no existe/i.test(error.message)
      ) {
        return;
      }
      if (esSinPermisoDeBorrado(error)) {
        throw new ErrorBorradoNoPermitido(
          error.message.replace(/^fireflies:\s*/, '').slice(0, 160)
        );
      }
    }
    throw error;
  }
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
