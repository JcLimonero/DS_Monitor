import type { LlamadaArchivada, TaskItem } from '../nucleo/contrato.js';
import type { Anotaciones } from '../pendientes/anotaciones.js';
import type { Transcripcion } from '../proveedores/fireflies.js';

/**
 * Archivar las llamadas de Fireflies en Google Drive: lo que se decide y se
 * arma sin tocar la red. El orquestador (servicio.ts) usa estas funciones; aqui
 * viven las que se pueden probar sin Fireflies ni Google.
 */

const ZONA = 'America/Mexico_City';

/**
 * Cuanto se espera antes de archivar una llamada que nadie ha procesado:
 * Fireflies tarda un rato en dejar listos el resumen y los acuerdos, y si se
 * archiva (y se borra) antes, los pendientes de la junta no se alcanzan a crear.
 */
export const REPOSO_HORAS = 12;

/**
 * Una llamada sin una sola frase mas vieja que esto se archiva igual (solo con
 * el encabezado): ya no es que siga procesandose, es que estuvo en silencio.
 */
export const ESPERA_SIN_FRASES_HORAS = 48;

/**
 * El tope de caracteres de un Google Doc es ~1.02 millones; se deja margen
 * para el encabezado y los saltos que Docs cuenta como caracteres.
 */
export const MAXIMO_CARACTERES_DOC = 900_000;

/**
 * Solo se procesan (se crean sus pendientes) las juntas de los ultimos dias,
 * como el programable de juntas: las mas viejas solo se archivan. Si no, la
 * primera corrida crearia decenas de pendientes viejos y una llamada a la IA
 * por cada uno.
 */
export const DIAS_PARA_PROCESAR = 3;

function formatoFecha(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return 'sin fecha';
  }
  return d.toLocaleString('es-MX', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: ZONA
  });
}

