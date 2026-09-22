import type { ConfiguracionIa } from '../config/entorno.js';
import type { Person, TaskItem, TaskSubtarea } from '../nucleo/contrato.js';
import { notasDe, type Transcripcion } from '../proveedores/fireflies.js';
import { acuerdosDeJunta, personaDe } from './acuerdos.js';
import { huella } from '../proveedores/ia.js';
import { empresaPorPalabra } from '../datos/empresas.js';

/**
 * De cada junta que termina (Fireflies la transcribe minutos despues) sale
 * un solo pendiente padre con subtareas (una por acuerdo). El dueno del
 * monitor convierte en pendientes propios solo las que le interesan.
 */

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
  return empresaPorPalabra(texto);
}

/** Quienes del equipo aparecen por nombre en un texto (acuerdo o etiqueta). */
export function personasEnTexto(texto: string, equipo: Person[]): Person[] {
  const t = normalizar(texto);
  if (!t) {
    return [];
  }
  const vistos = new Set<string>();
  const salida: Person[] = [];
  for (const p of equipo) {
    const clave = p.id || p.email || p.name;
    if (vistos.has(clave)) {
      continue;
    }
    const nombre = normalizar(p.name);
    const partes = nombre.split(/\s+/).filter((x) => x.length > 2);
    const correoLocal = p.email ? normalizar(p.email.split('@')[0] ?? '') : '';
    const coincide =
      (nombre.length > 2 && t.includes(nombre)) ||
      (correoLocal.length > 2 && t.includes(correoLocal)) ||
      partes.some((parte) => new RegExp(`\\b${escaparRe(parte)}\\b`).test(t));
    if (coincide) {
      vistos.add(clave);
      salida.push(p);
    }
  }
  return salida;
}

/**
 * Responsables de un acuerdo: la persona emparejada, mas quien aparezca en
 * el titulo o en la etiqueta de Fireflies. Sin emparejar, queda la etiqueta.
 */
export function responsablesDeAcuerdo(
  titulo: string,
  equipo: Person[],
  persona?: Person,
  responsableTexto?: string
): Partial<Pick<TaskSubtarea, 'responsables' | 'responsableEtiqueta'>> {
  const porTexto = personasEnTexto(
    `${titulo} ${responsableTexto ?? ''}`,
    equipo
  );
  const mapa = new Map<string, Person>();
  if (persona) {
    mapa.set(persona.id || persona.email || persona.name, persona);
  }
  for (const p of porTexto) {
    mapa.set(p.id || p.email || p.name, p);
  }
  const responsables = [...mapa.values()];
  if (responsables.length > 0) {
    return { responsables };
  }
  const etiqueta = responsableTexto?.trim();
  return etiqueta ? { responsableEtiqueta: etiqueta } : {};
}

export function idSubtarea(indice: number, titulo: string): string {
  return `sub-${huella(`${indice}:${titulo}`)}`;
}

/** El pendiente propio que nace al convertir una subtarea. */
export function pendienteDeSubtarea(
  padre: TaskItem,
  subtarea: TaskSubtarea,
  ahora: string
): TaskItem {
  const responsables = subtarea.responsables ?? [];
  return {
    id: `local-ff-${padre.id}-${subtarea.id}-${huella(ahora)}`,
    title: subtarea.titulo.slice(0, 160),
    description: [
      `Convertido de la junta: ${padre.title}`,
      padre.url,
      subtarea.responsableEtiqueta
        ? `Responsable según Fireflies: ${subtarea.responsableEtiqueta}`
        : undefined
    ]
      .filter((x) => x)
      .join('\n'),
    status: 'pendiente',
    priority: 'media',
    accountId: 'mios',
    origin: 'local',
    project: padre.project,
    company: padre.company,
    tags: ['junta', 'fireflies', 'convertido'],
    assignee: responsables[0],
    followers: responsables.length > 1 ? responsables.slice(1) : undefined,
    updatedAt: ahora
  };
}

