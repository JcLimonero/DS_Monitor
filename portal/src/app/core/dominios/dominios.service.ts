import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  Dominio,
  PuenteAdminService,
  RespuestaSubdominios,
  ResultadoImportacion,
  ZonaCloudflare
} from '../sources/gateway/puente-admin.service';
import { PortalStore } from '../state/portal.store';
import { unificarDominios } from './dominios.util';

/** Cómo va la conexión con Cloudflare, para decirlo en pantalla. */
export type EstadoCloudflare =
  'desconocido' | 'conectado' | 'sin-configurar' | 'sin-permiso' | 'error';

/** El mensaje de un error HTTP tal como lo mandó el puente, si se puede. */
export function mensajeDeError(error: unknown): string {
  const http = error as {
    status?: number;
    error?: { error?: string } | string;
    message?: string;
  };
  if (http && typeof http.error === 'object' && http.error?.error) {
    return http.error.error;
  }
  if (http?.status === 0) {
    return 'No se pudo llegar al servidor.';
  }
  return http?.message ?? String(error);
}

/**
 * Los dominios del portal: los capturados a mano (viven en el puente) y las
 * zonas de Cloudflare, juntos. Los registros DNS de cada zona se piden al
 * abrirla y se guardan en memoria mientras la página siga abierta.
 *
 * Sin puente no hay nada que leer: `disponible` es falso y la pantalla lo
 * explica. Las rutas de Cloudflare son de administración, así que van con la
 * misma autenticación que el resto (`PuenteAdminService`).
 */
@Injectable({ providedIn: 'root' })
export class DominiosService {
  private readonly admin = inject(PuenteAdminService);
  private readonly store = inject(PortalStore);

  readonly disponible = this.admin.disponible;
  readonly manuales = signal<Dominio[]>([]);
  readonly zonas = signal<ZonaCloudflare[]>([]);
  readonly cargando = signal(false);
  /** `true` cuando ya contestó el puente al menos una vez. */
  readonly cargado = signal(false);
  /** No se pudieron leer los dominios capturados. */
  readonly error = signal<string | undefined>(undefined);
  readonly cloudflare = signal<EstadoCloudflare>('desconocido');
  readonly mensajeCloudflare = signal<string | undefined>(undefined);
  /** El Registrar de Cloudflare contestó con fechas de vencimiento. */
  readonly conFechas = signal(false);
  /** No se pudo consultar el Registrar (fallo pasajero): reintentar. */
  readonly registrarFallo = signal(false);

  readonly unificados = computed(() =>
    unificarDominios(this.manuales(), this.zonas())
  );

  private readonly subdominiosEnMemoria = new Map<
    string,
    RespuestaSubdominios
  >();
  private lecturaEnCurso = 0;

  /** Lee los dominios capturados y las zonas de Cloudflare. */
  async cargar(refrescar = false): Promise<void> {
    if (!this.disponible) {
      this.cargado.set(true);
      return;
    }
    const lectura = ++this.lecturaEnCurso;
    this.cargando.set(true);
    if (refrescar) {
      this.subdominiosEnMemoria.clear();
    }
    const [manuales, zonas] = await Promise.allSettled([
      firstValueFrom(this.admin.dominios()),
      firstValueFrom(this.admin.zonasCloudflare(refrescar))
    ]);
    if (lectura !== this.lecturaEnCurso) {
      return;
    }
    if (manuales.status === 'fulfilled') {
      this.manuales.set(manuales.value);
      this.error.set(undefined);
    } else {
      this.error.set(mensajeDeError(manuales.reason));
    }
    if (zonas.status === 'fulfilled') {
      this.zonas.set(zonas.value.zonas);
      this.conFechas.set(zonas.value.conFechas);
      this.registrarFallo.set(zonas.value.registrarFallo === true);
      this.cloudflare.set(zonas.value.problema ? 'sin-permiso' : 'conectado');
      this.mensajeCloudflare.set(zonas.value.problema?.mensaje);
    } else {
      const http = zonas.reason as { status?: number };
      this.zonas.set([]);
      this.conFechas.set(false);
      this.registrarFallo.set(false);
      this.cloudflare.set(http?.status === 503 ? 'sin-configurar' : 'error');
      this.mensajeCloudflare.set(
        http?.status === 503 ? undefined : mensajeDeError(zonas.reason)
      );
    }
    this.cargando.set(false);
    this.cargado.set(true);
  }

  /** Los subdominios de una zona; la segunda vez salen de memoria. */
  async subdominios(
    zonaId: string,
    refrescar = false
  ): Promise<RespuestaSubdominios> {
    const guardado = this.subdominiosEnMemoria.get(zonaId);
    if (guardado && !refrescar) {
      return guardado;
    }
    const lectura = await firstValueFrom(
      this.admin.subdominiosCloudflare(zonaId, refrescar)
    );
    this.subdominiosEnMemoria.set(zonaId, lectura);
    return lectura;
  }

  /** Trae a los dominios capturados las zonas elegidas. */
  async importar(nombres: string[]): Promise<ResultadoImportacion> {
    const resultado = await firstValueFrom(
      this.admin.importarDeCloudflare(nombres)
    );
    // Lo importado cambia la lista y, cuando trae fecha, las licencias.
    try {
      this.manuales.set(await firstValueFrom(this.admin.dominios()));
    } catch {
      // Ya se importó; la lista se actualiza en la próxima lectura.
    }
    this.store.refreshLicenses();
    return resultado;
  }
}
