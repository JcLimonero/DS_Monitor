import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { interval } from 'rxjs';
import { PORTAL_CONFIG } from '../config/portal-config.token';

/** Lo que alguien del equipo hizo sobre un pendiente desde su liga. */
export interface Aviso {
  id: string;
  tipo: 'comento' | 'termino' | 'reabrio';
  persona: string;
  tareaId: string;
  titulo: string;
  texto?: string;
  en: string;
  leido: boolean;
}

/**
 * Avisos del monitor: la campana del encabezado. Se consultan al abrir y
 * cada minuto; al tocar uno se marca leído y lleva al pendiente.
 */
@Injectable({ providedIn: 'root' })
export class AvisosService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(PORTAL_CONFIG);

  readonly avisos = signal<Aviso[]>([]);
  readonly noLeidos = computed(
    () => this.avisos().filter((a) => !a.leido).length
  );
  /** El pendiente que hay que abrir al llegar a la lista (viene de un aviso o de la URL). */
  readonly abrir = signal<string | undefined>(undefined);

  constructor() {
    if (this.config.gatewayUrl) {
      this.cargar();
      interval(60_000).subscribe(() => this.cargar());
    }
  }

  cargar(): void {
    this.http.get<Aviso[]>(`${this.config.gatewayUrl}/avisos`).subscribe({
      next: (a) => this.avisos.set(a),
      error: () => undefined
    });
  }

  marcarLeidos(ids?: string[]): void {
    this.avisos.update((lista) =>
      lista.map((a) => (!ids || ids.includes(a.id) ? { ...a, leido: true } : a))
    );
    this.http
      .post(`${this.config.gatewayUrl}/avisos/leer`, { ids })
      .subscribe({ error: () => undefined });
  }
}
