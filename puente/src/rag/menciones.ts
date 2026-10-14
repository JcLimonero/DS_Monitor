import { normalizarTexto } from '../proveedores/fireflies.js';

/**
 * Si la pregunta nombra a un solo cliente del catalogo, ese nombre se vuelve
 * filtro duro. Con dos coincidencias no se adivina.
 */
export function clienteMencionado(
  pregunta: string,
  nombres: readonly string[]
): string | undefined {
  const plano = normalizarTexto(pregunta);
  if (!plano) {
    return undefined;
  }
  const hits: string[] = [];
  const vistos = new Set<string>();
  for (const nombre of nombres) {
    const clave = normalizarTexto(nombre);
    if (clave.length < 4 || vistos.has(clave)) {
      continue;
    }
    const patron = new RegExp(`(?:^| )${escapar(clave)}(?: |$)`);
    if (!patron.test(plano)) {
      continue;
    }
    vistos.add(clave);
    hits.push(nombre.trim());
  }
  return hits.length === 1 ? hits[0] : undefined;
}

function escapar(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
