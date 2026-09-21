import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { PORTAL_CONFIG } from '../config/portal-config.token';
import { PuenteAdminService } from '../sources/gateway/puente-admin.service';
import { SesionService } from './sesion.service';

/**
 * Pone el token de sesión en todo lo que va al puente, y si el puente contesta
 * 401 manda a la pantalla de acceso. Las llamadas de administración ya llevan
 * su propio Bearer; a esas no se les toca.
 */
export const sesionInterceptor: HttpInterceptorFn = (req, next) => {
  const config = inject(PORTAL_CONFIG);
  const sesion = inject(SesionService);
  const admin = inject(PuenteAdminService);
  const router = inject(Router);

  const alPuente = !!config.gatewayUrl && req.url.startsWith(config.gatewayUrl);
  const token = sesion.token() || admin.token();
  const peticion =
    alPuente && token && !req.headers.has('authorization')
      ? req.clone({ setHeaders: { authorization: `Bearer ${token}` } })
      : req;

  return next(peticion).pipe(
    catchError((error: unknown) => {
      // La ruta real del navegador, no `router.url`: antes de la primera
      // navegación este todavía dice "/" y mandaría a /acceso a quien
      // entra directo a su liga /mio/<token> (que no necesita sesión).
      const ruta = rutaActual(router.url);
      if (
        alPuente &&
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        !req.url.includes('/acceso/') &&
        !ruta.startsWith('/mio/')
      ) {
        sesion.requerida.set(true);
        if (!ruta.startsWith('/acceso')) {
          void router.navigate(['/acceso'], {
            queryParams: { volver: ruta }
          });
        }
      }
      return throwError(() => error);
    })
  );
};

/** Ruta del navegador (con búsqueda), o la del router si no hay ventana. */
export function rutaActual(deRouter: string): string {
  if (typeof location === 'undefined') {
    return deRouter;
  }
  return `${location.pathname}${location.search}`;
}
