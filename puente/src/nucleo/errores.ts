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

/**
 * Google rechazo la llamada porque el permiso guardado no alcanza (la cuenta
 * se conecto antes de que se pidiera Drive): hay que volver a conectarla.
 */
export class ErrorReconectarGoogle extends ErrorProveedor {
  constructor(detalle?: string) {
    super(
      'google',
      `la cuenta no tiene permiso para Drive: reconecta Google en Integraciones → Correo (Conectar con Google)${detalle ? ` · ${detalle}` : ''}`,
      403
    );
    this.name = 'ErrorReconectarGoogle';
  }
}

/** Fireflies no deja borrar con esta cuenta o este plan. */
export class ErrorBorradoNoPermitido extends ErrorProveedor {
  constructor(detalle: string) {
    super(
      'fireflies',
      `no permite borrar la transcripción con esta API key (${detalle}); se queda en Fireflies y el Doc ya está en Drive`,
      403
    );
    this.name = 'ErrorBorradoNoPermitido';
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
