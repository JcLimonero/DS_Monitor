import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, defer, firstValueFrom, from, map, of, tap } from 'rxjs';
import { SesionService } from '../acceso/sesion.service';
import { Account, AjustesPortal } from '../models';
import { PuenteAdminService } from '../sources/gateway/puente-admin.service';
import {
  ParcheAjustes,
  ajustesParaSubir,
  cuerpoDeGuardado,
  hayAjustesLocales,
  normalizarAjustes,
  servidorTieneAjustes
} from './ajustes-portal';
import { LocalSettingsStore, NewMailAccount } from './local-settings.store';
import { accountIdFor } from './local-settings';
import { PORTAL_CONFIG } from './portal-config.token';

/** Qué se le ofrece a quien administra cuando el navegador trae ajustes viejos. */
export type Migracion = 'subir' | 'descartar';

/**
 * Los ajustes del portal que se comparten desde el puente: apagar una fuente,
 * pasar una conexión a datos reales, y agregar o quitar buzones. Antes eran
 * por navegador; ahora, con puente, se guardan en el servidor y los ven todos
 * los dispositivos (la TV del carrusel, el celular). Sin puente caen a
 * `localStorage` como siempre, a través de `LocalSettingsStore`.
 *
 * Reglas de arranque: si el servidor ya tiene ajustes, esos mandan sobre lo
 * local; si está vacío o no contesta, el portal arranca con lo local, como
 * antes. Agregar, quitar o apagar una cuenta pide recargar, porque los
 * adaptadores se construyen al arrancar.
 */
