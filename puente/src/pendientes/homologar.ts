import type { TaskItem } from '../nucleo/contrato.js';

/**
 * Homologacion de pendientes.
 *
 * El mismo correo llega a dos buzones (la factura va a Nexus y a Itech) y
 * el mismo aviso llega cada mes ("se requiere una accion para mantener su
 * suscripcion"). Sin esto, cada copia es un pendiente distinto y marcar uno
 * no quita los demas. Aqui se agrupan por remitente y asunto: se sirve solo
 * el mas reciente del grupo, con las demas cuentas en `alsoIn`, y una
 * anotacion (hecho, eliminado) se aplica a todo el grupo.
 *
 * Fuera del correo (Ops, propios, dictado, un bot que empuja dos veces)
 * pasa lo mismo si el titulo, el detalle, la empresa y el dia coinciden:
 * un id distinto no los hace dos pendientes.
 */

/** Lo que hace a dos pendientes el mismo asunto. */
export function claveDePendiente(t: TaskItem): string {
  if (t.origin === 'correo') {
    const de = /^De: (.+)$/m.exec(t.description ?? '')?.[1] ?? '';
    const correo = /<([^>]+)>/.exec(de)?.[1] ?? de;
    return `${normalizar(t.title)}|${correo.trim().toLowerCase()}`;
  }
  return [
    normalizar(t.title),
    normalizar(t.description ?? ''),
    normalizar(t.company ?? ''),
    (t.dueDate ?? '').slice(0, 10)
  ].join('|');
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

/** De un grupo de copias, el que se enseña: el abierto mas reciente. */
function elegirPrimario(grupo: readonly TaskItem[]): TaskItem {
  const unico = grupo[0];
  if (grupo.length === 1 && unico) {
    return unico;
  }
  const abiertos = grupo.filter((t) => t.status !== 'hecho');
  const candidatos = abiertos.length > 0 ? abiertos : grupo;
  return [...candidatos].sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)
  )[0] as TaskItem;
}

/**
 * Lista plana sin copias: el mismo titulo y detalle (o el mismo correo)
 * queda una sola vez, la abierta mas reciente.
 */
export function homologarLista(tareas: readonly TaskItem[]): TaskItem[] {
  const grupos = new Map<string, TaskItem[]>();
  const orden: string[] = [];
  for (const t of tareas) {
    const clave = claveDePendiente(t);
    if (!grupos.has(clave)) {
      orden.push(clave);
      grupos.set(clave, []);
    }
    grupos.get(clave)?.push(t);
  }
  return orden.map((clave) => elegirPrimario(grupos.get(clave) ?? []));
}

/**
 * Los ids de todos los pendientes del mismo grupo que `id`, incluido el.
 * Vale para correo (remitente + asunto) y para el resto (titulo + detalle).
 */
export function idsDelGrupo(id: string, todos: readonly TaskItem[]): string[] {
  const t = todos.find((x) => x.id === id);
  if (!t) {
    return [id];
  }
  const clave = claveDePendiente(t);
  return [
    ...new Set([
      id,
      ...todos.filter((x) => claveDePendiente(x) === clave).map((x) => x.id)
    ])
  ];
}

/**
 * De `nuevos`, solo los que no repiten un abierto que ya estaba (ni se
 * repiten entre ellos). Para Telegram, dictado y acuerdos.
 */
export function filtrarNuevosSinRepetir(
  existentes: readonly TaskItem[],
  nuevos: readonly TaskItem[]
): TaskItem[] {
  const ocupadas = new Set(
    existentes.filter((t) => t.status !== 'hecho').map(claveDePendiente)
  );
  const salida: TaskItem[] = [];
  for (const n of nuevos) {
    const clave = claveDePendiente(n);
    if (ocupadas.has(clave)) {
      continue;
    }
    ocupadas.add(clave);
    salida.push(n);
  }
  return salida;
}

/**
 * Si el emisor manda el mismo pendiente con otro id, se reusa el id que
 * ya teniamos para no acumular copias al mezclar por identificador.
 */
export function reusarIdsPorContenido(
  previos: readonly TaskItem[],
  nuevos: readonly TaskItem[]
): TaskItem[] {
  const porClave = new Map<string, string>();
  for (const p of previos) {
    if (p.status === 'hecho') {
      continue;
    }
    const clave = claveDePendiente(p);
    if (!porClave.has(clave)) {
      porClave.set(clave, p.id);
    }
  }
  return nuevos.map((n) => {
    const id = porClave.get(claveDePendiente(n));
    return id && id !== n.id ? { ...n, id } : n;
  });
}
