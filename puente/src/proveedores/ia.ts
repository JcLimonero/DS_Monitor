import type { ConfiguracionIa } from '../config/entorno.js';
import {
  CONTEXTO_EMPRESAS,
  EMPRESAS,
  comoJson,
  fechaDe,
  preguntar,
  texto1
} from '../ia/modelo.js';
import type { TaskItem, TaskPriority } from '../nucleo/contrato.js';
import type { CandidatoIa } from './correo.js';
import { descripcionDeCorreo } from './correo.js';

/**
 * La IA que organiza el correo.
 *
 * Las reglas de `correo.ts` reconocen lo previsible (recibos, avisos de
 * vencimiento). Todo lo demas que llega —un cliente que pide algo, un
 * proveedor que espera respuesta, un colega que delega— lo lee el modelo y
 * decide si es un pendiente, para que empresa, con que prioridad y para
 * cuando; y si el correo parece un prospecto o una queja de un cliente, lo
 * propone para el CRM. Cada correo se analiza una sola vez: el resultado se
 * guarda por identificador y solo se mandan los nuevos.
 */

export { EMPRESAS };

export interface SugerenciaCrm {
  tipo: 'oportunidad' | 'queja';
  /** Nombre corto para la oportunidad o el caso. */
  nombre: string;
  /** Persona o empresa que escribe. */
  contacto?: string;
  correo?: string;
  resumen: string;
}

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
  crm?: SugerenciaCrm;
  analizadoEn: string;
}

const PROMPT = `${CONTEXTO_EMPRESAS}

Te doy correos recibidos (remitente, destinatarios, asunto, fecha y un extracto). Para cada uno decide si genera un PENDIENTE para quien recibe el correo: algo que hay que hacer, responder, pagar, revisar, aprobar o entregar. NO son pendientes: publicidad, boletines, notificaciones automáticas informativas, confirmaciones de algo ya hecho, conversaciones que no piden nada.

Además, si el correo lo escribe un cliente o prospecto (no un proveedor ni un colega) y pide una cotización, información de un producto, una demostración, o se queja de un servicio, propón un registro para el CRM.

Responde SOLO con JSON válido, sin texto alrededor, con esta forma:
{"correos":[{"id":"...","esPendiente":true,"titulo":"verbo + objeto, máx. 80 caracteres","resumen":"1 o 2 frases: qué piden, quién y contexto","prioridad":"baja|media|alta|urgente","venceEn":"YYYY-MM-DD o null","empresa":"Itech Dev|Dealer Solutions|NexusQTech|OperativAI|null","motivo":"por qué es pendiente","crm":null}]}

"crm" es null casi siempre; cuando aplica: {"tipo":"oportunidad|queja","nombre":"máx. 60 caracteres","contacto":"quién escribe","correo":"su dirección","resumen":"1 frase"}.
Para los que NO son pendientes basta {"id":"...","esPendiente":false,"crm":null}. Deduce la empresa por el dominio del remitente o destinatario, el proyecto o los productos mencionados; si no está claro, null. La prioridad es urgente si hay dinero o servicio en riesgo o vence en menos de 2 días; alta si piden respuesta esta semana; media por omisión; baja si es opcional.`;

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
  const texto = await preguntar(config, {
    sistema: PROMPT,
    usuario: `Hoy es ${ahora.toISOString().slice(0, 10)}. Correos:\n${JSON.stringify(entrada)}`,
    json: true,
    maxTokens: 4000
  });
  const parseado = comoJson<{ correos?: Partial<Clasificacion>[] }>(texto);
  const porId = new Map(
    (Array.isArray(parseado.correos) ? parseado.correos : []).map((c) => [
      c.id,
      c
    ])
  );
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
      venceEn: fechaDe(r?.venceEn),
      empresa: EMPRESAS.find((e) => e === r?.empresa),
      motivo: texto1(r?.motivo),
      crm: sugerenciaCrm(r?.crm, c),
      analizadoEn: ahora.toISOString()
    };
  });
}

function sugerenciaCrm(
  crudo: unknown,
  candidato: CandidatoIa
): SugerenciaCrm | undefined {
  const s = (crudo ?? undefined) as Partial<SugerenciaCrm> | undefined;
  if (!s || typeof s !== 'object') {
    return undefined;
  }
  const tipo = (['oportunidad', 'queja'] as const).find((t) => t === s.tipo);
  const nombre = texto1(s.nombre);
  if (!tipo || !nombre) {
    return undefined;
  }
  return {
    tipo,
    nombre: nombre.slice(0, 60),
    contacto: texto1(s.contacto),
    correo:
      texto1(s.correo) ??
      /<([^>]+)>/.exec(candidato.encabezado.remitente)?.[1] ??
      (candidato.encabezado.remitente.includes('@')
        ? candidato.encabezado.remitente
        : undefined),
    resumen: texto1(s.resumen) ?? ''
  };
}

/** De una clasificacion positiva a un pendiente del portal. */
export function pendienteDeClasificacion(
  clasificacion: Clasificacion,
  candidato: CandidatoIa,
  accountId: string
): TaskItem {
  const { encabezado } = candidato;
  return {
    id: idDeClasificacion(clasificacion, accountId),
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

/**
 * El id sale de la clave (fecha, remitente, asunto), no del UID: el UID
 * cambia si el correo se mueve de carpeta y en Graph es solo un contador.
 */
export function idDeClasificacion(
  clasificacion: { id: string },
  accountId: string
): string {
  return `${accountId}-ia-${huella(clasificacion.id)}`;
}

/** Un numero corto y estable a partir de un texto (FNV-1a). */
export function huella(texto: string): string {
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
