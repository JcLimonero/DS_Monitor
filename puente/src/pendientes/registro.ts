import type { TaskItem } from '../nucleo/contrato.js';
import { claveDePendiente } from './homologar.js';

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

function claveCorreo(t: TaskItem): string {
  return `${t.accountId}\n${claveDePendiente(t)}`;
}

/** El que ya estaba, el mas antiguo por updatedAt (y por id si empatan). */
function masAntiguo(grupo: readonly TaskItem[]): TaskItem {
  return grupo.reduce((mejor, actual) => {
    const porFecha = actual.updatedAt.localeCompare(mejor.updatedAt);
    if (porFecha < 0 || (porFecha === 0 && actual.id < mejor.id)) {
      return actual;
    }
    return mejor;
  });
}

/** Mezcla lo detectado ahora con lo registrado antes para una cuenta. */
export function registrar(
  previos: TaskItem[],
  detectados: TaskItem[],
  hechos: ReadonlySet<string>,
  ahora = new Date()
): TaskItem[] {
  const porId = new Map(previos.map((t) => [t.id, t]));
  const correoPrevio = new Map<string, TaskItem[]>();
  for (const t of previos) {
    if (t.origin !== 'correo') {
      continue;
    }
    const clave = claveCorreo(t);
    correoPrevio.set(clave, [...(correoPrevio.get(clave) ?? []), t]);
  }
  for (const tarea of detectados) {
    if (tarea.origin === 'correo') {
      const grupo = correoPrevio.get(claveCorreo(tarea));
      if (grupo && grupo.length > 0) {
        const canonica = masAntiguo(grupo);
        for (const otra of grupo) {
          if (otra.id !== canonica.id) {
            porId.delete(otra.id);
          }
        }
        if (tarea.id !== canonica.id) {
          porId.delete(tarea.id);
        }
        const previa = porId.get(canonica.id) ?? canonica;
        // Titulo y fechas de lo detectado; el id viejo se queda para que
        // las anotaciones sigan pegadas.
        porId.set(canonica.id, { ...previa, ...tarea, id: canonica.id });
        continue;
      }
    }
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
