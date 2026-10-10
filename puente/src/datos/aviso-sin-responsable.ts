/**
 * Aviso cuando hay tareas sin responsable por mas de 24 h.
 *
 * No se repite: cada tarea (pendiente, funcionalidad, hito o riesgo) se
 * avisa una sola vez. Si le ponen responsable, se olvida; si se lo quitan
 * y vuelven a pasar 24 h, se avisa de nuevo.
 */

export type TipoTareaSinResponsable =
  'pendiente' | 'funcionalidad' | 'hito' | 'riesgo';

export interface TareaSinResponsable {
  tipo: TipoTareaSinResponsable;
  id: string;
  titulo: string;
  /** Cuando se creo o se le quito el responsable. */
  desde: string;
}

export interface EstadoAvisoSinResponsable {
  /** Clave `tipo:id` -> ISO de cuando se aviso. */
  avisados: Record<string, string>;
}

export const HORAS_SIN_RESPONSABLE = 24;

export function claveTareaSinResponsable(
  tarea: Pick<TareaSinResponsable, 'tipo' | 'id'>
): string {
  return `${tarea.tipo}:${tarea.id}`;
}

/** Las que llevan mas de `horas` sin responsable. */
export function tareasViejasSinResponsable(
  tareas: TareaSinResponsable[],
  ahora: Date,
  horas = HORAS_SIN_RESPONSABLE
): TareaSinResponsable[] {
  const limite = ahora.getTime() - horas * 3_600_000;
  return tareas.filter((t) => {
    const desde = Date.parse(t.desde);
    return Number.isFinite(desde) && desde <= limite;
  });
}

/**
 * Limpia del registro las que ya tienen responsable (ya no estan en `actuales`)
 * para que, si se desasignan, el reloj de 24 h arranque de cero.
 */
export function limpiarAvisados(
  estado: EstadoAvisoSinResponsable,
  actuales: TareaSinResponsable[]
): EstadoAvisoSinResponsable {
  const vivas = new Set(actuales.map(claveTareaSinResponsable));
  const avisados: Record<string, string> = {};
  for (const [clave, en] of Object.entries(estado.avisados)) {
    if (vivas.has(clave)) {
      avisados[clave] = en;
    }
  }
  return { avisados };
}

/**
 * Decide si hay que avisar: solo las viejas que todavia no estan en `avisados`.
 * Si no hay nuevas, no se avisa (no se repite).
 */
export function avisoNuevoSinResponsable(
  viejas: TareaSinResponsable[],
  estado: EstadoAvisoSinResponsable,
  ahora: Date
): {
  aviso?: { titulo: string; texto: string; ids: string[] };
  estado: EstadoAvisoSinResponsable;
} {
  const nuevas = viejas.filter(
    (t) => !estado.avisados[claveTareaSinResponsable(t)]
  );
  if (nuevas.length === 0) {
    return { estado };
  }
  const avisados = { ...estado.avisados };
  const iso = ahora.toISOString();
  for (const t of nuevas) {
    avisados[claveTareaSinResponsable(t)] = iso;
  }
  const n = nuevas.length;
  const titulo =
    n === 1
      ? '1 tarea sin responsable desde hace más de 24 h'
      : `${n} tareas sin responsable desde hace más de 24 h`;
  const muestra = nuevas
    .slice(0, 5)
    .map((t) => t.titulo)
    .join(' · ');
  const resto = n > 5 ? ` y ${n - 5} más` : '';
  return {
    aviso: {
      titulo,
      texto: `${muestra}${resto}. Ábrelas en Pendientes o Desarrollo → Sin responsable.`,
      ids: nuevas.map(claveTareaSinResponsable)
    },
    estado: { avisados }
  };
}
