import type { ConfiguracionIa } from '../config/entorno.js';
import type { TaskItem, TaskPriority } from '../nucleo/contrato.js';
import { ErrorProveedor } from '../nucleo/errores.js';
import type { CandidatoIa } from './correo.js';
import { descripcionDeCorreo } from './correo.js';

/**
 * La IA que organiza el correo.
 *
 * Las reglas de `correo.ts` reconocen lo previsible (recibos, avisos de
 * vencimiento). Todo lo demas que llega —un cliente que pide algo, un
 * proveedor que espera respuesta, un colega que delega— lo lee un modelo por
 * OpenRouter y decide si es un pendiente, para que empresa, con que prioridad
 * y para cuando. Cada correo se analiza una sola vez: el resultado se guarda
 * por identificador y solo se mandan los nuevos.
 *
 * Va por la API de OpenRouter (compatible con el formato de chat de OpenAI)
 * para poder cambiar de modelo sin tocar codigo; el modelo por omision es
 * Claude Haiku 4.5, que para clasificar rinde igual que uno grande y cuesta
 * una fraccion.
 */

export const EMPRESAS = [
  'Itech Dev',
  'Dealer Solutions',
  'NexusQTech',
  'OperativAI'
] as const;

export interface Clasificacion {
  id: string;
  esPendiente: boolean;
  titulo?: string;
  resumen?: string;
  prioridad?: TaskPriority;
  /** Fecha limite en ISO, si el correo la menciona. */
  venceEn?: string;
  empresa?: string;
  /** Por que lo considero pendiente, en una frase. */
  motivo?: string;
  analizadoEn: string;
}

const PROMPT = `Eres el asistente de operaciones de un grupo con cuatro empresas: Itech Dev (desarrollo de software), Dealer Solutions (software para agencias automotrices), NexusQTech (integraciones y tecnología para grupos automotrices) y OperativAI (agentes de IA).

Te doy correos recibidos (remitente, destinatarios, asunto, fecha y un extracto). Para cada uno decide si genera un PENDIENTE para quien recibe el correo: algo que hay que hacer, responder, pagar, revisar, aprobar o entregar. NO son pendientes: publicidad, boletines, notificaciones automáticas informativas, confirmaciones de algo ya hecho, conversaciones que no piden nada.

Responde SOLO con JSON válido, sin texto alrededor, con esta forma:
{"correos":[{"id":"...","esPendiente":true,"titulo":"verbo + objeto, máx. 80 caracteres","resumen":"1 o 2 frases: qué piden, quién y contexto","prioridad":"baja|media|alta|urgente","venceEn":"YYYY-MM-DD o null","empresa":"Itech Dev|Dealer Solutions|NexusQTech|OperativAI|null","motivo":"por qué es pendiente"}]}

Para los que NO son pendientes basta {"id":"...","esPendiente":false}. Deduce la empresa por el dominio del remitente o destinatario, el proyecto o los productos mencionados; si no está claro, null. La prioridad es urgente si hay dinero o servicio en riesgo o vence en menos de 2 días; alta si piden respuesta esta semana; media por omisión; baja si es opcional.`;

