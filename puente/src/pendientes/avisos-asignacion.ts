import { asuntoNormalizado } from './relacionar.js';

/**
 * Registro de los correos de asignacion y seguimiento ya mandados, para no
 * repetirlos: el mismo correo (Paddle, una factura) llega a tres buzones,
 * cada buzon crea su pendiente y, sin esto, cada uno manda su aviso a la
 * misma persona. La clave es persona + titulo normalizado (sin RE:/RV:,
 * minusculas); vale 24 h y el registro se limpia a los 7 dias.
 */

/** clave → cuando se mando (ISO). */
export type RegistroAvisos = Record<string, string>;

const VENTANA_MS = 24 * 3_600_000;
const RETENCION_MS = 7 * 24 * 3_600_000;

/** La clave con que se reconoce "el mismo aviso a la misma persona". */
export function claveDeAviso(
  correo: string,
  titulo: string | undefined,
  id: string
): string {
  const asunto = asuntoNormalizado(titulo ?? '') || id;
  return `${correo.trim().toLowerCase()}|${asunto}`;
}

/** Ya se le mando este aviso a esa persona en las ultimas 24 h. */
export function yaAvisado(
  registro: RegistroAvisos,
  clave: string,
  ahora: Date = new Date()
): boolean {
  const cuando = registro[clave];
  if (!cuando) {
    return false;
  }
  const hace = ahora.getTime() - Date.parse(cuando);
  return Number.isFinite(hace) && hace >= 0 && hace < VENTANA_MS;
}

/** Anota el aviso y tira lo de mas de 7 dias. */
export function registrarAviso(
  registro: RegistroAvisos,
  clave: string,
  ahora: Date = new Date()
): RegistroAvisos {
  const limite = ahora.getTime() - RETENCION_MS;
  const vigente = Object.fromEntries(
    Object.entries(registro).filter(([, cuando]) => {
      const t = Date.parse(cuando);
      return Number.isFinite(t) && t >= limite;
    })
  );
  return { ...vigente, [clave]: ahora.toISOString() };
}
