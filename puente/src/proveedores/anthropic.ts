import type { ConfiguracionAnthropic } from '../config/entorno.js';
import type { LicenseUsage } from '../nucleo/contrato.js';
import { conParametros, pedirJson } from '../nucleo/http.js';

/**
 * Consumo y costo de Claude.
 *
 * Dos endpoints de la Admin API, ninguno de los dos en los SDK: van por HTTP
 * crudo con `x-api-key` y `anthropic-version`.
 *
 *   GET /v1/organizations/usage_report/messages  -> tokens por cubeta de tiempo
 *   GET /v1/organizations/cost_report            -> gasto en USD, solo diario
 *
 * Hace falta una Admin API key (`sk-ant-admin...`); una llave normal de API no
 * sirve en estos endpoints.
 */

const BASE = 'https://api.anthropic.com/v1/organizations';
const VERSION = '2023-06-01';

/** El costo viene como cadena decimal en centavos de dolar. */
interface RespuestaCosto {
  data?: {
    results?: { amount?: string; currency?: string; description?: string }[];
  }[];
}

interface RespuestaUso {
  data?: {
    results?: {
      uncached_input_tokens?: number;
      cached_input_tokens?: number;
      cache_creation_input_tokens?: number;
      output_tokens?: number;
    }[];
  }[];
}

function encabezados(config: ConfiguracionAnthropic): Record<string, string> {
  return {
    'x-api-key': config.adminKey,
    'anthropic-version': VERSION
  };
}

/** Primer dia del mes en curso y primero del siguiente, en ISO. */
export function periodoDelMes(ahora = new Date()): {
  inicio: string;
  fin: string;
} {
  const inicio = new Date(
    Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1)
  );
  const fin = new Date(
    Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() + 1, 1)
  );
  return { inicio: inicio.toISOString(), fin: fin.toISOString() };
}

/**
 * Suma los tokens de todas las cubetas.
 *
 * Se cuentan las cuatro clases por separado porque asi las reporta la API, pero
 * para la tarjeta de licencia lo que importa es el total movido.
 */
export function sumarTokens(respuesta: RespuestaUso): number {
  let total = 0;
  for (const cubeta of respuesta.data ?? []) {
    for (const fila of cubeta.results ?? []) {
      total +=
        (fila.uncached_input_tokens ?? 0) +
        (fila.cached_input_tokens ?? 0) +
        (fila.cache_creation_input_tokens ?? 0) +
        (fila.output_tokens ?? 0);
    }
  }
  return total;
}

/**
 * Suma el costo del periodo.
 *
 * Los importes llegan como cadenas decimales en centavos, asi que se dividen
 * entre cien; sumarlos como vienen daria una cifra cien veces mas grande.
 */
export function sumarCosto(respuesta: RespuestaCosto): {
  total: number;
  moneda: string;
} {
  let centavos = 0;
  let moneda = 'USD';
  for (const cubeta of respuesta.data ?? []) {
    for (const fila of cubeta.results ?? []) {
      centavos += Number(fila.amount ?? '0') || 0;
      if (fila.currency) {
        moneda = fila.currency.toUpperCase();
      }
    }
  }
  return { total: Math.round(centavos) / 100, moneda };
}

export async function licenciasAnthropic(
  config: ConfiguracionAnthropic,
  ahora = new Date()
): Promise<LicenseUsage[]> {
  const { inicio, fin } = periodoDelMes(ahora);

  // Las dos consultas son independientes; en serie solo se sumarian latencias.
  const [uso, costo] = await Promise.all([
    pedirJson<RespuestaUso>(
      'Claude',
      conParametros(`${BASE}/usage_report/messages`, {
        starting_at: inicio,
        ending_at: fin,
        bucket_width: '1d',
        // El maximo de cubetas diarias es 31, justo un mes.
        limit: '31'
      }),
      { encabezados: encabezados(config) }
    ),
    pedirJson<RespuestaCosto>(
      'Claude',
      conParametros(`${BASE}/cost_report`, {
        starting_at: inicio,
        ending_at: fin
      }),
      { encabezados: encabezados(config) }
    )
  ]);

  const tokens = sumarTokens(uso);
  const gasto = sumarCosto(costo);
  const actualizado = ahora.toISOString();

  const licencias: LicenseUsage[] = [
    {
      id: 'claude-api',
      provider: 'anthropic',
      product: 'Claude API',
      plan: 'Organización',
      unit: 'tokens',
      used: tokens,
      // El consumo de la API se cobra por token: no hay cupo contratado.
      limit: undefined,
      periodStart: inicio,
      periodEnd: fin,
      cost: gasto.total,
      currency: gasto.moneda,
      manual: false,
      members: [],
      accountId: config.accountId,
      url: 'https://platform.claude.com/cost',
      updatedAt: actualizado
    }
  ];

  // Los asientos de Claude Code no salen de la API de uso, asi que solo se
  // publican si alguien los capturo en el entorno.
  if (config.asientosContratados !== undefined) {
    licencias.push({
      id: 'claude-code',
      provider: 'anthropic',
      product: 'Claude Code',
      plan: `Equipo · ${config.asientosContratados} asientos`,
      unit: 'asientos',
      used: config.asientosContratados,
      limit: config.asientosContratados,
      periodStart: inicio,
      periodEnd: fin,
      cost: config.costoAsientos,
      currency: 'USD',
      renewsAt: config.renuevaEn,
      manual: true,
      members: [],
      accountId: config.accountId,
      url: 'https://platform.claude.com/usage',
      updatedAt: actualizado
    });
  }

  return licencias;
}
