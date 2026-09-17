import type { TaskItem } from '../nucleo/contrato.js';

/**
 * Homologacion de pendientes que salen del correo.
 *
 * El mismo correo llega a dos buzones (la factura va a Nexus y a Itech) y
 * el mismo aviso llega cada mes ("se requiere una accion para mantener su
 * suscripcion"). Sin esto, cada copia es un pendiente distinto y marcar uno
 * no quita los demas. Aqui se agrupan por remitente y asunto: se sirve solo
 * el mas reciente del grupo, con las demas cuentas en `alsoIn`, y una
 * anotacion (hecho, eliminado) se aplica a todo el grupo.
 */

/** Lo que hace a dos pendientes de correo el mismo asunto: remitente + titulo. */
export function claveDePendiente(t: TaskItem): string {
  const de = /^De: (.+)$/m.exec(t.description ?? '')?.[1] ?? '';
  const correo = /<([^>]+)>/.exec(de)?.[1] ?? de;
  return `${normalizar(t.title)}|${correo.trim().toLowerCase()}`;
}

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\d+/g, '#')
    .replace(/[^a-z#]+/g, ' ')
    .trim();
}

/**
 * Por cuenta, los pendientes que se sirven: de cada grupo (mismo remitente y
 * asunto) solo el mas reciente; si el mas reciente llego el mismo dia a
 * varias cuentas, se sirve en la primera (por id) con las demas en `alsoIn`.
 */
export function homologarPendientes(
  porCuenta: Record<string, TaskItem[]>
): Record<string, TaskItem[]> {
  const grupos = new Map<string, TaskItem[]>();
  for (const cuenta of Object.keys(porCuenta).sort()) {
    for (const t of porCuenta[cuenta] ?? []) {
      if (t.origin !== 'correo') {
        continue;
      }
      const clave = claveDePendiente(t);
      grupos.set(clave, [...(grupos.get(clave) ?? []), t]);
    }
  }
  const primarios = new Map<string, TaskItem>();
  for (const [, grupo] of grupos) {
    const ordenado = [...grupo].sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) ||
        a.accountId.localeCompare(b.accountId)
    );
    const primario = ordenado[0] as TaskItem;
    const dia = primario.updatedAt.slice(0, 10);
    const copias = ordenado
      .slice(1)
      .filter(
        (t) =>
          t.updatedAt.slice(0, 10) === dia && t.accountId !== primario.accountId
      )
      .map((t) => t.accountId);
    primarios.set(primario.id, {
      ...primario,
      alsoIn: copias.length > 0 ? [...new Set(copias)] : undefined
    });
  }
  const salida: Record<string, TaskItem[]> = {};
  for (const [cuenta, lista] of Object.entries(porCuenta)) {
    salida[cuenta] = lista
      .map((t) => (t.origin === 'correo' ? primarios.get(t.id) : t))
      .filter((t): t is TaskItem => t !== undefined);
  }
  return salida;
}

/** Los ids de todos los pendientes del mismo grupo que `id`, incluido el. */
export function idsDelGrupo(id: string, todos: readonly TaskItem[]): string[] {
  const t = todos.find((x) => x.id === id);
  if (!t || t.origin !== 'correo') {
    return [id];
  }
  const clave = claveDePendiente(t);
  return [
    ...new Set([
      id,
      ...todos
        .filter((x) => x.origin === 'correo' && claveDePendiente(x) === clave)
        .map((x) => x.id)
    ])
  ];
}
