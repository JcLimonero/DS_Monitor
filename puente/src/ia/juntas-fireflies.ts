import type { ConfiguracionIa } from '../config/entorno.js';
import type { Person, TaskItem } from '../nucleo/contrato.js';
import { notasDe, type Transcripcion } from '../proveedores/fireflies.js';
import { acuerdosDeJunta, personaDe } from './acuerdos.js';
import { huella } from '../proveedores/ia.js';

/**
 * De cada junta que termina (Fireflies la transcribe minutos despues) salen
 * pendientes: uno por acuerdo, con responsable si Fireflies lo puso bajo el
 * nombre de alguien del equipo, agrupados por proyecto (el titulo de la
 * junta). Con modelo, los acuerdos los afina la IA sobre la transcripcion;
 * sin modelo se toman los "action items" de Fireflies tal cual, que ya
 * vienen por persona.
 */

const EMPRESA_POR_PALABRA: [RegExp, string][] = [
  [/\bitech\b/i, 'Itech Dev'],
  [/\bdealer/i, 'Dealer Solutions'],
  [/\bnexus/i, 'NexusQTech'],
  [/\boperativ/i, 'OperativAI']
];

export interface AcuerdoFireflies {
  titulo: string;
  responsable?: string;
  persona?: Person;
}

/**
 * Los action items de Fireflies vienen como bloques "**Nombre**" seguidos de
 * lineas con "(mm:ss)" al final.
 */
export function leerAcuerdos(
  texto: string,
  equipo: Person[]
): AcuerdoFireflies[] {
  const salida: AcuerdoFireflies[] = [];
  let responsable: string | undefined;
  for (const cruda of texto.split(/\r?\n/)) {
    const linea = cruda.trim();
    if (!linea) {
      continue;
    }
    const encabezado = /^\*\*(.+?)\*\*:?$/.exec(linea);
    if (encabezado) {
      responsable = encabezado[1]?.trim();
      continue;
    }
    const titulo = linea
      .replace(/^[-*•]\s*/, '')
      .replace(/\s*\(\d{1,2}:\d{2}(?::\d{2})?\)\s*$/, '')
      .trim();
    if (titulo.length < 4) {
      continue;
    }
    // "Equipo (Carlos, Johana y Marcos)" no es una persona: queda sin responsable.
    const individual = responsable && !/equipo|todos|team/i.test(responsable);
    salida.push({
      titulo: titulo.slice(0, 140),
      responsable: individual ? responsable : undefined,
      persona:
        individual && responsable ? personaDe(responsable, equipo) : undefined
    });
  }
  return salida;
}

export function empresaDe(t: Transcripcion): string | undefined {
  const texto = `${t.titulo} ${t.resumen ?? ''} ${t.temas?.join(' ') ?? ''}`;
  return EMPRESA_POR_PALABRA.find(([re]) => re.test(texto))?.[1];
}

/** Los pendientes que salen de una transcripcion; ids estables por junta y acuerdo. */
export async function pendientesDeTranscripcion(
  config: ConfiguracionIa | undefined,
  t: Transcripcion,
  equipo: Person[],
  ahora = new Date()
): Promise<TaskItem[]> {
  const empresa = empresaDe(t);
  const proyecto = t.titulo.slice(0, 80);
  const base = (
    i: number,
    titulo: string,
    persona: Person | undefined,
    extra: Partial<TaskItem> = {}
  ): TaskItem => ({
    id: `fireflies-${t.id}-${huella(`${i}:${titulo}`)}`,
    title: titulo,
    description: `Acuerdo de la junta "${t.titulo}" (${new Date(t.fecha).toLocaleDateString('es-MX', { dateStyle: 'medium', timeZone: 'America/Mexico_City' })})${t.url ? `\n${t.url}` : ''}`,
    status: 'pendiente',
    priority: 'media',
    accountId: 'mios',
    origin: 'local',
    project: proyecto,
    company: empresa,
    tags: ['junta', 'fireflies'],
    assignee: persona,
    updatedAt: ahora.toISOString(),
    ...extra
  });

  if (config && (t.texto || t.acuerdos)) {
    try {
      const acuerdos = await acuerdosDeJunta(
        config,
        {
          id: t.id,
          title: t.titulo,
          start: t.fecha,
          end: new Date(
            Date.parse(t.fecha) + (t.duracionMin ?? 60) * 60_000
          ).toISOString(),
          allDay: false,
          accountId: 'fireflies',
          status: 'confirmada',
          attendees: t.participantes.map((email) => ({
            id: email,
            name: email,
            email
          })),
          notes: notasDe(t)
        },
        equipo,
        ahora
      );
      if (acuerdos.length > 0) {
        return acuerdos.map((a, i) =>
          base(i, a.titulo, a.persona, {
            description: [
              a.descripcion,
              `Acuerdo de la junta "${t.titulo}"`,
              t.url
            ]
              .filter((x) => x)
              .join('\n'),
            priority: a.prioridad,
            dueDate: a.venceEn,
            company: a.empresa ?? empresa
          })
        );
      }
    } catch (error) {
      console.warn(
        `[puente] IA sobre la junta "${t.titulo}": ${(error as Error).message}`
      );
    }
  }
  return leerAcuerdos(t.acuerdos ?? '', equipo).map((a, i) =>
    base(i, a.titulo, a.persona, {
      description: `${a.responsable ? `Responsable según Fireflies: ${a.responsable}\n` : ''}Acuerdo de la junta "${t.titulo}"${t.url ? `\n${t.url}` : ''}`
    })
  );
}
