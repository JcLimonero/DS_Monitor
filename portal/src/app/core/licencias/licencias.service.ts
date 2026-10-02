import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, forkJoin, map, of, tap, throwError } from 'rxjs';
import {
  NewManualLicense,
  LocalSettingsStore
} from '../config/local-settings.store';
import { PORTAL_CONFIG } from '../config/portal-config.token';
import { LicenseAdjustment, LicenseRenewal, ManualLicense } from '../models';
import {
  EstadoLicencias,
  PuenteAdminService,
  RenovacionPedida,
  ResumenMigracion
} from '../sources/gateway/puente-admin.service';
import { combinarConLocales, manualDeLocal, ymdAIso } from './licencias.util';

/** Cuántas confirmaciones se guardan por licencia (igual que el puente). */
const MAX_HISTORIAL = 24;

/**
 * Lo que se corrige de una licencia. Un campo en `null` quita esa corrección;
 * uno ausente no se toca.
 */
export interface AjustePedido {
  cost?: number | null;
  currency?: string | null;
  plan?: string | null;
  /** ISO o `YYYY-MM-DD`. */
  renewsAt?: string | null;
  hidden?: boolean;
}

/**
 * Las licencias capturadas a mano y las correcciones o confirmaciones de
 * renovación. Con puente viven ahí, compartidas: lo que se confirma en una
 * laptop lo ve la televisión del carrusel. Sin puente quedan en este
 * navegador, como antes.
 *
 * Con puente, lo que este navegador capturó en la época anterior y aún no se
 * sube se sigue viendo, de forma provisional y marcado, hasta que se suba.
 *
 * Lo que llega de cada proveedor sigue en `PortalStore`, que junta las dos
 * cosas (`aplicarLicencias`).
 */
@Injectable({ providedIn: 'root' })
export class LicenciasService {
  private readonly config = inject(PORTAL_CONFIG);
  private readonly admin = inject(PuenteAdminService);
  private readonly local = inject(LocalSettingsStore);

  readonly conPuente = !!this.config.gatewayUrl;
  /** `true` cuando ya contestó el puente (o no hay puente). */
  readonly cargadas = signal(!this.conPuente);
  readonly error = signal<string | undefined>(undefined);
  /** Lo que pasó en la última subida desde este navegador, para mostrarlo. */
  readonly ultimaSubida = signal<ResumenMigracion | undefined>(undefined);

  private readonly manualesPuente = signal<ManualLicense[]>([]);
  private readonly ajustesPuente = signal<Record<string, LicenseAdjustment>>(
    {}
  );
  private enCurso = false;

  /** Lo del puente más, provisionalmente, lo de este navegador que falta subir. */
  private readonly combinadas = computed(() =>
    combinarConLocales(
      { manuales: this.manualesPuente(), ajustes: this.ajustesPuente() },
      {
        manuales: this.local.manualLicenses(),
        ajustes: this.local.licenseEdits()
      }
    )
  );

  readonly manuales = computed<ManualLicense[]>(() =>
    this.conPuente
      ? this.combinadas().manuales
      : this.local
          .manualLicenses()
          .filter((l) => !!l && typeof l === 'object')
          .map(manualDeLocal)
  );

  readonly ajustes = computed<Record<string, LicenseAdjustment>>(() =>
    this.conPuente
      ? this.combinadas().ajustes
      : Object.fromEntries(
          Object.entries(this.local.licenseEdits())
            .filter(([, e]) => !!e && typeof e === 'object')
            .map(([id, edicion]) => [
              id,
              { ...edicion, history: edicion.history ?? [] }
            ])
        )
  );

  /** Ids que hoy solo existen en este navegador (se ven provisionalmente). */
  readonly soloEnEsteNavegador = computed<ReadonlySet<string>>(() => {
    if (!this.conPuente || !this.cargadas()) {
      return new Set();
    }
    const c = this.combinadas();
    return new Set([...c.manualesSoloLocal, ...c.ajustesSoloLocal]);
  });

  /** Licencias a mano que el puente aún no tiene: no se pueden renovar allá. */
  readonly manualesSoloLocal = computed<ReadonlySet<string>>(() =>
    this.conPuente && this.cargadas()
      ? this.combinadas().manualesSoloLocal
      : new Set()
  );

  /** Cuántas cosas capturadas en este navegador todavía no están en el puente. */
  readonly pendientesDeSubir = computed(() => {
    if (!this.conPuente || !this.cargadas()) {
      return 0;
    }
    const c = this.combinadas();
    return c.manualesSoloLocal.size + c.ajustesSoloLocal.size;
  });

  constructor() {
    this.cargar();
  }

  /** Vuelve a pedir al puente (los dispositivos se enteran de lo de los demás). */
  cargar(): void {
    if (!this.conPuente || this.enCurso) {
      return;
    }
    this.enCurso = true;
    forkJoin([this.admin.licenciasManuales(), this.admin.licenciasAjustes()])
      .pipe(
        map(([manuales, ajustes]) => ({
          manuales: Array.isArray(manuales) ? manuales : [],
          ajustes: ajustes && typeof ajustes === 'object' ? ajustes : {}
        }))
      )
      .subscribe({
        next: (estado) => {
          this.aplicar(estado);
          this.enCurso = false;
          this.cargadas.set(true);
          this.error.set(undefined);
        },
        error: (e: unknown) => {
          this.enCurso = false;
          this.cargadas.set(true);
          this.error.set(describir(e));
        }
      });
  }

