/**
 * Fusion por rango reciproco (RRF). Cada lista aporta 1/(k+rango), con el
 * rango en 1. Un fragmento que sale en las dos listas queda arriba.
 */
export function fusionarRrf(
  listas: readonly (readonly { id: string }[])[],
  k = 60
): { id: string; puntuacion: number }[] {
  const puntajes = new Map<string, number>();
  for (const lista of listas) {
    lista.forEach((item, indice) => {
      const previo = puntajes.get(item.id) ?? 0;
      puntajes.set(item.id, previo + 1 / (k + indice + 1));
    });
  }
  return [...puntajes.entries()]
    .map(([id, puntuacion]) => ({ id, puntuacion }))
    .sort((a, b) => b.puntuacion - a.puntuacion || a.id.localeCompare(b.id));
}
