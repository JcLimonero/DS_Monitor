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
  /** Cuándo alguien confirmó que ya se renovó (ISO). */
  renewedAt?: string;
  /** Correo de quien confirmó la renovación. */
  renewalConfirmedBy?: string;
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

/** Cada cuánto se paga una licencia capturada a mano. */
export type ManualLicensePeriod = 'mensual' | 'anual' | 'otro';

/** Una licencia capturada a mano: vive en el puente, compartida por todos. */
export interface ManualLicense extends LicenseUsage {
  manual: true;
  period: ManualLicensePeriod;
  notes?: string;
}

/** Una confirmación de renovación, para el historial de la licencia. */
export interface LicenseRenewal {
  /** Cuándo se confirmó (ISO). */
  at: string;
  /** Correo de quien la confirmó. */
  by: string;
  cost?: number;
  currency?: string;
  /** La fecha de la siguiente renovación que quedó. */
  renewsAt?: string;
  note?: string;
}

/**
 * Lo que se corrige o confirma de una licencia (de una fuente o manual) y
 * queda en el puente, encima de lo que mande el proveedor.
 */
export interface LicenseAdjustment {
  cost?: number;
  currency?: string;
  plan?: string;
  renewsAt?: string;
  /** True para sacarla del tablero sin borrarla de la fuente. */
  hidden?: boolean;
  renewedAt?: string;
  confirmedBy?: string;
  /** Las últimas confirmaciones; la más reciente al final (máximo 24). */
  history: LicenseRenewal[];
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
