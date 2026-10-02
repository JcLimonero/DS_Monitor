import type { ResumenArchivado } from './servicio.js';

/** Como se llama la carpeta que crea la aplicacion en el Drive de la cuenta. */
export const CARPETA_POR_OMISION = 'DS Monitor · Transcripciones';

/** Lo que se ajusta desde el modulo Llamadas. */
export interface ConfigLlamadas {
  carpetaNombre: string;
  /** Se guarda al crear la carpeta; si desaparece, se vuelve a buscar por nombre. */
  carpetaId?: string;
  /** Borrar de Fireflies despues de verificar el Doc (irreversible). */
  borrarDeFireflies: boolean;
  /** El buzon de Google a usar para Drive; sin valor, el primero conectado. */
  cuenta?: string;
}

export const CONFIG_LLAMADAS_POR_OMISION: ConfigLlamadas = {
  carpetaNombre: CARPETA_POR_OMISION,
  borrarDeFireflies: true
};

/** La ultima corrida, para que el portal diga que paso. */
export interface EstadoLlamadas {
  ultima?: ResumenArchivado & { en: string };
}

/** Normaliza lo que llega del portal; lo invalido no pisa nada. */
export function limpiarConfigLlamadas(
  actual: ConfigLlamadas,
  cambios: unknown
): ConfigLlamadas {
  const c = (cambios ?? {}) as Record<string, unknown>;
  const salida = { ...CONFIG_LLAMADAS_POR_OMISION, ...actual };
  if (typeof c['borrarDeFireflies'] === 'boolean') {
    salida.borrarDeFireflies = c['borrarDeFireflies'];
  }
  if (typeof c['carpetaNombre'] === 'string' && c['carpetaNombre'].trim()) {
    const nombre = c['carpetaNombre'].trim().slice(0, 120);
    if (nombre !== salida.carpetaNombre) {
      salida.carpetaNombre = nombre;
      // Otra carpeta: el id guardado ya no corresponde.
      delete salida.carpetaId;
    }
  }
  return salida;
}
