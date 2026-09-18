import { Injectable, computed, inject, signal } from '@angular/core';
import { interval } from 'rxjs';
import {
  Ejecucion,
  PuenteAdminService
} from '../sources/gateway/puente-admin.service';

/** Cada cuánto se vuelve a pedir la lista. Son corridas: un minuto alcanza. */
const CADA_MS = 60_000;

/**
 * La última corrida de cada integración, compartida por la pantalla de
 * Ejecuciones, el aviso de Hoy y la diapositiva del carrusel. Se pide una
 * vez al arrancar y cada minuto; cualquiera puede pedirla de nuevo.
 */
@Injectable({ providedIn: 'root' })
export class EjecucionesService {
  private readonly admin = inject(PuenteAdminService);

  readonly disponible = this.admin.disponible;
  /** `undefined` hasta la primera respuesta. */
  readonly lista = signal<Ejecucion[] | undefined>(undefined);
  readonly error = signal<string | undefined>(undefined);

  /** Las que no están bien: error o atrasadas. */
  readonly mal = computed(() =>
    (this.lista() ?? []).filter(
      (e) => e.estado === 'error' || e.estado === 'atrasada'
    )
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
    this.admin.ejecuciones().subscribe({
      next: (lista) => {
        this.lista.set(lista);
        this.error.set(undefined);
      },
      error: (e: unknown) => this.error.set(describir(e))
    });
  }

  borrar(clave: string): void {
    this.admin.borrarEjecucion(clave).subscribe({
      next: () => this.cargar(),
      error: (e: unknown) => this.error.set(describir(e))
    });
  }
}

function describir(error: unknown): string {
  const http = error as { error?: { error?: string }; message?: string };
  return http?.error?.error ?? http?.message ?? String(error);
}
