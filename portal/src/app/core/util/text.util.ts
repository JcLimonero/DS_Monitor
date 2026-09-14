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
