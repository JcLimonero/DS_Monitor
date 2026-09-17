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

/**
 * Un tramo de `count` elementos que depende del identificador.
 *
 * Sirve para que varias cuentas del mismo tipo (los buzones de correo, por
 * ejemplo) no muestren en demostración exactamente los mismos datos: cada una
 * empieza en un punto distinto de la lista y toma los siguientes.
 */
export function sliceFor<T>(
  seed: string,
  items: readonly T[],
  count: number
): T[] {
  if (items.length === 0) {
    return [];
  }
  const start = Math.floor(seededRandom(seed)() * items.length);
  const take = Math.min(count, items.length);
  return Array.from(
    { length: take },
    (_, i) => items[(start + i) % items.length]
  );
}
