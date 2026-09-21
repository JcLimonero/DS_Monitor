import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { PORTAL_CONFIG } from '../config/portal-config.token';
import { AccountColor, Proveedor } from '../models';
import { PuenteAdminService } from '../sources/gateway/puente-admin.service';
import { ACCOUNT_COLORS } from '../config/local-settings';

/** Los tres de siempre: lo que se ve sin puente y mientras carga. */
export const PROVEEDORES_POR_OMISION: Proveedor[] = [
  {
    id: 'vanguardia',
    nombre: 'Vanguardia',
    descripcion: 'grupo automotriz',
    color: 'sky',
    activa: true,
    orden: 0,
    actualizadoEn: ''
  },
  {
    id: 'birdom',
    nombre: 'Birdom',
    descripcion: 'operaciones y producto',
    color: 'rose',
    activa: true,
    orden: 1,
    actualizadoEn: ''
  },
  {
    id: 'autodeal',
    nombre: 'AutoDeal',
    descripcion: 'agencias automotrices',
    color: 'amber',
    activa: true,
    orden: 2,
    actualizadoEn: ''
  }
];

/** Lo que se manda al guardar: el puente pone orden y fecha. */
export type ProveedorEdicion = Omit<
  Proveedor,
  'id' | 'orden' | 'actualizadoEn'
> & {
  id?: string;
};

/**
 * El catálogo de proveedores y clientes externos, compartido por los
 * selectores (tarjeta, Pendientes, Dictado), los filtros y la pestaña
 * Integraciones → Proveedores. Se pide al puente una vez al arrancar; sin
 * puente se usan los tres de siempre. Al guardar, la lista nueva se ve en
 * todos lados sin recargar.
 */
@Injectable({ providedIn: 'root' })
export class ProveedoresService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(PORTAL_CONFIG);
  private readonly admin = inject(PuenteAdminService);

  readonly disponible = !!this.config.gatewayUrl;
  /** Todas, activas e inactivas, en su orden. */
  readonly todas = signal<Proveedor[]>(PROVEEDORES_POR_OMISION);
  /** `true` cuando ya contestó el puente (o no hay puente). */
  readonly cargadas = signal(!this.config.gatewayUrl);
  readonly error = signal<string | undefined>(undefined);
  private enCurso = false;

  /** Las activas, en orden: lo que se ofrece en selectores y filtros. */
  readonly lista = computed(() =>
    [...this.todas()].filter((p) => p.activa).sort((a, b) => a.orden - b.orden)
  );
  /** Solo los nombres, para los `<select>` de proveedor. */
  readonly nombres = computed(() => this.lista().map((p) => p.nombre));

  private readonly porNombre = computed(
    () => new Map(this.todas().map((p) => [claveNombre(p.nombre), p]))
  );

  constructor() {
    this.cargar();
  }

  cargar(): void {
    if (!this.disponible || this.enCurso) {
      return;
    }
    this.enCurso = true;
    this.http
      .get<Proveedor[]>(`${this.config.gatewayUrl}/proveedores`)
      .subscribe({
        next: (lista) => {
          if (Array.isArray(lista) && lista.length > 0) {
            this.todas.set(lista);
          }
          this.enCurso = false;
          this.cargadas.set(true);
          this.error.set(undefined);
        },
        error: (e: unknown) => {
          this.enCurso = false;
          this.cargadas.set(true);
          this.error.set(describe(e));
        }
      });
  }

  /** Guarda la lista completa; al volver, todos los selectores la ven. */
  guardar(proveedores: ProveedorEdicion[]): Observable<Proveedor[]> {
    return this.admin
      .guardarProveedores(proveedores)
      .pipe(tap((lista) => this.todas.set(lista)));
  }

  /** El proveedor por nombre (sin distinguir mayúsculas ni acentos), si existe. */
  proveedor(nombre: string | undefined): Proveedor | undefined {
    return nombre ? this.porNombre().get(claveNombre(nombre)) : undefined;
  }

  /**
   * El color de la etiqueta: el del catálogo o, si no tiene, uno derivado del
   * nombre para que un proveedor nuevo se distinga sin configurar nada.
   */
  colorDe(nombre: string | undefined): AccountColor {
    if (!nombre) {
      return 'slate';
    }
    const propio = this.proveedor(nombre)?.color;
    if (propio && (ACCOUNT_COLORS as readonly string[]).includes(propio)) {
      return propio as AccountColor;
    }
    return colorDerivado(nombre);
  }
}

/** Un color estable a partir del nombre (sin el gris, que es "sin proveedor"). */
export function colorDerivadoProveedor(nombre: string): AccountColor {
  return colorDerivado(nombre);
}

function colorDerivado(nombre: string): AccountColor {
  const paleta = ACCOUNT_COLORS.filter((c) => c !== 'slate');
  let h = 0;
  for (const ch of claveNombre(nombre)) {
    h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return paleta[h % paleta.length] ?? 'sky';
}

function claveNombre(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function describe(error: unknown): string {
  const http = error as { error?: { error?: string }; message?: string };
  return http?.error?.error ?? http?.message ?? String(error);
}
