/**
 * El único validador de a dónde se vuelve después de entrar (`?volver=`).
 *
 * Ese valor viene de la URL y no es de fiar: solo se acepta una ruta de este
 * mismo origen. Cualquier otra cosa (otro sitio, `//otro`, `javascript:`,
 * espacios o caracteres de control) cae en la ruta por omisión.
 */
export const RUTA_POR_OMISION = '/hoy';

export function rutaInternaSegura(
  valor: string | null | undefined,
  porOmision: string = RUTA_POR_OMISION
): string {
  if (typeof valor !== 'string' || valor.length === 0 || valor.length > 2000) {
    return porOmision;
  }
  // Debe empezar con una sola diagonal; ninguna diagonal invertida; sin
  // caracteres de control ni espacios al inicio.
  if (
    !valor.startsWith('/') ||
    valor.startsWith('//') ||
    valor.includes('\\') ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f]/.test(valor)
  ) {
    return porOmision;
  }
  // La pantalla de acceso no es un destino.
  if (
    valor === '/acceso' ||
    valor.startsWith('/acceso?') ||
    valor.startsWith('/acceso/')
  ) {
    return porOmision;
  }
  // Y resuelta contra un origen cualquiera tiene que seguir en ese origen.
  try {
    if (
      new URL(valor, 'http://portal.invalid').origin !== 'http://portal.invalid'
    ) {
      return porOmision;
    }
  } catch {
    return porOmision;
  }
  return valor;
}
