import { provideHttpClient, withFetch } from '@angular/common/http';
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
import { PORTAL_CONFIG } from './core/config/portal-config.token';
import { providePortalSources } from './core/sources/source.providers';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    // Todo el estado del portal vive en señales, así que no hace falta zone.js.
    provideZonelessChangeDetection(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' })
    ),
    provideHttpClient(withFetch()),
    { provide: PORTAL_CONFIG, useValue: environment.portal },
    providePortalSources(environment.portal)
  ]
};