interface RespuestaChat {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

/** Clasifica un lote de correos. Devuelve una entrada por cada id enviado. */
export async function clasificarCorreos(
  config: ConfiguracionIa,
  correos: CandidatoIa[],
  ahora = new Date()
): Promise<Clasificacion[]> {
  if (correos.length === 0) {
    return [];
  }
  const entrada = correos.map((c) => ({
    id: c.clave,
    de: c.encabezado.remitente,
    para: c.encabezado.para,
    asunto: c.encabezado.asunto,
    fecha: c.encabezado.fecha.slice(0, 10),
    extracto: c.texto.replace(/\s+/g, ' ').trim().slice(0, 400)
  }));
  const respuesta = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json',
      'http-referer': 'https://ds-monitor-nine.vercel.app',
      'x-title': 'DS Monitor'
    },
    body: JSON.stringify({
      model: config.modelo,
      temperature: 0,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: PROMPT },
        {
          role: 'user',
          content: `Hoy es ${ahora.toISOString().slice(0, 10)}. Correos:\n${JSON.stringify(entrada)}`
        }
      ]
    })
  });
  const datos = (await respuesta.json().catch(() => ({}))) as RespuestaChat;
  if (!respuesta.ok) {
    throw new ErrorProveedor(
      'openrouter',
      `respondió ${respuesta.status}: ${(datos.error?.message ?? '').slice(0, 200)}`
    );
  }
  const texto = datos.choices?.[0]?.message?.content ?? '';
  const parseado = interpretar(texto);
  const porId = new Map(parseado.map((c) => [c.id, c]));
  return correos.map((c) => {
    const r = porId.get(c.clave);
    return {
      id: c.clave,
      esPendiente: r?.esPendiente === true,
      titulo: texto1(r?.titulo),
      resumen: texto1(r?.resumen),
      prioridad: (['baja', 'media', 'alta', 'urgente'] as const).find(
        (p) => p === r?.prioridad
      ),
      venceEn:
        typeof r?.venceEn === 'string' && /^\d{4}-\d{2}-\d{2}/.test(r.venceEn)
          ? new Date(`${r.venceEn.slice(0, 10)}T12:00:00Z`).toISOString()
          : undefined,
      empresa: EMPRESAS.find((e) => e === r?.empresa),
      motivo: texto1(r?.motivo),
      analizadoEn: ahora.toISOString()
    };
  });
}

/** Saca el JSON aunque el modelo lo envuelva en texto o en ``` */
function interpretar(texto: string): Partial<Clasificacion>[] {
  const inicio = texto.indexOf('{');
  const fin = texto.lastIndexOf('}');
  if (inicio === -1 || fin === -1) {
    throw new ErrorProveedor('openrouter', 'no devolvió JSON');
  }
  try {
    const obj = JSON.parse(texto.slice(inicio, fin + 1)) as {
      correos?: Partial<Clasificacion>[];
    };
    return Array.isArray(obj.correos) ? obj.correos : [];
  } catch {
    throw new ErrorProveedor('openrouter', 'el JSON que devolvió no se pudo leer');
  }
}

function texto1(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : undefined;
}

/** De una clasificacion positiva a un pendiente del portal. */
export function pendienteDeClasificacion(
  clasificacion: Clasificacion,
  candidato: CandidatoIa,
  accountId: string
): TaskItem {
  const { encabezado } = candidato;
  // El id sale de la clave (fecha, remitente, asunto), no del UID: el UID
  // cambia si el correo se mueve de carpeta y en Graph es solo un contador.
  const id = `${accountId}-ia-${huella(candidato.clave)}`;
  return {
    id,
    title: clasificacion.titulo ?? encabezado.asunto,
    description: [
      clasificacion.resumen,
      clasificacion.motivo ? `Por qué: ${clasificacion.motivo}` : undefined,
      '',
      descripcionDeCorreo(encabezado, candidato.texto)
    ]
      .filter((x) => x !== undefined)
      .join('\n'),
    status: 'pendiente',
    priority: clasificacion.prioridad ?? 'media',
    dueDate: clasificacion.venceEn,
    accountId,
    origin: 'correo',
    project: clasificacion.empresa ?? 'Correo',
    company: clasificacion.empresa,
    tags: ['correo', 'ia'],
    updatedAt: encabezado.fecha || clasificacion.analizadoEn
  };
}

/** Un numero corto y estable a partir de un texto (FNV-1a). */
function huella(texto: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * La empresa a la que pertenece un buzon, por su identificador. Sirve para
 * los pendientes que salen de reglas (la IA ya trae la suya).
 */
export function empresaDeCuenta(accountId: string): string | undefined {
  const id = accountId.toLowerCase();
  if (id.includes('itech')) {
    return 'Itech Dev';
  }
  if (id.includes('dealer')) {
    return 'Dealer Solutions';
  }
  if (id.includes('nexus') || id.includes('outlook')) {
    return 'NexusQTech';
  }
  if (id.includes('operativ')) {
    return 'OperativAI';
  }
  return undefined;
}
