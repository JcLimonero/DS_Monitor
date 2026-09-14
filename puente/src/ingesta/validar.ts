import { ErrorPuente } from '../nucleo/errores.js';
import type { ModoIngesta, SobreIngesta, TipoIngesta } from './modelos.js';

/**
 * Validacion de lo que llega.
 *
 * A mano y sin dependencias, por la misma razon que el resto del puente: son
 * siete formas conocidas y el codigo cabe aqui.
 *
 * Los mensajes nombran el campo y el renglon exacto. Quien esta integrando un
 * envio necesita saber que "el dato 3 no trae titulo", no que "la peticion es
 * invalida".
 */

export class ErrorIngesta extends ErrorPuente {
  constructor(mensaje: string) {
    super(mensaje, 400);
    this.name = 'ErrorIngesta';
  }
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/** Una fecha ISO valida, o `undefined` si no viene. Lanza si viene mal. */
export function fechaOpcional(
  valor: unknown,
  donde: string
): string | undefined {
  if (valor === undefined || valor === null || valor === '') {
    return undefined;
  }
  if (typeof valor !== 'string') {
    throw new ErrorIngesta(`${donde} debe ser una fecha en texto ISO`);
  }
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) {
    throw new ErrorIngesta(`${donde} no es una fecha válida: "${valor}"`);
  }
  return fecha.toISOString();
}

export function fechaObligatoria(valor: unknown, donde: string): string {
  const fecha = fechaOpcional(valor, donde);
  if (fecha === undefined) {
    throw new ErrorIngesta(`${donde} es obligatorio`);
  }
  return fecha;
}

export function textoObligatorio(valor: unknown, donde: string): string {
  if (typeof valor !== 'string' || valor.trim() === '') {
    throw new ErrorIngesta(`${donde} es obligatorio y debe ser texto`);
  }
  return valor.trim();
}

export function textoOpcional(
  valor: unknown,
  donde: string
): string | undefined {
  if (valor === undefined || valor === null || valor === '') {
    return undefined;
  }
  if (typeof valor !== 'string') {
    throw new ErrorIngesta(`${donde} debe ser texto`);
  }
  return valor.trim();
}

export function numeroOpcional(
  valor: unknown,
  donde: string
): number | undefined {
  if (valor === undefined || valor === null) {
    return undefined;
  }
  if (typeof valor !== 'number' || !Number.isFinite(valor)) {
    throw new ErrorIngesta(`${donde} debe ser un número`);
  }
  return valor;
}

export function numeroObligatorio(valor: unknown, donde: string): number {
  const numero = numeroOpcional(valor, donde);
  if (numero === undefined) {
    throw new ErrorIngesta(`${donde} es obligatorio`);
  }
  return numero;
}

export function booleanoOpcional(
  valor: unknown,
  donde: string
): boolean | undefined {
  if (valor === undefined || valor === null) {
    return undefined;
  }
  if (typeof valor !== 'boolean') {
    throw new ErrorIngesta(`${donde} debe ser true o false`);
  }
  return valor;
}

/**
 * Acepta solo uno de los valores permitidos.
 *
 * Un valor fuera de la lista no se "corrige" en silencio a uno por omision: si
 * alguien manda `estado: "terminado"` creyendo que existe, mas vale que el
 * envio falle a que el pendiente aparezca como pendiente para siempre.
 */
export function opcionOpcional<T extends string>(
  valor: unknown,
  permitidos: readonly T[],
  donde: string
): T | undefined {
  if (valor === undefined || valor === null || valor === '') {
    return undefined;
  }
  if (typeof valor !== 'string' || !permitidos.includes(valor as T)) {
    throw new ErrorIngesta(
      `${donde} debe ser uno de: ${permitidos.join(', ')}. Llegó "${String(valor)}"`
    );
  }
  return valor as T;
}

export function listaDeObjetos(
  valor: unknown,
  donde: string
): Record<string, unknown>[] {
  if (!Array.isArray(valor)) {
    throw new ErrorIngesta(`${donde} debe ser una lista`);
  }
  return valor.map((elemento, indice) => {
    if (!esObjeto(elemento)) {
      throw new ErrorIngesta(`${donde}[${indice}] debe ser un objeto`);
    }
    return elemento;
  });
}

const MODOS: ModoIngesta[] = ['reemplazar', 'agregar'];

/** Revisa el sobre y devuelve sus campos ya normalizados. */
export function validarSobre(
  cuerpo: unknown,
  tipo: TipoIngesta
): { modo: ModoIngesta; generadoEn: string; datos: unknown } {
  if (!esObjeto(cuerpo)) {
    throw new ErrorIngesta('El cuerpo debe ser un objeto JSON');
  }

  const sobre = cuerpo as unknown as SobreIngesta<unknown>;

  if (sobre.version !== 1) {
    throw new ErrorIngesta(
      `Se esperaba "version": 1 y llegó ${JSON.stringify(sobre.version ?? null)}`
    );
  }

  if (sobre.datos === undefined) {
    throw new ErrorIngesta(
      `Falta "datos" con el contenido del envío de tipo "${tipo}"`
    );
  }

  return {
    modo: opcionOpcional(sobre.modo, MODOS, '"modo"') ?? 'reemplazar',
    generadoEn:
      fechaOpcional(sobre.generadoEn, '"generadoEn"') ??
      new Date().toISOString(),
    datos: sobre.datos
  };
}
