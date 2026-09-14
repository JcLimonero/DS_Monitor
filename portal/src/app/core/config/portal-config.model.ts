import { Account, SourceKind } from '../models';

/**
 * Cómo se conecta una fuente concreta.
 *
 * - `demo`: el adaptador inventa los datos. No pide credenciales ni red.
 * - `gateway`: el adaptador pega a nuestro backend puente, que es el que
 *   guarda las credenciales y habla con Odoo, Google o quien sea. El navegador
 *   nunca ve un token: esa es toda la razón de que exista el puente.
 * - `local`: no sale del navegador. Solo lo usan los pendientes que se capturan
 *   en el portal mismo, que no vienen de ningún sistema de afuera.
 */
export type ConnectionMode = 'demo' | 'gateway' | 'local';

export interface SourceConnection {
  id: string;
  /** Cuenta de `PortalConfig.accounts` a la que pertenecen estos datos. */
  accountId: string;
  kind: SourceKind;
  mode: ConnectionMode;
  /** Qué alimenta esta conexión. Una misma fuente puede alimentar varias. */
  provides: ConnectionCapability[];
  /** Ruta dentro del puente, por ejemplo "/odoo/itech". Solo en modo gateway. */
  path?: string;
}

export type ConnectionCapability = 'tasks' | 'meetings' | 'monitors' | 'crm';

export interface PortalConfig {
  /** Raíz del backend puente. Vacío mientras no exista: todo corre en demo. */
  gatewayUrl: string;
  /** Cada cuántos segundos se refrescan los datos solos. 0 lo desactiva. */
  autoRefreshSeconds: number;
  accounts: Account[];
  connections: SourceConnection[];
}
