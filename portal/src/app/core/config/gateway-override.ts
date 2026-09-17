import { PortalConfig } from './portal-config.model';

/**
 * Raíz del puente elegida desde el navegador.
 *
 * El entorno trae una raíz fija ('' en desarrollo, que deja todo en
 * demostración). Para probar contra un puente que corre en la misma máquina
 * sin tocar el código, Ajustes guarda aquí otra raíz y el portal la usa al
 * recargar. Vive en localStorage porque es una preferencia de esta máquina,
 * no de la instalación.
 */
const LLAVE = 'ds-monitor.puente';

export function gatewayOverride(): string | undefined {
  try {
    return localStorage.getItem(LLAVE) ?? undefined;
  } catch {
    return undefined;
  }
}

export function setGatewayOverride(url: string | undefined): void {
  try {
    if (url) {
      localStorage.setItem(LLAVE, url.replace(/\/+$/, ''));
    } else {
      localStorage.removeItem(LLAVE);
    }
  } catch {
    // Sin almacenamiento (modo privado, por ejemplo) no hay nada que guardar.
  }
}

/** La configuración del entorno con la raíz del navegador encima, si hay. */
export function withGatewayOverride(config: PortalConfig): PortalConfig {
  const override = gatewayOverride();
  return override === undefined ? config : { ...config, gatewayUrl: override };
}