/** Marca la subtarea como convertida; idempotente si ya lo estaba. */
export function marcarSubtareaConvertida(
  padre: TaskItem,
  subId: string,
  pendienteId: string
): TaskItem {
  const subtareas = (padre.subtareas ?? []).map((s) =>
    s.id === subId ? { ...s, convertida: true as const, pendienteId } : s
  );
  return { ...padre, subtareas, updatedAt: new Date().toISOString() };
}

/**
 * Decide si el padre de una junta se agrega a personales.
 * - Ya existe `fireflies-{id}` → no pisar (puede haber conversiones).
 * - Quedan pendientes legado `fireflies-{id}-{hash}` → no crear el padre
 *   (evita duplicar al re-procesar juntas viejas).
 * - Si no, agregar el padre tal cual (sin auto-asignar acuerdos).
 */
export type DecisionPendienteFireflies =
  | { accion: 'agregar'; padre: TaskItem }
  | { accion: 'omitir'; motivo: 'ya_existe' | 'legado' }
  | { accion: 'nada' };

export function decidirPendienteFireflies(
  existentes: Pick<TaskItem, 'id'>[],
  padre: TaskItem | undefined
): DecisionPendienteFireflies {
  if (!padre) {
    return { accion: 'nada' };
  }
  if (existentes.some((t) => t.id === padre.id)) {
    return { accion: 'omitir', motivo: 'ya_existe' };
  }
  // Legado: un pendiente por acuerdo (`fireflies-{id}-{huella}`).
  const prefijoLegado = `${padre.id}-`;
  if (existentes.some((t) => t.id.startsWith(prefijoLegado))) {
    return { accion: 'omitir', motivo: 'legado' };
  }
  return { accion: 'agregar', padre };
}

/** Un solo pendiente por junta, con subtareas (una por acuerdo). */
export async function pendientesDeTranscripcion(
  config: ConfiguracionIa | undefined,
  t: Transcripcion,
  equipo: Person[],
  ahora = new Date()
): Promise<TaskItem | undefined> {
  const empresa = empresaDe(t);
  const proyecto = t.titulo.slice(0, 80);
  const iso = ahora.toISOString();
  const fecha = new Date(t.fecha).toLocaleDateString('es-MX', {
    dateStyle: 'medium',
    timeZone: 'America/Mexico_City'
  });

  const padreDe = (
    subtareas: TaskSubtarea[],
    extraDesc?: string
  ): TaskItem => ({
    id: `fireflies-${t.id}`,
    title: `Junta: ${t.titulo}`.slice(0, 160),
    description: [
      `Fecha: ${fecha}`,
      t.url,
      t.resumen?.trim() ? t.resumen.trim().slice(0, 400) : undefined,
      extraDesc
    ]
      .filter((x) => x)
      .join('\n'),
    status: 'pendiente',
    priority: 'media',
    accountId: 'mios',
    origin: 'local',
    project: proyecto,
    company: empresa,
    tags: ['junta', 'fireflies'],
    url: t.url,
    unread: {
      kind: 'nuevo',
      at: iso,
      text: 'Junta de Fireflies'
    },
    subtareas,
    updatedAt: iso
  });

  const subtareaDe = (
    i: number,
    titulo: string,
    persona?: Person,
    responsableTexto?: string
  ): TaskSubtarea => ({
    id: idSubtarea(i, titulo),
    titulo: titulo.slice(0, 140),
    ...responsablesDeAcuerdo(titulo, equipo, persona, responsableTexto)
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
        return padreDe(
          acuerdos.map((a, i) =>
            subtareaDe(i, a.titulo, a.persona, a.responsable)
          )
        );
      }
    } catch (error) {
      console.warn(
        `[puente] IA sobre la junta "${t.titulo}": ${(error as Error).message}`
      );
    }
  }

  const leidos = leerAcuerdos(t.acuerdos ?? '', equipo);
  if (leidos.length === 0) {
    return undefined;
  }
  return padreDe(
    leidos.map((a, i) => subtareaDe(i, a.titulo, a.persona, a.responsable))
  );
}

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function escaparRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
