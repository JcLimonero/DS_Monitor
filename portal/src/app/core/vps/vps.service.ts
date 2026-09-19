import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { interval } from 'rxjs';
import { PORTAL_CONFIG } from '../config/portal-config.token';
import { VpsStatus } from '../models';

/** Cada cuánto se vuelve a pedir; el puente cachea un minuto. */
const CADA_MS = 60_000;

/**
 * Los servidores (VPS) que Prometheus vigila, compartidos por la pantalla,
 * el carrusel y Hoy. `undefined` hasta la primera respuesta; `error` si el
 * puente no tiene Prometheus configurado o no responde.
 */
@Injectable({ providedIn: 'root' })
export class VpsService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(PORTAL_CONFIG);

  readonly disponible = !!this.config.gatewayUrl;
  readonly lista = signal<VpsStatus[] | undefined>(undefined);
  readonly error = signal<string | undefined>(undefined);
  /** Sin Prometheus configurado en el puente. */
  readonly sinConfigurar = signal(false);

  readonly mal = computed(() =>
    (this.lista() ?? []).filter((v) => v.health !== 'bien')
  );

  constructor() {
    if (this.disponible) {
      this.cargar();
      interval(CADA_MS).subscribe(() => this.cargar());
    }
  }

  cargar(): void {
    if (!this.disponible) {
      return;
    }
    this.http
      .get<VpsStatus[]>(`${this.config.gatewayUrl}/vps/estado`)
      .subscribe({
        next: (lista) => {
          this.lista.set(lista);
          this.error.set(undefined);
          this.sinConfigurar.set(false);
        },
        error: (e: unknown) => {
          const http = e as {
            status?: number;
            error?: { error?: string };
            message?: string;
          };
          this.sinConfigurar.set(http?.status === 503);
          this.error.set(
            http?.error?.error ?? http?.message ?? 'No se pudo cargar.'
          );
          if (this.lista() === undefined) {
            this.lista.set([]);
          }
        }
      });
  }
}
