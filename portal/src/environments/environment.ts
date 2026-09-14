import { PortalConfig } from '../app/core/config/portal-config.model';
import { PORTAL_DEFAULTS } from '../app/core/config/portal-defaults';

/**
 * Entorno de desarrollo.
 *
 * `gatewayUrl` vacío deja todas las conexiones corriendo contra el adaptador de
 * demostración, que inventa los datos. Para trabajar contra fuentes reales se
 * levanta el puente, se apunta aquí y se cambia a `gateway` el `mode` de la
 * conexión que ya este lista. Ver portal/README.md.
 */
export const environment: { production: boolean; portal: PortalConfig } = {
  production: false,
  portal: {
    gatewayUrl: '',
    autoRefreshSeconds: 300,
    ...PORTAL_DEFAULTS
  }
};
