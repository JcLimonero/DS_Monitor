/**
 * Errores del puente.
 *
 * Cada uno lleva el codigo HTTP con el que sale y un mensaje pensado para que
 * quien lo lea en la pantalla de Ajustes del portal sepa que hacer, no solo que
 * algo fallo.
 */
export class ErrorPuente extends Error {
  constructor(
    override readonly message: string,
    readonly estado: number,
    /** Detalle tecnico para la bitacora; no viaja al portal. */
    readonly causa?: unknown
  ) {
    super(message);
    this.name = 'ErrorPuente';
  }
}

/** Falta una credencial o un identificador en el entorno. */
export class ErrorConfiguracion extends ErrorPuente {
  constructor(mensaje: string) {
    super(mensaje, 503);
    this.name = 'ErrorConfiguracion';
  }
}

/** El proveedor respondio, pero con un error. */
export class ErrorProveedor extends ErrorPuente {
  constructor(
    readonly proveedor: string,
    mensaje: string,
    estado = 502,
    causa?: unknown
  ) {
    super(`${proveedor}: ${mensaje}`, estado, causa);
    this.name = 'ErrorProveedor';
  }
}

export class ErrorNoEncontrado extends ErrorPuente {
  constructor(ruta: string) {
    super(`No hay nada en ${ruta}`, 404);
    this.name = 'ErrorNoEncontrado';
  }
}

export function describir(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
