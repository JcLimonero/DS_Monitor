import type { Person } from '../nucleo/contrato.js';
import { mismaPersona } from './anotaciones.js';

/**
 * Responsable principal y quienes dan seguimiento, fijados de una vez desde
 * el portal (Mio, el selector o "Varios..."). Se manda un solo correo: el
 * principal de destinatario y los demas con copia. Si quien asigna se lo
 * pone a si mismo y no hay nadie mas, no hay a quien avisar.
 */

export interface Responsables {
  principal?: Person;
  seguidores: Person[];
}

export interface DecisionAviso {
  enviar: boolean;
  /** Destinatario: el principal; sin principal con correo, el primero que siga. */
  para?: Person;
  /** Con copia: los que dan seguimiento y tienen correo. */
  cc: Person[];
  /** Por que no se manda (para el aviso del portal y la bitacora). */
  motivo?: 'sin-cambios' | 'eres-tu' | 'sin-correo' | 'nadie';
}

/** Mismo principal y mismos seguidores (sin importar el orden ni mayusculas). */
export function mismosResponsables(a: Responsables, b: Responsables): boolean {
  const mismoPrincipal =
    (!a.principal && !b.principal) ||
    (!!a.principal && !!b.principal && mismaPersona(a.principal, b.principal));
  if (!mismoPrincipal || a.seguidores.length !== b.seguidores.length) {
    return false;
  }
  return a.seguidores.every((p) =>
    b.seguidores.some((q) => mismaPersona(p, q))
  );
}

/** Quita repetidos y al principal de la lista de seguimiento. */
export function depurarSeguidores(
  principal: Person | undefined,
  seguidores: readonly Person[]
): Person[] {
  const salida: Person[] = [];
  for (const p of seguidores) {
    if (principal && mismaPersona(principal, p)) {
      continue;
    }
    if (!salida.some((q) => mismaPersona(q, p))) {
      salida.push(p);
    }
  }
  return salida;
}

/**
 * Si se avisa, a quien y con copia a quienes.
 *
 * - Sin cambios respecto a lo que habia: no.
 * - El principal es quien esta en sesion y nadie mas: no (ya lo sabe).
 * - El principal es quien esta en sesion y hay seguidores: si, a el con
 *   copia a los demas (asi lo pidio: un solo correo con todos).
 * - Otro principal, con o sin seguidores: si, con copia a los que sigan.
 * - Sin principal pero con seguidores con correo: al primero, copia al resto.
 */
export function decidirAviso(entrada: {
  principal?: Person;
  seguidores: readonly Person[];
  sesionCorreo?: string;
  previo?: Responsables;
}): DecisionAviso {
  const seguidores = depurarSeguidores(entrada.principal, entrada.seguidores);
  const nuevo: Responsables = { principal: entrada.principal, seguidores };
  if (entrada.previo && mismosResponsables(nuevo, entrada.previo)) {
    return { enviar: false, cc: [], motivo: 'sin-cambios' };
  }
  const conCorreo = seguidores.filter((p) => !!p.email);
  const yo = entrada.sesionCorreo?.trim().toLowerCase();
  const principalSoyYo = !!yo && entrada.principal?.email?.toLowerCase() === yo;
  if (principalSoyYo && conCorreo.length === 0) {
    return {
      enviar: false,
      para: entrada.principal,
      cc: [],
      motivo: 'eres-tu'
    };
  }
  if (entrada.principal?.email) {
    return { enviar: true, para: entrada.principal, cc: conCorreo };
  }
  if (entrada.principal) {
    // Principal sin correo: se avisa a los que siguen, si los hay.
    if (conCorreo.length === 0) {
      return {
        enviar: false,
        para: entrada.principal,
        cc: [],
        motivo: 'sin-correo'
      };
    }
    return { enviar: true, para: conCorreo[0], cc: conCorreo.slice(1) };
  }
  if (conCorreo.length === 0) {
    return { enviar: false, cc: [], motivo: 'nadie' };
  }
  return { enviar: true, para: conCorreo[0], cc: conCorreo.slice(1) };
}

/** La linea de la trazabilidad: "Responsable: X · seguimiento: Y, Z". */
export function textoEventoResponsables(
  principal: Person | undefined,
  seguidores: readonly Person[]
): string {
  const quien = principal
    ? `Responsable: ${principal.name}`
    : 'Sin responsable';
  return seguidores.length > 0
    ? `${quien} · seguimiento: ${seguidores.map((p) => p.name).join(', ')}`
    : quien;
}

/** El aviso que ve quien asigno, segun lo que se decidio y lo que paso. */
export function textoAviso(
  decision: DecisionAviso,
  resultado: 'enviado' | 'sin-acceso' | { error: string }
): string {
  if (decision.motivo === 'sin-cambios') {
    return 'Sin cambios.';
  }
  if (decision.motivo === 'eres-tu') {
    return 'Asignado sin aviso: eres tú.';
  }
  if (decision.motivo === 'sin-correo') {
    return 'Asignado; esa persona no tiene correo en el equipo, no se le avisó.';
  }
  if (decision.motivo === 'nadie' || !decision.para?.email) {
    return 'Guardado; no hay a quién avisar.';
  }
  const copia =
    decision.cc.length > 0
      ? ` con copia a ${decision.cc.map((p) => p.email).join(', ')}`
      : '';
  if (resultado === 'enviado') {
    return `Se avisó a ${decision.para.email}${copia}.`;
  }
  if (resultado === 'sin-acceso') {
    return 'Guardado; para avisar por correo configura el acceso (EmailJS) en Equipo.';
  }
  return `Guardado, pero no se pudo mandar el correo: ${resultado.error}`;
}
