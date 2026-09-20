/**
 * "1 junta" / "3 juntas".
 *
 * Existe para no escribir "empalme(s) detectado(s)" en la interfaz: el número
 * ya se sabe al momento de armar el texto, así que no hay razón para dejarle el
 * trabajo al lector.
 */
export function plural(count: number, singular: string, many?: string): string {
  return `${count} ${count === 1 ? singular : (many ?? `${singular}s`)}`;
}

/**
 * Prefijos de respuesta y reenvío que el correo va acumulando en el asunto
 * ("RE: RE: Fwd: ..."). Se quitan solo al mostrar; lo guardado no se toca.
 */
const PREFIJOS_CORREO = /^(?:\s*(?:re|rv|fw|fwd|enc)\s*:)+\s*/i;

/** "RE: RV: Fwd: Corte de mayo" -> "Corte de mayo". */
export function sinPrefijosDeCorreo(texto: string): string {
  const limpio = texto.replace(PREFIJOS_CORREO, '').trim();
  return limpio || texto;
}
