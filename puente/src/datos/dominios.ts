import type { LicenseUsage } from '../nucleo/contrato.js';

/**
 * Los dominios registrados: donde estan, cuando vencen y cuanto cuesta
 * renovarlos. Se capturan desde Ajustes y viven en el puente, para que el
 * monitor de la oficina y la computadora vean lo mismo.
 *
 * Aparecen en el tablero de licencias como una licencia mas (anual, con su
 * fecha de renovacion), que es donde uno va a ver que se vence y cuanto se va
 * a pagar.
 */
export interface Dominio {
  /** El nombre, por ejemplo `dealersolutions.com.mx`. */
  nombre: string;
  /** Con quien esta registrado: Neubox, GoDaddy... */
  registrador?: string;
  /** Vence el, en ISO (solo la fecha importa). */
  venceEn: string;
  /** Cuanto cuesta renovarlo, en la moneda dada. */
  costo?: number;
  moneda?: string;
  /** Renovacion automatica activada con el registrador. */
  automatico?: boolean;
  notas?: string;
}

const DIA_MS = 86_400_000;

/** Un dominio bien formado, o el motivo por el que no. */
export function validarDominio(crudo: unknown, donde: string): Dominio {
  const d = (crudo ?? {}) as Record<string, unknown>;
  const nombre =
    typeof d['nombre'] === 'string' ? d['nombre'].trim().toLowerCase() : '';
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(nombre)) {
    throw new Error(`${donde}.nombre debe ser un dominio, recibió "${nombre}"`);
  }
  const venceEn = typeof d['venceEn'] === 'string' ? d['venceEn'] : '';
  if (Number.isNaN(Date.parse(venceEn))) {
    throw new Error(`${donde}.venceEn debe ser una fecha`);
  }
  const costo =
    d['costo'] === undefined || d['costo'] === null || d['costo'] === ''
      ? undefined
      : Number(d['costo']);
  if (costo !== undefined && !Number.isFinite(costo)) {
    throw new Error(`${donde}.costo debe ser un número`);
  }
  return {
    nombre,
    registrador: texto(d['registrador']),
    venceEn: new Date(venceEn).toISOString(),
    costo,
    moneda: texto(d['moneda'])?.toUpperCase(),
    automatico: d['automatico'] === true,
    notas: texto(d['notas'])
  };
}

function texto(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor.trim() !== ''
    ? valor.trim()
    : undefined;
}

/** Los dominios como licencias anuales, para el tablero. */
export function dominiosComoLicencias(
  dominios: Dominio[],
  accountId: string,
  ahora = new Date()
): LicenseUsage[] {
  return dominios.map((dominio) => {
    const vence = Date.parse(dominio.venceEn);
    return {
      id: `${accountId}-${dominio.nombre.replace(/[^a-z0-9]+/g, '-')}`,
      provider: 'otro',
      product: `Dominio ${dominio.nombre}`,
      plan: [
        dominio.registrador ?? 'dominio',
        'anual',
        dominio.automatico ? 'renovación automática' : undefined,
        vence < ahora.getTime() ? 'VENCIDO' : undefined
      ]
        .filter(Boolean)
        .join(' · '),
      unit: 'dinero',
      used: dominio.costo ?? 0,
      periodStart: new Date(vence - 366 * DIA_MS).toISOString(),
      periodEnd: dominio.venceEn,
      cost: dominio.costo,
      currency: dominio.moneda,
      renewsAt: dominio.venceEn,
      manual: true,
      members: [],
      accountId,
      updatedAt: ahora.toISOString()
    };
  });
}
