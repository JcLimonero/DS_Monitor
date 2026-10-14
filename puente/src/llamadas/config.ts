import type { ResumenArchivado } from './servicio.js';

/** Como se llama la carpeta que crea la aplicacion en el Drive de la cuenta. */
export const CARPETA_POR_OMISION = 'DS Monitor · Transcripciones';

/** Lo que se ajusta desde el modulo Llamadas. */
export interface ConfigLlamadas {
  carpetaNombre: string;
  /** Se guarda al crear la carpeta; si desaparece, se vuelve a buscar por nombre. */
  carpetaId?: string;
  /**
   * Apagado: el puente ya no borra transcripciones. Lo hace una rutina
   * externa despues de guardarlas en Drive. Se conserva el campo para no
   * romper el documento guardado.
   */
  borrarDeFireflies: boolean;
  /** El buzon de Google a usar para Drive; sin valor, el primero conectado. */
  cuenta?: string;
}

export const CONFIG_LLAMADAS_POR_OMISION: ConfigLlamadas = {
  carpetaNombre: CARPETA_POR_OMISION,
  borrarDeFireflies: false
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
  // El puente no borra Fireflies: un true guardado o mandado no se honra.
  salida.borrarDeFireflies = false;
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