/** "mm:ss" o "h:mm:ss" a partir de segundos. */
export function marcaDeTiempo(segundos: number): string {
  const total = Math.max(0, Math.floor(segundos));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const dos = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${dos(m)}:${dos(s)}` : `${dos(m)}:${dos(s)}`;
}

/**
 * El documento completo de una llamada: encabezado (titulo, fecha en es-MX,
 * duracion, participantes, resumen y acuerdos) y luego la conversacion, una
 * linea por frase: `[mm:ss] Nombre: frase` (sin marca si no viene).
 */
export function textoDeTranscripcion(t: Transcripcion): string {
  const partes: string[] = [t.titulo.trim() || '(sin título)', ''];
  partes.push(`Fecha: ${formatoFecha(t.fecha)}`);
  if (t.duracionMin) {
    partes.push(`Duración: ${t.duracionMin} min`);
  }
  if (t.participantes.length > 0) {
    partes.push(`Participantes: ${t.participantes.join(', ')}`);
  }
  if (t.resumen?.trim()) {
    partes.push('', 'Resumen', t.resumen.trim());
  }
  if (t.acuerdos?.trim()) {
    partes.push('', 'Acuerdos', t.acuerdos.trim());
  }
  partes.push('', 'Conversación');
  const frases = t.frases ?? [];
  if (frases.length === 0) {
    partes.push('(sin conversación transcrita)');
  }
  for (const f of frases) {
    const texto = f.texto.replace(/\s*\n\s*/g, ' ').trim();
    if (!texto) {
      continue;
    }
    const marca =
      f.inicioSeg !== undefined ? `[${marcaDeTiempo(f.inicioSeg)}] ` : '';
    const quien = f.hablante ? `${f.hablante}: ` : '';
    partes.push(`${marca}${quien}${texto}`);
  }
  return `${partes.join('\n')}\n`;
}

/** `2026-09-30 — Junta con Vanguardia`: la fecha va primero para que Drive ordene solo. */
export function nombreDeArchivo(t: Pick<Transcripcion, 'titulo' | 'fecha'>) {
  const titulo = t.titulo
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  const limpio = titulo || '(sin título)';
  const d = new Date(t.fecha);
  if (Number.isNaN(d.getTime())) {
    return limpio;
  }
  const dia = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
  return `${dia} — ${limpio}`;
}

export type AccionArchivo = 'archivar' | 'procesar-y-archivar';

export interface DecisionArchivo {
  transcripcion: Transcripcion;
  accion: AccionArchivo;
}

export interface OpcionesPorArchivar {
  ahora: Date;
  /** Archivar sin esperar el reposo (cuando se pide una llamada en concreto). */
  forzar?: boolean;
}

/**
 * Cuales transcripciones toca archivar y como.
 *
 * - Ya archivadas: no.
 * - Ya procesadas (sus pendientes ya existen): se archivan.
 * - Sin procesar y recientes (menos de `REPOSO_HORAS`): se esperan, para que
 *   Fireflies termine el resumen y la junta genere sus pendientes.
 * - Sin procesar, con acuerdos y de los ultimos `DIAS_PARA_PROCESAR` dias:
 *   primero se procesan (se crean los pendientes) y luego se archivan, para no
 *   perder lo que sale de la junta.
 * - Sin procesar y sin acuerdos, o mas viejas que eso: solo se archivan (es lo
 *   mismo que hace el programable de juntas, que no mira lo viejo).
 */
export function porArchivar(
  transcripciones: Transcripcion[],
  yaArchivadas: Pick<LlamadaArchivada, 'id'>[],
  procesadas: Record<string, unknown>,
  opciones: OpcionesPorArchivar
): DecisionArchivo[] {
  const archivadas = new Set(yaArchivadas.map((l) => l.id));
  const salida: DecisionArchivo[] = [];
  const vistos = new Set<string>();
  for (const t of transcripciones) {
    if (archivadas.has(t.id) || vistos.has(t.id)) {
      continue;
    }
    vistos.add(t.id);
    if (procesadas[t.id]) {
      salida.push({ transcripcion: t, accion: 'archivar' });
      continue;
    }
    const edadMs = opciones.ahora.getTime() - Date.parse(t.fecha);
    if (
      !opciones.forzar &&
      Number.isFinite(edadMs) &&
      edadMs < REPOSO_HORAS * 3_600_000
    ) {
      continue;
    }
    const procesable =
      !!t.acuerdos?.trim() &&
      Number.isFinite(edadMs) &&
      edadMs < DIAS_PARA_PROCESAR * 86_400_000;
    salida.push({
      transcripcion: t,
      accion: procesable ? 'procesar-y-archivar' : 'archivar'
    });
  }
  return salida;
}

/** Cuanto pesa el documento, para no mandar a Docs lo que no cabe. */
export function cabeEnUnDoc(texto: string): boolean {
  return texto.length <= MAXIMO_CARACTERES_DOC;
}

/** Sin espacios repetidos ni marcas invisibles: para comparar lo subido contra lo exportado. */
function aplanar(s: string): string {
  return s
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * El documento exportado trae el final de la conversacion? Es la prueba de que
 * la subida no se corto, antes de borrar nada de Fireflies.
 */
export function contenidoCompleto(subido: string, exportado: string): boolean {
  const cola = aplanar(subido).slice(-60);
  if (!cola) {
    return true;
  }
  return aplanar(exportado).includes(cola);
}

/**
 * Las llamadas de Fireflies tienen su liga en la descripcion (y en `url`) del
 * pendiente de la junta y de los que nacieron de sus acuerdos. Al borrarla de
 * Fireflies esa liga se rompe: se cambia por la del Doc. Devuelve cuantos
 * pendientes cambiaron; no toca los que no mencionan la liga.
 */
export function reemplazarLigaDeJunta(
  tareas: TaskItem[],
  urlVieja: string,
  urlNueva: string
): { tareas: TaskItem[]; cambios: number } {
  if (!urlVieja || !urlNueva || urlVieja === urlNueva) {
    return { tareas, cambios: 0 };
  }
  let cambios = 0;
  const salida = tareas.map((t) => {
    const cambiaUrl = t.url === urlVieja;
    const cambiaDescripcion = t.description?.includes(urlVieja) === true;
    if (!cambiaUrl && !cambiaDescripcion) {
      return t;
    }
    cambios++;
    return {
      ...t,
      ...(cambiaUrl ? { url: urlNueva } : {}),
      ...(cambiaDescripcion && t.description
        ? { description: t.description.split(urlVieja).join(urlNueva) }
        : {})
    };
  });
  return { tareas: cambios > 0 ? salida : tareas, cambios };
}

/**
 * Igual, para lo editado a mano que vive en las anotaciones (la descripcion
 * que alguien reescribio desde el portal puede seguir trayendo la liga).
 */
export function reemplazarLigaEnAnotaciones(
  anotaciones: Anotaciones,
  urlVieja: string,
  urlNueva: string
): { anotaciones: Anotaciones; cambios: number } {
  if (!urlVieja || !urlNueva || urlVieja === urlNueva) {
    return { anotaciones, cambios: 0 };
  }
  let cambios = 0;
  const salida: Anotaciones = {};
  for (const [id, nota] of Object.entries(anotaciones)) {
    const descripcion = nota.cambios?.description;
    if (descripcion?.includes(urlVieja)) {
      cambios++;
      salida[id] = {
        ...nota,
        cambios: {
          ...nota.cambios,
          description: descripcion.split(urlVieja).join(urlNueva)
        }
      };
    } else {
      salida[id] = nota;
    }
  }
  return { anotaciones: cambios > 0 ? salida : anotaciones, cambios };
}
