import type { ConfiguracionIa } from '../config/entorno.js';
import type { Meeting, Person, TaskPriority } from '../nucleo/contrato.js';
import {
  CONTEXTO_EMPRESAS,
  EMPRESAS,
  comoJson,
  enHorario,
  fechaDe,
  preguntar,
  texto1
} from './modelo.js';

/**
 * Acuerdos de una junta, propuestos como pendientes.
 *
 * Se lee lo que trae la invitacion o las notas (Graph y Google mandan el
 * cuerpo del evento) y se sacan compromisos con responsable y fecha. Son
 * propuestas: el portal las enseña con "agregar" o "descartar" y solo lo
 * aceptado entra a los pendientes.
 */
export interface Acuerdo {
  titulo: string;
  descripcion?: string;
  /** Correo o nombre de quien lo tiene que hacer, si la nota lo dice. */
  responsable?: string;
  /** La persona del equipo que corresponde a ese responsable, si se pudo. */
  persona?: Person;
  venceEn?: string;
  prioridad: TaskPriority;
  empresa?: string;
}

export async function acuerdosDeJunta(
  config: ConfiguracionIa,
  junta: Meeting,
  equipo: Person[],
  ahora = new Date()
): Promise<Acuerdo[]> {
  const notas = (junta.notes ?? '').trim();
  if (!notas) {
    return [];
  }
  const texto = await preguntar(config, {
    uso: 'juntas',
    sistema: `${CONTEXTO_EMPRESAS}\nTe doy una junta (título, fecha, asistentes y notas). Extrae los ACUERDOS: compromisos concretos que alguien tiene que hacer después de la junta. No inventes: si las notas no dicen nada accionable, devuelve una lista vacía. Responde SOLO JSON: {"acuerdos":[{"titulo":"verbo + objeto, máx. 80 caracteres","descripcion":"contexto en 1 frase o null","responsable":"nombre o correo de quien lo hace, o null","venceEn":"YYYY-MM-DD o null","prioridad":"baja|media|alta|urgente","empresa":"Itech Dev|Dealer Solutions|NexusQTech|OperativAI|null"}]}`,
    usuario: JSON.stringify({
      hoy: ahora.toISOString().slice(0, 10),
      titulo: junta.title,
      cuando: enHorario(junta.start),
      organiza: junta.organizer?.name,
      asistentes: junta.attendees.map((a) => `${a.name} <${a.email ?? ''}>`),
      equipo: equipo.map((p) => `${p.name} <${p.email ?? ''}>`),
      notas: notas.slice(0, 6000)
    }),
    json: true,
    maxTokens: 2000
  });
  const salida = comoJson<{ acuerdos?: Partial<Acuerdo>[] }>(texto);
  return (Array.isArray(salida.acuerdos) ? salida.acuerdos : [])
    .map((a): Acuerdo | undefined => {
      const titulo = texto1(a.titulo);
      if (!titulo) {
        return undefined;
      }
      const responsable = texto1(a.responsable);
      return {
        titulo: titulo.slice(0, 80),
        descripcion: texto1(a.descripcion),
        responsable,
        persona: responsable ? personaDe(responsable, equipo) : undefined,
        venceEn: fechaDe(a.venceEn),
        prioridad:
          (['baja', 'media', 'alta', 'urgente'] as const).find(
            (p) => p === a.prioridad
          ) ?? 'media',
        empresa: EMPRESAS.find((e) => e === a.empresa)
      };
    })
    .filter((a): a is Acuerdo => a !== undefined);
}

/** Quien del equipo es "Matías" o "matias@..."; por correo o por nombre. */
export function personaDe(
  responsable: string,
  equipo: Person[]
): Person | undefined {
  const r = normalizar(responsable);
  return (
    equipo.find((p) => p.email && r.includes(normalizar(p.email))) ??
    equipo.find((p) => normalizar(p.name) === r) ??
    equipo.find((p) => {
      const nombre = normalizar(p.name).split(' ')[0] ?? '';
      return nombre.length > 2 && r.split(/\s+/).includes(nombre);
    })
  );
}

function normalizar(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}
