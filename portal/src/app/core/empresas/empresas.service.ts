import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { PORTAL_CONFIG } from '../config/portal-config.token';
import { AccountColor, Empresa } from '../models';
import { PuenteAdminService } from '../sources/gateway/puente-admin.service';
import { ACCOUNT_COLORS } from '../config/local-settings';

/** Las cuatro de siempre: lo que se ve sin puente y mientras carga. */
export const EMPRESAS_POR_OMISION: Empresa[] = [
  {
    id: 'itech-dev',
    nombre: 'Itech Dev',
    descripcion: 'desarrollo de software a la medida',
    color: 'violet',
    cuentas: ['correo-itech', 'correo-itech-alterno', 'itech'],
    activa: true,
    orden: 0,
    actualizadoEn: ''
  },
  {
    id: 'dealer-solutions',
    nombre: 'Dealer Solutions',
    descripcion: 'software para agencias automotrices',
    color: 'cyan',
    cuentas: ['correo-dealer'],
    activa: true,
    orden: 1,
    actualizadoEn: ''
  },
  {
    id: 'nexusqtech',
    nombre: 'NexusQTech',
    descripcion: 'integraciones y tecnología para grupos automotrices',
    color: 'emerald',
    cuentas: ['correo-nexus', 'correo-outlook'],
    activa: true,
    orden: 2,
    actualizadoEn: ''
  },
  {
    id: 'operativai',
    nombre: 'OperativAI',
    descripcion: 'agentes de IA',
    color: 'orange',
    cuentas: [],
    activa: true,
    orden: 3,
    actualizadoEn: ''
  }
];

/** Lo que se manda al guardar: el puente pone orden y fecha. */
export type EmpresaEdicion = Omit<Empresa, 'id' | 'orden' | 'actualizadoEn'> & {
  id?: string;
};

/**
 * El catálogo de empresas del grupo, compartido por los selectores (tarjeta,
 * Pendientes, Dictado), los filtros y la pestaña Integraciones → Empresas.
 * Se pide al puente una vez al arrancar; sin puente se usan las cuatro de
 * siempre. Al guardar, la lista nueva se ve en todos lados sin recargar.
 */
@Injectable({ providedIn: 'root' })
export class EmpresasService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(PORTAL_CONFIG);
  private readonly admin = inject(PuenteAdminService);

  readonly disponible = !!this.config.gatewayUrl;
  /** Todas, activas e inactivas, en su orden. */
  readonly todas = signal<Empresa[]>(EMPRESAS_POR_OMISION);
  /** `true` cuando ya contestó el puente (o no hay puente). */
  readonly cargadas = signal(!this.config.gatewayUrl);
  readonly error = signal<string | undefined>(undefined);
  private enCurso = false;

  /** Las activas, en orden: lo que se ofrece en selectores y filtros. */
  readonly lista = computed(() =>
    [...this.todas()].filter((e) => e.activa).sort((a, b) => a.orden - b.orden)
  );
  /** Solo los nombres, para los `<select>` de empresa. */
  readonly nombres = computed(() => this.lista().map((e) => e.nombre));

  private readonly porNombre = computed(
    () => new Map(this.todas().map((e) => [claveNombre(e.nombre), e]))
  );

  constructor() {
    this.cargar();
  }

  cargar(): void {
    if (!this.disponible || this.enCurso) {
      return;
    }
    this.enCurso = true;
    this.http.get<Empresa[]>(`${this.config.gatewayUrl}/empresas`).subscribe({
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
  guardar(empresas: EmpresaEdicion[]): Observable<Empresa[]> {
    return this.admin
      .guardarEmpresas(empresas)
      .pipe(tap((lista) => this.todas.set(lista)));
  }

  /** La empresa por nombre (sin distinguir mayúsculas ni acentos), si existe. */
  empresa(nombre: string | undefined): Empresa | undefined {
    return nombre ? this.porNombre().get(claveNombre(nombre)) : undefined;
  }

  /**
   * El color de la etiqueta: el del catálogo o, si no tiene, uno derivado del
   * nombre para que una empresa nueva se distinga sin configurar nada.
   */
  colorDe(nombre: string | undefined): AccountColor {
    if (!nombre) {
      return 'slate';
    }
    const propio = this.empresa(nombre)?.color;
    if (propio && (ACCOUNT_COLORS as readonly string[]).includes(propio)) {
      return propio as AccountColor;
    }
    return colorDerivado(nombre);
  }
}

/** Un color estable a partir del nombre (sin el gris, que es "sin empresa"). */
export function colorDerivado(nombre: string): AccountColor {
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
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function describe(error: unknown): string {
  const http = error as { error?: { error?: string }; message?: string };
  return http?.error?.error ?? http?.message ?? String(error);
}
