import type { Person, TaskStatus } from '../nucleo/contrato.js';
import { type Anotacion, conEvento, mismaPersona } from './anotaciones.js';

/**
 * Pedir una actualizacion de un pendiente ajeno: desde la tarjeta, quien esta
 * en sesion le escribe al responsable (con copia a quienes dan seguimiento)
 * con la liga personal de cada quien. Cuando alguno contesta desde su liga,
 * el pendiente queda con una novedad para que el dueño revise lo que dijo.
 */

/** No se vuelve a pedir lo mismo antes de este tiempo. */
export const SOLICITUD_REPETIDA_MS = 2 * 3600_000;

const ESTADO: Record<TaskStatus, string> = {
  pendiente: 'Pendiente',
  en_progreso: 'En progreso',
  bloqueado: 'Bloqueado',
  hecho: 'Hecho'
};

export interface DestinatariosSolicitud {
  /** Destinatario: el responsable; sin el (o si es quien pide), el primero que siga. */
  para?: Person;
  /** Con copia: los demas involucrados con correo. */
  cc: Person[];
  /** Por que no hay a quien pedirle. */
  motivo?: 'nadie' | 'eres-tu' | 'sin-correo';
}

/**
 * A quien se le pide. Se excluye a quien pide (uno no se pide a si mismo):
 * si el pendiente es suyo y nadie mas sigue, no hay a quien.
 */
export function destinatariosSolicitud(entrada: {
  principal?: Person;
  seguidores?: readonly Person[];
  /** Correos de quien pide (la sesion y los buzones del dueño). */
  propios: readonly string[];
}): DestinatariosSolicitud {
  const propios = new Set(entrada.propios.map((c) => c.trim().toLowerCase()));
  const esPropio = (p: Person) =>
    !!p.email && propios.has(p.email.trim().toLowerCase());
  const involucrados: Person[] = [];
  for (const p of [entrada.principal, ...(entrada.seguidores ?? [])]) {
    if (p && !involucrados.some((q) => mismaPersona(q, p))) {
      involucrados.push(p);
    }
  }
  if (involucrados.length === 0) {
    return { cc: [], motivo: 'nadie' };
  }
  const ajenos = involucrados.filter((p) => !esPropio(p));
  if (ajenos.length === 0) {
    return { cc: [], motivo: 'eres-tu' };
  }
  const conCorreo = ajenos.filter((p) => !!p.email);
  if (conCorreo.length === 0) {
    return { cc: [], motivo: 'sin-correo' };
  }
  const [para, ...cc] = conCorreo;
  return { para, cc };
}

/** El mensaje de error del portal cuando no hay a quien pedirle. */
export function motivoSinDestinatario(
  motivo: NonNullable<DestinatariosSolicitud['motivo']>
): string {
  switch (motivo) {
    case 'eres-tu':
      return 'Es tuyo; no hay a quién pedirle.';
    case 'sin-correo':
      return 'Los responsables no tienen correo en el equipo; no hay a quién escribirle.';
    default:
      return 'No tiene responsable ni nadie que le dé seguimiento.';
  }
}

/**
 * Minutos desde la ultima solicitud si todavia no pasan las dos horas;
 * si ya se puede volver a pedir, nada.
 */
export function solicitudReciente(
  nota: Anotacion | undefined,
  ahora: Date
): number | undefined {
  const previa = nota?.solicitudActualizacion?.at;
  if (!previa) {
    return undefined;
  }
  const hace = ahora.getTime() - Date.parse(previa);
  if (Number.isNaN(hace) || hace < 0 || hace >= SOLICITUD_REPETIDA_MS) {
    return undefined;
  }
  return Math.max(1, Math.round(hace / 60_000));
}

/** "Solicitó actualización a Ana (cc Beto, Carla)". */
export function textoEventoSolicitud(
  para: Person,
  cc: readonly Person[]
): string {
  return cc.length > 0
    ? `Solicitó actualización a ${para.name} (cc ${cc.map((p) => p.name).join(', ')})`
    : `Solicitó actualización a ${para.name}`;
}

/** Deja la solicitud en la nota, con su movimiento en el historial. */
export function conSolicitud(
  nota: Anotacion,
  entrada: { para: Person; cc: readonly Person[]; por: string; ahora: string }
): Anotacion {
  const a = [entrada.para, ...entrada.cc]
    .map((p) => p.email)
    .filter((c): c is string => !!c);
  return conEvento(
    {
      ...nota,
      solicitudActualizacion: { at: entrada.ahora, por: entrada.por, a },
      actualizadoEn: entrada.ahora
    },
    {
      at: entrada.ahora,
      by: entrada.por,
      kind: 'solicitud',
      text: textoEventoSolicitud(entrada.para, entrada.cc)
    }
  );
}

/**
 * Lo que dice la novedad cuando alguien del equipo contesta desde su liga:
 * su comentario o el estado al que lo cambio. Si habia solicitud, se nota.
 */
export function textoNovedadRespuesta(entrada: {
  nombre: string;
  comentario?: string;
  estado?: TaskStatus;
  respondeSolicitud: boolean;
}): string {
  const comentario = entrada.comentario?.trim();
  const que = comentario
    ? comentario.slice(0, 200)
    : entrada.estado
      ? `cambió a ${ESTADO[entrada.estado]}`
      : 'actualizó el pendiente';
  const linea = `${entrada.nombre}: ${que}`;
  return entrada.respondeSolicitud
    ? `Respondió a tu solicitud: ${linea}`
    : linea;
}

/**
 * Alguien del equipo (no el dueño) contesto desde su liga: el pendiente
 * queda con novedad para que el dueño la revise y, si habia solicitud de
 * actualizacion, se da por contestada. Sin comentario ni estado, nada.
 */
export function conRespuesta(
  nota: Anotacion,
  entrada: {
    persona: Person;
    comentario?: string;
    estado?: TaskStatus;
    ahora: string;
  }
): Anotacion {
  const comentario = entrada.comentario?.trim();
  if (!comentario && !entrada.estado) {
    return nota;
  }
  const { solicitudActualizacion, ...resto } = nota;
  const novedad = {
    at: entrada.ahora,
    kind: 'respuesta' as const,
    text: textoNovedadRespuesta({
      nombre: entrada.persona.name,
      comentario,
      estado: entrada.estado,
      respondeSolicitud: !!solicitudActualizacion
    })
  };
  const conNovedad: Anotacion = {
    ...resto,
    novedad,
    actualizadoEn: entrada.ahora
  };
  return solicitudActualizacion
    ? conEvento(conNovedad, {
        at: entrada.ahora,
        by: entrada.persona.name,
        kind: 'solicitud',
        text: 'Respondió a la solicitud de actualización'
      })
    : conNovedad;
}
