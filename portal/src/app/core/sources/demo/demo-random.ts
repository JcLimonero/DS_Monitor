/**
 * Generador seudoaleatorio con semilla.
 *
 * La demo necesita historiales de monitoreo que se vean vivos pero que no
 * cambien en cada refresco; con `Math.random` la gráfica bailaría sola. Con
 * semilla fija, cada destino siempre dibuja la misma curva.
 */
export function seededRandom(seed: string): () => number {
  // Hash de 32 bits estilo FNV-1a, para convertir el identificador en semilla.
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  let state = hash >>> 0;
  return () => {
    // xorshift32
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

/** Entero en [min, max], ambos incluidos. */
export function randomInt(
  next: () => number,
  min: number,
  max: number
): number {
  return min + Math.floor(next() * (max - min + 1));
}
