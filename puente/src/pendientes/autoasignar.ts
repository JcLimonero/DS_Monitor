import type { TaskItem } from '../nucleo/contrato.js';
import type { Anotaciones } from './anotaciones.js';

/**
 * Que pendientes pueden recibir responsable solos.
 *
 * La autoasignacion corre de dos formas: incremental en cada lectura del
 * buzon (solo lo reciente, pocas consultas a la IA) y como barrido a demanda
 * sobre todo lo registrado. Las dos escogen candidatos con la misma regla,
 * que vive aqui sin depender de la IA ni del almacen para poderse probar.
 */
export interface OpcionesCandidatos {
  /** Solo los actualizados en estos ultimos dias; sin valor, todos. */
  diasAtras?: number;
  /**
   * Vuelve a intentar con los que ya se revisaron (`autoAsignacionIntentada`)
   * y siguen sin responsable. Los que tienen una sugerencia vigente no se
   * repiten: ya hay una propuesta esperando decision.
   */
  reintentar?: boolean;
  ahora?: Date;
}

/**
 * Los pendientes de correo abiertos, sin responsable y que nadie ha tocado.
 * Con movimientos de una persona en el historial ya alguien decidio algo
 * (por ejemplo quitarle el responsable): no se le pone otro solo. Las notas
 * que deja el propio correo relacionado no cuentan como decision de nadie.
 */
export function candidatosDeAutoasignacion(
  tareas: TaskItem[],
  anotaciones: Anotaciones,
  opciones: OpcionesCandidatos = {}
): TaskItem[] {
  const ahora = opciones.ahora ?? new Date();
  const limite =
    opciones.diasAtras === undefined
      ? undefined
      : ahora.getTime() - opciones.diasAtras * 86_400_000;
  return tareas.filter((t) => {
    const nota = anotaciones[t.id];
    if (t.origin !== 'correo') {
      return false;
    }
    if (t.assignee || nota?.asignado) {
      return false;
    }
    if (t.status === 'hecho' || nota?.hecho || nota?.estado === 'hecho') {
      return false;
    }
    if (nota?.eliminado) {
      return false;
    }
    if (limite !== undefined && Date.parse(t.updatedAt) < limite) {
      return false;
    }
    if (nota?.historial?.some((e) => e.by !== 'Correo')) {
      return false;
    }
    if (nota?.autoAsignacionIntentada) {
      return !!opciones.reintentar && !nota.sugerencia;
    }
    return true;
  });
}

/** Un pendiente que quedo con responsable (o con propuesta) en la corrida. */
export interface PendienteAtendido {
  id: string;
  titulo: string;
  responsable: string;
}

/**
 * Lo que dejo una corrida de autoasignacion. `revisados` son los candidatos
 * que si se atendieron (por regla o preguntando a la IA); `omitidos` los que
 * quedaron para otra vez porque no hubo IA o se acabaron las consultas.
 */
export interface ResumenAutoasignacion {
  revisados: number;
  asignadosPorRegla: PendienteAtendido[];
  asignadosPorIa: PendienteAtendido[];
  sugeridos: PendienteAtendido[];
  /** La IA no propuso a nadie, o fallo la consulta o la asignacion. */
  sinPropuesta: number;
  omitidos: number;
  consultas: number;
}

export function resumenVacio(): ResumenAutoasignacion {
  return {
    revisados: 0,
    asignadosPorRegla: [],
    asignadosPorIa: [],
    sugeridos: [],
    sinPropuesta: 0,
    omitidos: 0,
    consultas: 0
  };
}

/** El resumen en una linea, como lo enseñan el portal y Telegram. */
export function describirResumen(resumen: ResumenAutoasignacion): string {
  const asignados =
    resumen.asignadosPorRegla.length + resumen.asignadosPorIa.length;
  return (
    `Asignados ${asignados} (regla ${resumen.asignadosPorRegla.length}, IA ${resumen.asignadosPorIa.length})` +
    ` · Sugeridos ${resumen.sugeridos.length}` +
    ` · Sin propuesta ${resumen.sinPropuesta}` +
    (resumen.omitidos > 0 ? ` · Pendientes de revisar ${resumen.omitidos}` : '')
  );
}
