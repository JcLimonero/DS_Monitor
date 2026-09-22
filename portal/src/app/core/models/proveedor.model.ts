/**
 * Un proveedor o cliente externo, del catálogo que se edita en Integraciones →
 * Proveedores. Mismo contrato que en puente/src/nucleo/contrato.ts.
 */
export interface Proveedor {
  id: string;
  nombre: string;
  /** Qué es, en una frase: es lo que se le cuenta al modelo. */
  descripcion?: string;
  /** Color de la etiqueta, en nombre de Tailwind (por ejemplo "sky"). */
  color?: string;
  /** Inactivo: no se ofrece en selectores ni al modelo, pero conserva lo etiquetado. */
  activa: boolean;
  orden: number;
  actualizadoEn: string;
}
