import type { ConfiguracionIa } from '../config/entorno.js';
import { ErrorProveedor } from '../nucleo/errores.js';

/**
 * El unico lugar que habla con el modelo.
 *
 * Va por la API de OpenRouter (formato de chat de OpenAI) para poder cambiar
 * de modelo desde la configuracion sin tocar codigo. Todo lo que el portal
 * resuelve con IA —clasificar correo, resumir el dia, sacar acuerdos de una
 * junta, redactar— pasa por aqui, asi que el costo se controla en un solo
 * sitio: temperatura cero, salida acotada y una sola llamada por pregunta.
 */

export interface Pregunta {
  /** Para que se llama al modelo; queda en la bitacora. */
  uso?: string;
  sistema: string;
  usuario: string;
  /** Pedir JSON (el modelo lo respeta mejor con el response_format). */
  json?: boolean;
  maxTokens?: number;
}

interface RespuestaChat {
  choices?: { message?: { content?: string } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    /** OpenRouter lo manda cuando se pide `usage.include`: en USD. */
    cost?: number;
  };
  error?: { message?: string };
}

/** Una llamada al modelo, tal como queda en la bitacora. */
export interface EntradaBitacora {
  en: string;
  uso: string;
  modelo: string;
  ms: number;
  entrada: number;
  salida: number;
  /** USD, cuando OpenRouter lo reporta. */
  costo?: number;
  /** Lo que se le pidio y lo que contesto, recortados. */
  pregunta: string;
  respuesta: string;
  error?: string;
}

let bitacora: ((entrada: EntradaBitacora) => void) | undefined;

/** Quien quiera guardar las llamadas (rutas.ts) se engancha aqui. */
export function establecerBitacora(
  fn: (entrada: EntradaBitacora) => void
): void {
  bitacora = fn;
}

/** Cuanto se ha gastado desde que arranco el proceso, para la bitacora. */
export const consumo = { llamadas: 0, entrada: 0, salida: 0 };

export async function preguntar(
  config: ConfiguracionIa,
  pregunta: Pregunta
): Promise<string> {
  const inicio = Date.now();
  const anotar = (parte: Partial<EntradaBitacora>) =>
    bitacora?.({
      en: new Date().toISOString(),
      uso: pregunta.uso ?? 'otro',
      modelo: config.modelo,
      ms: Date.now() - inicio,
      entrada: 0,
      salida: 0,
      pregunta: pregunta.usuario.slice(0, 600),
      respuesta: '',
      ...parte
    });
  const respuesta = await fetch(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
        'http-referer': 'https://portal.dealersolutions.com.mx',
        'x-title': 'DS Monitor'
      },
      body: JSON.stringify({
        model: config.modelo,
        temperature: 0,
        max_tokens: pregunta.maxTokens ?? 2000,
        usage: { include: true },
        ...(pregunta.json ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: pregunta.sistema },
          { role: 'user', content: pregunta.usuario }
        ]
      })
    }
  );
  const datos = (await respuesta.json().catch(() => ({}))) as RespuestaChat;
  if (!respuesta.ok) {
    anotar({
      error: `${respuesta.status}: ${(datos.error?.message ?? '').slice(0, 200)}`
    });
    throw new ErrorProveedor(
      'openrouter',
      `respondió ${respuesta.status}: ${(datos.error?.message ?? '').slice(0, 200)}`,
      respuesta.status === 401 || respuesta.status === 402 ? 503 : 502
    );
  }
  consumo.llamadas += 1;
  consumo.entrada += datos.usage?.prompt_tokens ?? 0;
  consumo.salida += datos.usage?.completion_tokens ?? 0;
  const contenido = datos.choices?.[0]?.message?.content ?? '';
  anotar({
    entrada: datos.usage?.prompt_tokens ?? 0,
    salida: datos.usage?.completion_tokens ?? 0,
    costo: datos.usage?.cost,
    respuesta: contenido.slice(0, 600)
  });
  return contenido;
}

/** Saca el objeto JSON aunque el modelo lo envuelva en texto o en ``` */
export function comoJson<T>(texto: string): T {
  const inicio = texto.indexOf('{');
  const fin = texto.lastIndexOf('}');
  if (inicio === -1 || fin === -1) {
    throw new ErrorProveedor('openrouter', 'no devolvió JSON');
  }
  try {
    return JSON.parse(texto.slice(inicio, fin + 1)) as T;
  } catch {
    throw new ErrorProveedor(
      'openrouter',
      'el JSON que devolvió no se pudo leer'
    );
  }
}

/** Una cadena limpia o nada. */
export function texto1(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : undefined;
}

/** Una fecha YYYY-MM-DD del modelo, como ISO al mediodia UTC, o nada. */
export function fechaDe(valor: unknown): string | undefined {
  return typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}/.test(valor)
    ? new Date(`${valor.slice(0, 10)}T12:00:00Z`).toISOString()
    : undefined;
}

/** Fecha y hora legibles en la zona del equipo. */
export function enHorario(iso: string, conHora = true): string {
  return new Date(iso).toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City',
    ...(conHora
      ? { dateStyle: 'medium', timeStyle: 'short' }
      : { dateStyle: 'medium' })
  });
}

// El "quienes somos" de cada prompt sale del catalogo de empresas
// (datos/empresas.ts). Los clientes/proveedores externos salen de
// datos/proveedores.ts (contextoProveedores, opcionesProveedor, proveedorValido).
