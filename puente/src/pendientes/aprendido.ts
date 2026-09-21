import type { Person, SenderKind, TaskItem } from '../nucleo/contrato.js';
import type { CambiosPendiente } from './anotaciones.js';
import { correoDelRemitente } from './remitente.js';

/**
 * Lo que el portal aprende de las correcciones a mano.
 *
 * Cuando alguien cambia la empresa, la prioridad o "quien lo pide" de un
 * pendiente que vino del correo, o lo asigna a alguien, se guarda por
 * remitente. La proxima vez que llegue algo de ese remitente, la empresa y
 * el tipo se aplican directo (sin modelo), el responsable se asigna al
 * registrarlo (ver `leido` en rutas), y la prioridad se le pasa al modelo
 * como pista.
 */
export interface Aprendido {
  company?: string;
  senderKind?: SenderKind;
  priority?: TaskItem['priority'];
  /** A quien se le asigno la ultima vez algo de este remitente. */
  assignee?: Person;
  veces: number;
  en: string;
}

export type Aprendizajes = Record<string, Aprendido>;

/**
 * Registra una correccion; devuelve el diccionario nuevo o el mismo si no
 * aplica. `asignado` guarda el responsable; `null` lo olvida (alguien lo
 * quito a mano y no hay que volver a ponerlo).
 */
export function aprender(
  previos: Aprendizajes,
  tarea: TaskItem,
  cambios: CambiosPendiente,
  ahora = new Date(),
  asignado?: Person | null
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
    assignee:
      asignado === null
        ? undefined
        : asignado
          ? { id: asignado.id, name: asignado.name, email: asignado.email }
          : previo?.assignee,
    veces: (previo?.veces ?? 0) + 1,
    en: ahora.toISOString()
  };
  if (
    !nuevo.company &&
    !nuevo.senderKind &&
    !nuevo.priority &&
    !nuevo.assignee
  ) {
    if (!previo) {
      return previos;
    }
    // Lo unico aprendido era el responsable y se olvido: la entrada sobra.
    const { [remitente]: _olvidado, ...resto } = previos;
    return resto;
  }
  return { ...previos, [remitente]: nuevo };
}

/** El responsable aprendido para un pendiente de correo, si lo hay. */
export function responsableAprendido(
  tarea: TaskItem,
  aprendido: Aprendizajes
): Person | undefined {
  if (tarea.origin !== 'correo') {
    return undefined;
  }
  return aprendido[correoDelRemitente(tarea.description) ?? '']?.assignee;
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
        a.assignee ? `lo atiende ${a.assignee.name}` : undefined,
        a.senderKind === 'equipo' ? 'es alguien del equipo' : undefined
      ]
        .filter((x) => x)
        .join(': ')
    );
}