@Injectable({ providedIn: 'root' })
export class AjustesPortalService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(PORTAL_CONFIG);
  private readonly admin = inject(PuenteAdminService);
  private readonly sesion = inject(SesionService);
  private readonly local = inject(LocalSettingsStore);

  /** Hay un puente al que preguntarle. */
  readonly conPuente = !!this.config.gatewayUrl;

  /** Lo último que dijo el servidor (con o sin ajustes); vacío si no contestó. */
  private readonly servidor = signal<AjustesPortal | undefined>(undefined);
  /** El puente no contestó al arrancar (apagado, sin sesión, ruta inexistente). */
  readonly fallo = signal(false);
  /** Hubo cambios que solo se ven al recargar. */
  readonly pendienteRecarga = signal(false);
  /**
   * Lo que se cambió en esta sesión (encendido y modo por id), para que las
   * pantallas lo reflejen al instante aunque los adaptadores esperen a la
   * recarga.
   */
  readonly encendidasEnSesion = signal<Record<string, boolean>>({});
  readonly modosEnSesion = signal<Record<string, 'gateway' | 'demo'>>({});

  /** El servidor tiene ajustes guardados y por eso mandan sobre lo local. */
  readonly usaServidor = computed(() => servidorTieneAjustes(this.servidor()));

  private readonly efectivos = computed(() => {
    const s = this.servidor();
    if (servidorTieneAjustes(s)) {
      return s;
    }
    const l = this.local.settings();
    return {
      cuentasApagadas: l.accountEnabled,
      modos: l.connectionMode as AjustesPortal['modos'],
      buzonesAgregados: l.accounts,
      buzonesQuitados: l.removedAccounts,
      actualizadoEn: '',
      actualizadoPor: ''
    } satisfies AjustesPortal;
  });

  readonly cuentasApagadas = computed(() => this.efectivos().cuentasApagadas);
  readonly modos = computed(() => this.efectivos().modos);
  readonly buzonesAgregados = computed(() => this.efectivos().buzonesAgregados);
  readonly buzonesQuitados = computed(() => this.efectivos().buzonesQuitados);

  /** Quién y cuándo cambió los ajustes compartidos por última vez, si hay. */
  readonly ultimoCambio = computed(() => {
    const s = this.servidor();
    return servidorTieneAjustes(s)
      ? { en: s.actualizadoEn, por: s.actualizadoPor }
      : undefined;
  });

  /**
   * Qué hacer con lo que el navegador trae: subirlo (el servidor está
   * vacío) o descartarlo (el servidor ya tiene ajustes y mandan esos). Solo
   * para quien administra, y solo si el servidor contestó.
   */
  readonly migracion = computed<Migracion | undefined>(() => {
    if (
      !this.conPuente ||
      !this.servidor() ||
      this.fallo() ||
      this.localesResueltos()
    ) {
      return undefined;
    }
    if (!this.puedeAdministrar() || !hayAjustesLocales(this.local.settings())) {
      return undefined;
    }
    return this.usaServidor() ? 'descartar' : 'subir';
  });

  /** Lo del navegador ya se subió o se descartó en esta sesión. */
  private readonly localesResueltos = signal(false);
  /** El primer guardado subió solo lo que este navegador traía. */
  readonly subidoAlGuardar = signal(false);

  readonly migrando = signal(false);
  readonly errorMigracion = signal<string | undefined>(undefined);

  isAdded(accountId: string): boolean {
    return this.buzonesAgregados().some((a) => a.id === accountId);
  }

  /** Pide los ajustes al servidor; al arrancar, antes de armar los adaptadores. */
  async cargarInicial(): Promise<AjustesPortal | undefined> {
    if (!this.conPuente) {
      return undefined;
    }
    try {
      const raw = await firstValueFrom(
        this.http.get<unknown>(`${this.config.gatewayUrl}/ajustes-portal`)
      );
      const ajustes = normalizarAjustes(raw);
      if (!ajustes) {
        this.fallo.set(true);
        return undefined;
      }
      this.servidor.set(ajustes);
      return servidorTieneAjustes(ajustes) ? ajustes : undefined;
    } catch {
      // Sin ajustes del servidor se arranca con lo local, como antes.
      this.fallo.set(true);
      return undefined;
    }
  }

  setAccountEnabled(accountId: string, enabled: boolean): Observable<void> {
    return this.guardar({ cuentaEnabled: { id: accountId, enabled } }, () =>
      this.local.setAccountEnabled(accountId, enabled)
    ).pipe(
      tap(() =>
        this.encendidasEnSesion.update((e) => ({ ...e, [accountId]: enabled }))
      )
    );
  }

  setConnectionMode(
    connectionId: string,
    modo: 'demo' | 'gateway'
  ): Observable<void> {
    return this.guardar({ modo: { id: connectionId, modo } }, () =>
      this.local.setConnectionMode(connectionId, modo)
    ).pipe(
      tap(() =>
        this.modosEnSesion.update((m) => ({ ...m, [connectionId]: modo }))
      )
    );
  }

  /**
   * Da de alta un buzón. `taken` son los ids que ya existen; los buzones
   * quitados cuentan como ocupados para no reutilizar su id.
   */
  addMailAccount(
    input: NewMailAccount,
    taken: ReadonlySet<string>
  ): Observable<Account> {
    if (!this.conPuente) {
      return defer(() => of(this.local.addMailAccount(input, taken))).pipe(
        tap(() => this.pendienteRecarga.set(true))
      );
    }
    const ocupados = new Set([
      ...taken,
      ...this.buzonesAgregados().map((a) => a.id),
      ...this.buzonesQuitados()
    ]);
    const account: Account = {
      id: accountIdFor(input.label, ocupados),
      label: input.label.trim(),
      detail: `${input.email.trim()} · ${describirTipo(input.kind)}`,
      kind: input.kind,
      color: input.color,
      enabled: true
    };
    return this.guardar({ agregarBuzon: account }, () => undefined).pipe(
      map(() => account)
    );
  }

  /** Quita un buzón: si es de fábrica queda marcado como quitado. */
  removeAccount(accountId: string): Observable<void> {
    return this.guardar({ quitarBuzon: accountId }, () =>
      this.local.removeAccount(accountId)
    );
  }

  /**
   * Sube al servidor lo que el navegador traía y limpia esos campos de
   * `localStorage` (las licencias se quedan). Quien llama recarga al terminar.
   * Es el único camino que manda lo local: nunca se hace solo.
   */
  subirLocales(): Observable<void> {
    return defer(() => {
      this.migrando.set(true);
      this.errorMigracion.set(undefined);
      return this.admin
        .guardarAjustesPortal({
          ajustes: ajustesParaSubir(this.local.settings())
        })
        .pipe(
          tap((nuevo) => this.recibir(nuevo)),
          tap(() => this.limpiarLocales()),
          map(() => undefined)
        );
    });
  }

  /** Tira lo que el navegador traía (el servidor ya tiene ajustes). */
  descartarLocales(): void {
    this.limpiarLocales();
  }

  private limpiarLocales(): void {
    // Las licencias se quedan; solo se vacían cuentas y modos.
    this.local.clearAccountSettings();
    this.localesResueltos.set(true);
  }

  private puedeAdministrar(): boolean {
    return !!(this.sesion.token() || this.admin.token());
  }

  /**
   * Con puente, escribe al servidor y actualiza las señales con lo que
   * contesta; sin puente, hace lo de siempre en `localStorage`. Los guardados
   * van uno tras otro: el primero contra un servidor vacío sube lo local, y
   * los que siguen ya ven al servidor con ajustes y mandan solo su parche.
   */
  private guardar(
    parche: ParcheAjustes,
    alLocal: () => void
  ): Observable<void> {
    if (!this.conPuente) {
      return defer(() => {
        alLocal();
        this.pendienteRecarga.set(true);
        return of(undefined);
      });
    }
    return this.enCola(() => {
      const servidorVacio = !!this.servidor() && !this.usaServidor();
      const { cuerpo, subeLocal } = cuerpoDeGuardado(
        servidorVacio,
        this.local.settings(),
        parche
      );
      return this.admin.guardarAjustesPortal(cuerpo).pipe(
        tap((nuevo) => {
          this.recibir(nuevo);
          if (subeLocal) {
            this.limpiarLocales();
            this.subidoAlGuardar.set(true);
          }
        }),
        map(() => undefined)
      );
    });
  }

  private cola: Promise<unknown> = Promise.resolve();

  private enCola<T>(trabajo: () => Observable<T>): Observable<T> {
    return defer(() => {
      const turno = this.cola.then(() => firstValueFrom(trabajo()));
      this.cola = turno.catch(() => undefined);
      return from(turno);
    });
  }

  private recibir(nuevo: AjustesPortal): void {
    const ajustes = normalizarAjustes(nuevo);
    const actual = this.servidor();
    // Dos guardados seguidos pueden contestar al revés: gana el más nuevo.
    if (ajustes && ajustes.actualizadoEn >= (actual?.actualizadoEn ?? '')) {
      this.servidor.set(ajustes);
      this.fallo.set(false);
    }
    this.pendienteRecarga.set(true);
  }
}

function describirTipo(kind: Account['kind']): string {
  switch (kind) {
    case 'google':
      return 'Google';
    case 'microsoft':
      return 'Microsoft 365';
    case 'imap':
      return 'IMAP';
    default:
      return kind;
  }
}
