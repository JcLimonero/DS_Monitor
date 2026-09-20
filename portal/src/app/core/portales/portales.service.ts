import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { interval } from 'rxjs';
import { PORTAL_CONFIG } from '../config/portal-config.token';
import { HostedApp } from '../models';

const CADA_MS = 60_000;

/**
 * Los portales montados en Coolify (aplicaciones y servicios), compartidos
 * por Servidores, el carrusel y Hoy. `undefined` hasta la primera respuesta;
 * `sinConfigurar` cuando el puente no tiene Coolify.
 */
@Injectable({ providedIn: 'root' })
export class PortalesService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(PORTAL_CONFIG);

  readonly disponible = !!this.config.gatewayUrl;
  readonly lista = signal<HostedApp[] | undefined>(undefined);
  readonly error = signal<string | undefined>(undefined);
  readonly sinConfigurar = signal(false);

  /** Los que no están corriendo sanos. */
  readonly mal = computed(() =>
    (this.lista() ?? []).filter(
      (p) =>
        p.status === 'stopped' ||
        p.status === 'error' ||
        (p.status === 'running' && p.healthy === false)
    )
  );

  /** Agrupados por servidor de Coolify, lo malo primero dentro de cada uno. */
  readonly porServidor = computed(() => {
    const grupos = new Map<string, HostedApp[]>();
    for (const p of this.lista() ?? []) {
      const clave = p.server ?? 'Sin servidor';
      grupos.set(clave, [...(grupos.get(clave) ?? []), p]);
    }
    return [...grupos.entries()].map(([servidor, portales]) => ({
      servidor,
      portales
    }));
  });

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
    this.http.get<HostedApp[]>(`${this.config.gatewayUrl}/portales`).subscribe({
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
