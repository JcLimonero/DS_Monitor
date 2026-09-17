import type { TaskItem } from '../nucleo/contrato.js';

/**
 * El registro de pendientes que salieron del correo.
 *
 * Cada lectura del buzon detecta los avisos de los ultimos treinta dias; aqui
 * se van registrando por identificador para que un pendiente no desaparezca
 * solo porque el correo ya es viejo. Sale del registro cuando lleva noventa
 * dias marcado como hecho.
 */
export type Registro = Record<string, TaskItem[]>;

const RETENCION_HECHOS_MS = 90 * 86_400_000;

/** Mezcla lo detectado ahora con lo registrado antes para una cuenta. */
export function registrar(
  previos: TaskItem[],
  detectados: TaskItem[],
  hechos: ReadonlySet<string>,
  ahora = new Date()
): TaskItem[] {
  const porId = new Map(previos.map((t) => [t.id, t]));
  for (const tarea of detectados) {
    const previa = porId.get(tarea.id);
    // Lo detectado manda en titulo y fechas; lo anotado (hecho, asignado) se
    // pone encima despues, al servir.
    porId.set(tarea.id, previa ? { ...previa, ...tarea } : tarea);
  }
  return [...porId.values()].filter(
    (t) =>
      !hechos.has(t.id) ||
      ahora.getTime() - Date.parse(t.updatedAt) < RETENCION_HECHOS_MS
  );
}
