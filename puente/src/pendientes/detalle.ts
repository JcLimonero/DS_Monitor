import type {
  Person,
  TaskItem,
  TaskPriority,
  TaskStatus
} from '../nucleo/contrato.js';
import { conPrioridadPersonal } from './prioridad.js';

/** Cuantas fotos caben en un pendiente; el portal recorta igual. */
export const MAX_FOTOS = 8;
/** Base64 de una foto, ~675 KB: el portal las comprime antes de mandarlas. */
const MAX_CHARS_FOTO = 900_000;
const MAX_DETALLE = 16_000;

const FOTO =
  /^data:(image\/(?:jpeg|jpg|png|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/;

const ESTADOS: readonly TaskStatus[] = [
  'pendiente',
  'en_progreso',
  'bloqueado',
  'hecho'
];
const PRIORIDADES: readonly TaskPriority[] = [
  'baja',
  'media',
  'alta',
  'urgente'
];

/**
 * El detalle del pendiente: se recorta, pero los saltos de linea se quedan.
 * Un trim que colapsara espacios romperia lo que se ve en la tarjeta.
 */
export function limpiarDescripcion(valor: unknown): string | undefined {
  if (typeof valor !== 'string') {
    return undefined;
  }
  const texto = valor.replace(/\r\n/g, '\n').trim();
  if (!texto) {
    return undefined;
  }
  return texto.slice(0, MAX_DETALLE);
}

/** Solo data URLs de imagen; lo demas se descarta. */
export function limpiarImagenes(valor: unknown): string[] | undefined {
  if (!Array.isArray(valor)) {
    return undefined;
  }
  const salida: string[] = [];
  for (const cruda of valor) {
    if (typeof cruda !== 'string') {
      continue;
    }
    const compacta = cruda.replace(/\s/g, '');
    const m = FOTO.exec(compacta);
    const mimeCrudo = m?.[1];
    const datos = m?.[2];
    if (!mimeCrudo || !datos || datos.length > MAX_CHARS_FOTO) {
      continue;
    }
    const mime = mimeCrudo === 'image/jpg' ? 'image/jpeg' : mimeCrudo;
    salida.push(`data:${mime};base64,${datos}`);
    if (salida.length >= MAX_FOTOS) {
      break;
    }
  }
  return salida.length > 0 ? salida : undefined;
}

export function esFotoDataUrl(valor: string): boolean {
  return FOTO.test(valor.replace(/\s/g, ''));
}

/** Persona del equipo tal como llega en el alta o en el guardado. */
export function limpiarPersona(valor: unknown): Person | undefined {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    return undefined;
  }
  const p = valor as Record<string, unknown>;
  const name = typeof p['name'] === 'string' ? p['name'].trim() : '';
  const id = typeof p['id'] === 'string' ? p['id'].trim() : '';
  const email =
    typeof p['email'] === 'string' && p['email'].trim()
      ? p['email'].trim()
      : undefined;
  if (!name && !id && !email) {
    return undefined;
  }
  const role =
    typeof p['role'] === 'string' && p['role'].trim()
      ? p['role'].trim()
      : undefined;
  return {
    id: id || email || name,
    name: name || id || email || 'Sin nombre',
    email,
    role
  };
}

/**
 * Un pendiente propio (alta del portal, dictado, Telegram) listo para
 * escribirse: titulo, detalle con saltos, fotos, fecha/hora. El responsable
 * no viaja aqui: se anota despues con `/pendientes/responsables` para que
 * el aviso y la trazabilidad sean los de siempre.
 */
export function limpiarPendienteLocal(
  cruda: unknown,
  i: number,
  ahora: string
): TaskItem {
  const t = (cruda ?? {}) as Record<string, unknown>;
  const title = typeof t['title'] === 'string' ? t['title'].trim() : '';
  if (!title) {
    throw new Error(`pendientes[${i}].title es obligatorio.`);
  }
  const texto = (v: unknown) =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined;
  const personal = t['personal'] === true;
  const dueDate = texto(t['dueDate']);
  const imagenes = limpiarImagenes(t['imagenes']);
  const limpio: TaskItem = {
    id: texto(t['id']) ?? `local-${i}-${Date.now()}`,
    title: title.slice(0, 160),
    description: limpiarDescripcion(t['description']),
    imagenes,
    status: ESTADOS.find((e) => e === t['status']) ?? 'pendiente',
    priority: personal
      ? dueDate
        ? 'urgente'
        : 'alta'
      : (PRIORIDADES.find((p) => p === t['priority']) ?? 'media'),
    dueDate,
    dueHasTime: t['dueHasTime'] === true ? true : undefined,
    accountId: 'mios',
    origin: 'local',
    project: texto(t['project']),
    company: texto(t['company']),
    personal: personal ? true : undefined,
    tags: Array.isArray(t['tags'])
      ? (t['tags'] as unknown[]).filter(
          (x): x is string => typeof x === 'string'
        )
      : [],
    updatedAt: texto(t['updatedAt']) ?? ahora
  };
  return conPrioridadPersonal(limpio);
}
