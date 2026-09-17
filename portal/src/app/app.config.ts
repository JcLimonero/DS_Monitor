import {
  provideHttpClient,
  withFetch,
  withInterceptors
} from '@angular/common/http';
import {
  ApplicationConfig,
  provideZonelessChangeDetection
} from '@angular/core';
import {
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling
} from '@angular/router';
import { environment } from '../environments/environment';
import { sesionInterceptor } from './core/acceso/sesion.interceptor';
import { withGatewayOverride } from './core/config/gateway-override';
import { provideCuentasConfiguradas } from './core/config/configuradas';
import {
  readLocalSettings,
  withLocalSettings
} from './core/config/local-settings';
import { PORTAL_CONFIG } from './core/config/portal-config.token';
import { providePortalSources } from './core/sources/source.providers';
import { routes } from './app.routes';

// La raíz del puente y las cuentas agregadas a mano vienen del navegador
// (ver gateway-override.ts y local-settings.ts).
const portal = withLocalSettings(
  withGatewayOverride(environment.portal),
  readLocalSettings()
);

export const appConfig: ApplicationConfig = {
  providers: [
    // Todo el estado del portal vive en señales, así que no hace falta zone.js.
    provideZonelessChangeDetection(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' })
    ),
    provideHttpClient(withFetch(), withInterceptors([sesionInterceptor])),
    provideCuentasConfiguradas(portal),
    { provide: PORTAL_CONFIG, useValue: portal },
    providePortalSources(portal)
  ]
};
