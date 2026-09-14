import { Person } from './common.model';

/** Proveedores cuyo consumo sigue el portal. */
export type LicenseProvider =
  'anthropic' | 'cursor' | 'figma' | 'vercel' | 'otro';

/**
 * Qué se está midiendo.
 *
 * No todos los proveedores cobran igual: Claude cobra por tokens, Cursor y
 * Figma por asiento, Vercel por consumo de la plataforma. La unidad viaja con
 * el dato para que la barra y el texto digan lo que de verdad se consumió.
 */
export type LicenseUnit = 'asientos' | 'tokens' | 'solicitudes' | 'dinero';

export const LICENSE_UNIT_LABEL: Record<LicenseUnit, string> = {
  asientos: 'asientos',
  tokens: 'tokens',
  solicitudes: 'solicitudes',
  dinero: 'gasto'
};

export const LICENSE_PROVIDER_LABEL: Record<LicenseProvider, string> = {
  anthropic: 'Claude',
  cursor: 'Cursor',
  figma: 'Figma',
  vercel: 'Vercel',
  otro: 'Otro'
};

/** Consumo de una persona dentro de la licencia. */
export interface LicenseMember {
  person: Person;
  /** Consumo en la unidad de la licencia. */
  used: number;
  /** False cuando ocupa asiento pero no lo usó en el periodo. */
  active: boolean;
}

export interface LicenseUsage {
  id: string;
  provider: LicenseProvider;
  /** Producto contratado, por ejemplo "Claude API" o "Cursor Business". */
  product: string;
  plan?: string;
  unit: LicenseUnit;
  used: number;
  /** Tope contratado. Sin tope significa pago por consumo. */
  limit?: number;
  /** Periodo que cubre la medición, en ISO. */
  periodStart: string;
  periodEnd: string;
  /** Gasto del periodo, cuando el proveedor lo expone. */
  cost?: number;
  currency?: string;
  renewsAt?: string;
  /**
   * True cuando el dato lo capturó una persona porque el proveedor no lo
   * expone. Figma es el caso: su API no publica facturación ni asientos
   * contratados, asi que el tope y el costo se escriben a mano.
   */
  manual: boolean;
  members: LicenseMember[];
  accountId: string;
  url?: string;
  updatedAt: string;
}

/** Porcentaje consumido, de 0 a 100. Sin tope siempre devuelve 0. */
export function usagePercent(license: LicenseUsage): number {
  if (!license.limit || license.limit <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((license.used / license.limit) * 1000) / 10);
}

/** A partir de aqui conviene avisar antes de que se acabe el tope. */
export const LICENSE_WARN_PERCENT = 80;
export const LICENSE_CRITICAL_PERCENT = 95;

export function isNearLimit(license: LicenseUsage): boolean {
  return !!license.limit && usagePercent(license) >= LICENSE_WARN_PERCENT;
}

/** Días que faltan para la renovación. Sin fecha devuelve `undefined`. */
export function daysToRenewal(
  license: LicenseUsage,
  now = new Date()
): number | undefined {
  if (!license.renewsAt) {
    return undefined;
  }
  const diff = new Date(license.renewsAt).getTime() - now.getTime();
  return Math.ceil(diff / 86_400_000);
}
