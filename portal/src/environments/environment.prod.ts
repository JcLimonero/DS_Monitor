import { PortalConfig } from '../app/core/config/portal-config.model';
import { PORTAL_DEFAULTS } from '../app/core/config/portal-defaults';

/**
 * Entorno de producción.
 *
 * El puente se sirve en el mismo origen que el portal para que la cookie de
 * sesión viaje sola y no haya que abrir CORS.
 */
export const environment: { production: boolean; portal: PortalConfig } = {
  production: true,
  portal: {
    gatewayUrl: '/api/portal',
    autoRefreshSeconds: 120,
    ...PORTAL_DEFAULTS
  }
};
