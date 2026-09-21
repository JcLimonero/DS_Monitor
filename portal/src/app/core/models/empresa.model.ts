/**
 * Una empresa del grupo, del catálogo que se edita en Integraciones →
 * Empresas. Mismo contrato que en puente/src/nucleo/contrato.ts.
 */
export interface Empresa {
  id: string;
  nombre: string;
  /** Qué hace, en una frase: es lo que se le cuenta al modelo. */
  descripcion?: string;
  /** Color de la etiqueta, en nombre de Tailwind (por ejemplo "violet"). */
  color?: string;
  /** Ids de los buzones o fuentes (`accountId`) que le pertenecen. */
  cuentas: string[];
  /** Inactiva: no se ofrece en selectores ni al modelo, pero conserva lo etiquetado. */
  activa: boolean;
  orden: number;
  actualizadoEn: string;
}
