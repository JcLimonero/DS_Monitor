import { InjectionToken } from '@angular/core';
import { PortalConfig } from './portal-config.model';

/** Configuración viva del portal. La llena `app.config.ts` desde el entorno. */
export const PORTAL_CONFIG = new InjectionToken<PortalConfig>('PORTAL_CONFIG');
