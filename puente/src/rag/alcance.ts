import { ErrorPuente } from '../nucleo/errores.js';
import {
  EMPRESA_ITECH,
  empresaIdDe,
  type EmpresaCatalogo
} from './empresas-rag.js';

/**
 * Quien pregunta y que puede ver.
 *
 * El director (y el token de admin) ve cualquier empresa, pero Itech no entra
 * en la mezcla si no la pide. Un token de consulta solo ve las empresas de su
 * lista; si la lista es unicamente Itech, esa es la consulta. Itech en el SQL
 * solo aparece cuando `excluyeItech` es false.
 */
export interface ActorRag {
  director: boolean;
  /** undefined: sin tope (director o usuario sin alcance). Lista: solo esas. */
  tope?: string[];
  /** Puede pedir Itech de forma explicita. */
  puedeItech: boolean;
}

export interface PedidoRag {
  empresa?: string;
  empresas?: string[];
  /** Atajo explicito, ademas de nombrar a Itech en `empresa`. */
  incluirItech?: boolean;
  cliente?: string;
  proyecto?: string;
  desde?: string;
  hasta?: string;
  k?: number;
  pregunta?: string;
}

export interface ClausulaEmpresa {
  /** Trozo SQL que empieza con AND, o vacio si no hay que filtrar. */
  sql: string;
  /** Parametro de la lista, si el SQL la usa. */
  empresas?: string[];
  /** Siempre true salvo peticion explicita y autorizada. */
  excluyeItech: boolean;
}

export function resolverEmpresas(
  pedido: PedidoRag,
  actor: ActorRag,
  catalogo: readonly EmpresaCatalogo[] = []
): ClausulaEmpresa {
  const pedidas = empresasPedidas(pedido, catalogo);
  const tope = actor.tope?.map((e) => empresaIdDe(e, catalogo) ?? e);
  const soloItech =
    !!tope && tope.length > 0 && tope.every((e) => e === EMPRESA_ITECH);
  const pidio =
    soloItech ||
    pedido.incluirItech === true ||
    pedidas.includes(EMPRESA_ITECH);
  if (pidio && !actor.puedeItech && !soloItech) {
    throw new ErrorPuente(
      'No tienes permiso para consultar las juntas de Itech Dev.',
      403
    );
  }
  if (soloItech && !actor.puedeItech) {
    throw new ErrorPuente(
      'No tienes permiso para consultar las juntas de Itech Dev.',
      403
    );
  }

  let lista: string[] | undefined;
  if (soloItech) {
    lista = [EMPRESA_ITECH];
  } else if (pedidas.length > 0) {
    lista = pedidas.filter((e) => pidio || e !== EMPRESA_ITECH);
    if (tope) {
      lista = lista.filter((e) => tope.includes(e));
    }
    if (lista.length === 0) {
      throw new ErrorPuente(
        'Esa empresa no está en las que puedes consultar.',
        403
      );
    }
  } else if (tope) {
    lista = tope.filter((e) => pidio || e !== EMPRESA_ITECH);
    if (lista.length === 0) {
      throw new ErrorPuente('No hay empresas en tu alcance.', 403);
    }
  }

  if (!pidio) {
    const exclusion = `$COL <> '${EMPRESA_ITECH}'`;
    if (lista) {
      return {
        sql: `AND $COL = ANY($EMP::text[]) AND ${exclusion}`,
        empresas: lista.filter((e) => e !== EMPRESA_ITECH),
        excluyeItech: true
      };
    }
    return { sql: `AND ${exclusion}`, excluyeItech: true };
  }

  if (lista) {
    return {
      sql: 'AND $COL = ANY($EMP::text[])',
      empresas: lista,
      excluyeItech: false
    };
  }
  return { sql: '', excluyeItech: false };
}

function empresasPedidas(
  pedido: PedidoRag,
  catalogo: readonly EmpresaCatalogo[]
): string[] {
  const crudas = [
    ...(pedido.empresa ? [pedido.empresa] : []),
    ...(pedido.empresas ?? [])
  ];
  const ids: string[] = [];
  for (const cruda of crudas) {
    const id = empresaIdDe(cruda, catalogo);
    if (!id) {
      throw new ErrorPuente(`No reconocí la empresa "${cruda.trim()}".`, 400);
    }
    if (!ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Sustituye $COL por la columna (con alias) y $EMP por el parametro de la
 * lista. La exclusion de Itech queda escrita en el SQL, no en el prompt.
 */
export function sqlEmpresas(
  clausula: ClausulaEmpresa,
  indice: number,
  columna = 'empresa'
): { sql: string; parametros: unknown[] } {
  if (!clausula.sql) {
    return { sql: '', parametros: [] };
  }
  const conColumna = clausula.sql.replaceAll('$COL', columna);
  if (!clausula.empresas) {
    return { sql: conColumna, parametros: [] };
  }
  return {
    sql: conColumna.replaceAll('$EMP', `$${indice}`),
    parametros: [clausula.empresas]
  };
}

export function kDe(pedido: PedidoRag): number {
  const k = pedido.k ?? 8;
  if (!Number.isInteger(k) || k < 1 || k > 20) {
    throw new ErrorPuente('k tiene que ser un entero entre 1 y 20.', 400);
  }
  return k;
}

export function fechaDePedido(
  valor: string | undefined,
  nombre: string
): string | undefined {
  if (!valor?.trim()) {
    return undefined;
  }
  const ms = Date.parse(valor.trim());
  if (Number.isNaN(ms)) {
    throw new ErrorPuente(`${nombre} no es una fecha.`, 400);
  }
  return new Date(ms).toISOString();
}
