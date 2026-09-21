import type { TaskItem } from '../nucleo/contrato.js';
import { type Anotacion, type Anotaciones, conEvento } from './anotaciones.js';

/**
 * Un correo que llega sobre un pendiente que ya existe.
 *
 * Cuando alguien contesta o manda mas informacion de algo que ya esta
 * registrado, no hace falta otro pendiente: el correo se resume y se pone
 * como nota en el que ya estaba, y el pendiente queda con una "novedad" que
 * se ve en el portal hasta que alguien lo abre.
 *
 * Hay dos maneras de saber que un correo es de un pendiente: el asunto (una
 * respuesta lleva el mismo asunto con RE:/RV: encima) y, para lo que no
 * coincide letra por letra, el modelo, que recibe la lista de pendientes
 * abiertos y dice cual es.
 */

/** Un pendiente abierto tal como se le enseña al modelo. */
export interface PendienteAbierto {
  id: string;
  titulo: string;
  remitente?: string;
}

const PREFIJOS = /^\s*((re|rv|fw|fwd|aw|wg|tr|enc)\s*:\s*)+/i;

/** Sin los "RE: RV: Fwd:" apilados, espacios colapsados y en minusculas. */
export function asuntoNormalizado(asunto: string): string {
  return asunto.replace(PREFIJOS, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** El "Asunto: …" que guarda la descripcion de un pendiente de correo. */
export function asuntoDeDescripcion(
  descripcion: string | undefined
): string | undefined {
  return /^Asunto: (.+)$/m.exec(descripcion ?? '')?.[1]?.trim() || undefined;
}

/** Asuntos de menos de esto ("hola", "info") no identifican un hilo. */
const ASUNTO_MINIMO = 6;

/**
 * El pendiente de correo cuyo asunto es el mismo hilo que el del correo
 * nuevo. Si varios coinciden gana el mas reciente. Los asuntos muy cortos no
 * cuentan: "Factura" o "Hola" no dicen de que hilo son.
 */
export function relacionarPorAsunto(
  asunto: string,
  candidatos: readonly TaskItem[]
): TaskItem | undefined {
  const buscado = asuntoNormalizado(asunto);
  if (buscado.length < ASUNTO_MINIMO) {
    return undefined;
  }
  return candidatos
    .filter(
      (t) =>
        t.origin === 'correo' &&
        asuntoNormalizado(asuntoDeDescripcion(t.description) ?? '') === buscado
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

/**
 * Los pendientes que pueden recibir un correo: los registrados de la cuenta
 * que nadie ha borrado. Los hechos se quedan: una respuesta a algo cerrado
 * vale la pena verla, y el que lo abre decide si lo reabre.
 */
export function candidatosDeRelacion(
  registrados: readonly TaskItem[],
  anotaciones: Anotaciones
): TaskItem[] {
  return registrados.filter((t) => !anotaciones[t.id]?.eliminado);
}

/** Los abiertos, mas recientes primero, como los ve el modelo. */
export function abiertosParaModelo(
  candidatos: readonly TaskItem[],
  anotaciones: Anotaciones,
  remitenteDe: (t: TaskItem) => string | undefined,
  maximo = 40
): PendienteAbierto[] {
  return candidatos
    .filter((t) => {
      const nota = anotaciones[t.id];
      const estado = nota?.hecho ? 'hecho' : (nota?.estado ?? t.status);
      return estado !== 'hecho';
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, maximo)
    .map((t) => ({
      id: t.id,
      titulo: t.title.slice(0, 80),
      remitente: remitenteDe(t)
    }));
}

/** Lo que se anota de un correo relacionado. */
export interface CorreoRelacionado {
  /** La clave del correo, para no anotarlo dos veces. */
  clave: string;
  resumen: string;
  remitente: string;
  asunto: string;
  at: string;
}

const CORREOS_RECORDADOS = 50;

/**
 * Pone el correo como nota en el pendiente y lo deja con novedad. El mismo
 * correo no se anota dos veces. Si el pendiente estaba hecho se queda hecho:
 * quien lo abra decide.
 */
export function agregarNovedad(
  nota: Anotacion | undefined,
  correo: CorreoRelacionado
): Anotacion {
  const base: Anotacion = nota ?? { comentarios: [], actualizadoEn: '' };
  if (base.correosAnotados?.includes(correo.clave)) {
    return base;
  }
  const resumen = correo.resumen.trim();
  return conEvento(
    {
      ...base,
      comentarios: [
        ...base.comentarios,
        {
          text: `${resumen}\n— ${correo.remitente}, ${correo.asunto}`,
          at: correo.at,
          by: 'Correo'
        }
      ],
      novedad: { at: correo.at, text: resumen },
      correosAnotados: [...(base.correosAnotados ?? []), correo.clave].slice(
        -CORREOS_RECORDADOS
      ),
      actualizadoEn: correo.at
    },
    {
      at: correo.at,
      by: 'Correo',
      kind: 'comentario',
      text: `Correo nuevo: ${resumen}`
    }
  );
}

/** Alguien abrio el pendiente: la novedad ya se vio. */
export function marcarVisto(
  nota: Anotacion | undefined
): Anotacion | undefined {
  if (!nota?.novedad) {
    return nota;
  }
  const { novedad: _vista, ...resto } = nota;
  return resto;
}
