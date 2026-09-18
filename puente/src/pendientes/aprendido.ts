import type { SenderKind, TaskItem } from '../nucleo/contrato.js';
import type { CambiosPendiente } from './anotaciones.js';
import { correoDelRemitente } from './remitente.js';

/**
 * Lo que el portal aprende de las correcciones a mano.
 *
 * Cuando alguien cambia la empresa, la prioridad o "quien lo pide" de un
 * pendiente que vino del correo, se guarda por remitente. La proxima vez
 * que llegue algo de ese remitente, la empresa y el tipo se aplican
 * directo (sin modelo), y la prioridad se le pasa al modelo como pista.
 */
export interface Aprendido {
  company?: string;
  senderKind?: SenderKind;
  priority?: TaskItem['priority'];
  veces: number;
  en: string;
}

export type Aprendizajes = Record<string, Aprendido>;

/** Registra una correccion; devuelve el diccionario nuevo o el mismo si no aplica. */
export function aprender(
  previos: Aprendizajes,
  tarea: TaskItem,
  cambios: CambiosPendiente,
  ahora = new Date()
): Aprendizajes {
  if (tarea.origin !== 'correo') {
    return previos;
  }
  const remitente = correoDelRemitente(tarea.description);
  if (!remitente) {
    return previos;
  }
  const previo = previos[remitente];
  const nuevo: Aprendido = {
    company: 'company' in cambios ? cambios.company : previo?.company,
    senderKind: cambios.senderKind ?? previo?.senderKind,
    priority: cambios.priority ?? previo?.priority,
    veces: (previo?.veces ?? 0) + 1,
    en: ahora.toISOString()
  };
  if (!nuevo.company && !nuevo.senderKind && !nuevo.priority) {
    return previos;
  }
  return { ...previos, [remitente]: nuevo };
}

/** Pone encima lo aprendido por remitente (empresa y quien lo pide). */
export function aplicarAprendido(
  tareas: TaskItem[],
  aprendido: Aprendizajes
): TaskItem[] {
  return tareas.map((t) => {
    if (t.origin !== 'correo') {
      return t;
    }
    const a = aprendido[correoDelRemitente(t.description) ?? ''];
    if (!a) {
      return t;
    }
    return {
      ...t,
      company: a.company ?? t.company,
      senderKind: a.senderKind ?? t.senderKind
    };
  });
}

/** Pistas para el modelo: "de este remitente, es de tal empresa y prioridad". */
export function pistasParaModelo(
  aprendido: Aprendizajes,
  maximo = 40
): string[] {
  return Object.entries(aprendido)
    .sort((a, b) => b[1].veces - a[1].veces)
    .slice(0, maximo)
    .map(([remitente, a]) =>
      [
        remitente,
        a.company ? `empresa ${a.company}` : undefined,
        a.priority ? `prioridad ${a.priority}` : undefined,
        a.senderKind === 'equipo' ? 'es alguien del equipo' : undefined
      ]
        .filter((x) => x)
        .join(': ')
    );
}