  /** Da de alta una licencia a mano. */
  guardarManual(input: NewManualLicense): Observable<ManualLicense> {
    if (!this.conPuente) {
      return of(this.local.addManualLicense(input));
    }
    return this.admin
      .guardarLicenciaManual({
        product: input.product,
        provider: input.provider,
        accountId: input.accountId,
        plan: input.plan,
        cost: input.cost ?? null,
        currency: input.currency,
        period: input.period,
        renewsAt: input.renewsAt ?? '',
        url: input.url ?? '',
        notes: input.notes
      })
      .pipe(
        tap((licencia) =>
          this.manualesPuente.update((lista) => [
            ...lista.filter((m) => m.id !== licencia.id),
            licencia
          ])
        )
      );
  }

  /** Una licencia a mano que el puente no tiene: no se puede renovar ni corregir allá. */
  private soloEnNavegador(id: string): boolean {
    return this.manualesSoloLocal().has(id);
  }

  private bloqueada(): Observable<never> {
    return throwError(
      () =>
        new Error(
          'Esta licencia solo está en este navegador: primero sube lo capturado aquí al servidor.'
        )
    );
  }

  borrarManual(id: string): Observable<void> {
    if (!this.conPuente || this.soloEnNavegador(id)) {
      this.local.removeManualLicense(id);
      this.local.clearLicenseEdit(id);
      return of(undefined);
    }
    return this.admin.borrarLicenciaManual(id).pipe(
      tap((estado) => this.aplicar(estado)),
      map(() => undefined)
    );
  }

  /** Corrige costo, moneda, plan, fecha, o la oculta. */
  guardarAjuste(id: string, ajuste: AjustePedido): Observable<void> {
    if (this.soloEnNavegador(id)) {
      return this.bloqueada();
    }
    if (!this.conPuente) {
      const limpio: Record<string, unknown> = {};
      for (const [campo, valor] of Object.entries(ajuste)) {
        limpio[campo] = valor === null ? undefined : valor;
      }
      this.local.editLicense(id, {
        ...limpio,
        ...(ajuste.renewsAt ? { renewsAt: soloFechaAIso(ajuste.renewsAt) } : {})
      });
      return of(undefined);
    }
    return this.admin.guardarLicenciaAjuste(id, { ...ajuste }).pipe(
      tap((estado) => this.aplicar(estado)),
      map(() => undefined)
    );
  }

  /** Quita la corrección (y la constancia de renovación) de una licencia. */
  quitarAjuste(id: string): Observable<void> {
    if (!this.conPuente) {
      this.local.clearLicenseEdit(id);
      return of(undefined);
    }
    return this.admin.borrarLicenciaAjuste(id).pipe(
      tap((estado) => this.aplicar(estado)),
      map(() => undefined)
    );
  }

  /** "Ya se renovó": deja constancia, el costo y la siguiente fecha. */
  renovar(pedida: RenovacionPedida): Observable<LicenseRenewal> {
    if (this.soloEnNavegador(pedida.id)) {
      return this.bloqueada();
    }
    if (!this.conPuente) {
      const ahora = new Date().toISOString();
      const renovacion: LicenseRenewal = {
        at: ahora,
        by: 'este navegador',
        ...(pedida.costo !== undefined ? { cost: pedida.costo } : {}),
        ...(pedida.moneda ? { currency: pedida.moneda } : {}),
        renewsAt: soloFechaAIso(pedida.renuevaEn),
        ...(pedida.nota ? { note: pedida.nota } : {})
      };
      const previo = this.local.licenseEdits()[pedida.id];
      this.local.editLicense(pedida.id, {
        ...(pedida.costo !== undefined ? { cost: pedida.costo } : {}),
        ...(pedida.moneda ? { currency: pedida.moneda } : {}),
        renewsAt: renovacion.renewsAt,
        renewedAt: ahora,
        confirmedBy: renovacion.by,
        history: [...(previo?.history ?? []), renovacion].slice(-MAX_HISTORIAL)
      });
      return of(renovacion);
    }
    return this.admin.renovarLicencia(pedida).pipe(
      tap((estado) => this.aplicar(estado)),
      map((estado) => estado.renovacion)
    );
  }

  /**
   * Sube al puente lo que este navegador tenía capturado. El puente sanea cada
   * registro por su cuenta y no pisa lo que ya tiene (por id); de este
   * navegador se quita todo salvo lo que no se pudo subir. Solo se llama con
   * un clic de quien lo pide.
   */
  subirLoDeEsteNavegador(): Observable<ResumenMigracion> {
    // Se manda todo lo local, no solo lo que falta: si el servidor ya tenia el
    // id con otros datos, lo avisa en `conflictos` en vez de que se pierda en
    // silencio al limpiar el navegador.
    return this.admin
      .migrarLicencias({
        manuales: this.local.manualLicenses(),
        ajustes: this.local.licenseEdits()
      })
      .pipe(
        tap((r) => {
          this.aplicar(r);
          this.local.conservarSoloLicencias(r.descartadas);
          this.ultimaSubida.set(r);
        })
      );
  }

  /** Quita de este navegador lo que no se pudo subir (después de enterarse). */
  descartarLoQueNoSubio(): void {
    this.local.clearLocalLicenses();
    this.ultimaSubida.set(undefined);
  }

  cerrarResumenDeSubida(): void {
    this.ultimaSubida.set(undefined);
  }

  private aplicar(estado: EstadoLicencias): void {
    this.manualesPuente.set(estado.manuales);
    this.ajustesPuente.set(estado.ajustes);
  }
}

/** `2026-11-05` queda al mediodía UTC; una fecha completa se respeta. */
function soloFechaAIso(valor: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(valor) ? ymdAIso(valor) : valor;
}

function describir(error: unknown): string {
  const http = error as { error?: { error?: string }; message?: string };
  return http?.error?.error ?? http?.message ?? String(error);
}
