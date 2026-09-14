/**
 * Tipos que comparten todas las fuentes del portal.
 *
 * La idea de fondo: cada integración (Odoo, Google, Ops, monitoreo...) trae sus
 * datos con su propio vocabulario, y el adaptador los traduce a estos tipos. Las
 * vistas nunca ven un campo de Odoo ni uno de Google, solo estos modelos.
 */

/** Cada integración que puede alimentar al portal. */
export type SourceKind =
  | 'odoo'
  | 'google'
  | 'microsoft'
  | 'ops'
  | 'local'
  | 'monitor'
  | 'anthropic'
  | 'cursor'
  | 'figma'
  | 'vercel';

/** Una cuenta concreta dentro de una integración, por ejemplo un correo. */
export interface Account {
  id: string;
  /** Nombre corto para las etiquetas de la interfaz, por ejemplo "Itech". */
  label: string;
  /** Detalle para las pantallas de ajustes, normalmente el correo o la URL. */
  detail: string;
  kind: SourceKind;
  /** Color de la etiqueta, en formato Tailwind (por ejemplo "sky"). */
  color: AccountColor;
  enabled: boolean;
}

export type AccountColor =
  | 'sky'
  | 'violet'
  | 'emerald'
  | 'amber'
  | 'rose'
  | 'slate'
  | 'indigo'
  | 'teal'
  | 'orange'
  | 'fuchsia';

/** Persona involucrada en un pendiente, una junta o una oportunidad. */
export interface Person {
  id: string;
  name: string;
  email?: string;
  /** Puesto o rol, se muestra en la vista de equipo. */
  role?: string;
}

/** Estado de la última sincronización de una fuente. */
export interface SyncState {
  sourceId: string;
  label: string;
  kind: SourceKind;
  status: 'inactiva' | 'sincronizando' | 'lista' | 'error';
  lastSync?: string;
  /** Mensaje de error tal cual lo devolvió la fuente, si falló. */
  error?: string;
  /** True cuando los datos vienen del adaptador de demostración. */
  demo: boolean;
}
