import type { Person, SenderKind, TaskItem } from '../nucleo/contrato.js';

/**
 * De quien viene un pendiente de correo.
 *
 * "Equipo" es alguien de las empresas propias: un correo de un dominio
 * nuestro o de alguien del equipo. "Empresa" es un proveedor o un cliente:
 * un remitente automatico (no-reply, facturas, avisos) o cualquier dominio
 * ajeno reconocible. Lo que no cae en ninguna queda "por identificar" para
 * que alguien lo acomode a mano.
 */
export const DOMINIOS_PROPIOS = [
  'nexusqtech.com',
  'itechdev.com.mx',
  'dealersolutions.com.mx',
  'operativai.com.mx'
];

const AUTOMATICO =
  /no-?reply|noreply|donotreply|notifications?@|billing|invoice|factur|receipt|recibo|support@|soporte@|help@|info@|ventas@|sales@|marketing@|newsletter|team@|hello@|hola@/i;

export function correoDelRemitente(
  descripcion: string | undefined
): string | undefined {
  const de = /^De: (.+)$/m.exec(descripcion ?? '')?.[1] ?? '';
  const correo = /<([^>]+)>/.exec(de)?.[1] ?? (de.includes('@') ? de : '');
  return correo.trim().toLowerCase() || undefined;
}

export function clasificarRemitente(
  tarea: TaskItem,
  equipo: readonly Person[],
  dominiosPropios: readonly string[] = DOMINIOS_PROPIOS
): SenderKind | undefined {
  if (tarea.origin !== 'correo') {
    return undefined;
  }
  // Las etiquetas de regla (licencia, dominio, renovacion…) son de proveedor,
  // venga el correo con direccion o solo con nombre.
  const porRegla = tarea.tags.some((t) => t !== 'correo' && t !== 'ia');
  const correo = correoDelRemitente(tarea.description);
  if (!correo) {
    return porRegla ? 'empresa' : 'por_identificar';
  }
  const dominio = correo.split('@')[1] ?? '';
  if (
    equipo.some((p) => p.email?.toLowerCase() === correo) ||
    dominiosPropios.some((d) => dominio === d || dominio.endsWith(`.${d}`))
  ) {
    return 'equipo';
  }
  if (AUTOMATICO.test(correo) || porRegla) {
    return 'empresa';
  }
  // Un dominio de empresa (no un correo personal) cuenta como empresa; los
  // gratuitos no dicen nada.
  const gratuito =
    /^(gmail|hotmail|outlook|live|yahoo|icloud|me|proton|protonmail)\./i.test(
      dominio
    );
  return gratuito ? 'por_identificar' : 'empresa';
}

export function conRemitente(
  tareas: TaskItem[],
  equipo: readonly Person[]
): TaskItem[] {
  return tareas.map((t) =>
    t.origin === 'correo' && !t.senderKind
      ? { ...t, senderKind: clasificarRemitente(t, equipo) }
      : t
  );
}
