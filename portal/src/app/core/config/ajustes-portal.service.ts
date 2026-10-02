import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, defer, firstValueFrom, from, map, of, tap } from 'rxjs';
import { SesionService } from '../acceso/sesion.service';
import { Account, AjustesPortal } from '../models';
import { PuenteAdminService } from '../sources/gateway/puente-admin.service';
import {
  ParcheAjustes,
  conSoloOmitidos,
  cuerpoDeGuardado,
  documentoVacio,
  normalizarAjustes,
  parchesDeFusion,
  prepararSubida,
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
  /** El puente es viejo y no tiene `/ajustes-portal` (404): se guarda en local. */
  readonly sinSoporte = signal(false);
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
    if (!this.puedeAdministrar() || !this.hayParaSubir()) {
      return undefined;
    }
    return this.usaServidor() ? 'descartar' : 'subir';
  });

  /** Hay algo en el navegador que el servidor sí aceptaría. */
  private readonly hayParaSubir = computed(
    () => !documentoVacio(prepararSubida(this.local.settings()).documento)
  );

  /**
   * Lo del navegador que no se puede subir (ids no válidos, modo local, tipos
   * que el puente no acepta): se queda aquí y se avisa, hasta que alguien lo
   * descarte. Solo para quien administra con el servidor a la mano.
   */
  readonly noSubidos = computed(() => {
    if (
      !this.conPuente ||
      !this.servidor() ||
      this.fallo() ||
      !this.puedeAdministrar()
    ) {
      return undefined;
    }
    const { omitidos } = prepararSubida(this.local.settings());
    return omitidos.total > 0
      ? { total: omitidos.total, motivos: omitidos.motivos }
      : undefined;
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
      this.fallo.set(false);
      this.sinSoporte.set(false);
      return servidorTieneAjustes(ajustes) ? ajustes : undefined;
    } catch (error) {
      // Sin ajustes del servidor se arranca con lo local, como antes. Un 404
      // es un puente viejo (sin la ruta): se guarda en local como siempre.
      this.fallo.set(true);
      this.sinSoporte.set(
        error instanceof HttpErrorResponse && error.status === 404
      );
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
    if (this.usaLocal()) {
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
    return this.guardar({ agregarBuzon: account }, () =>
      this.local.addMailAccount(input, ocupados)
    ).pipe(map(() => account));
  }

  /** Quita un buzón: si es de fábrica queda marcado como quitado. */
  removeAccount(accountId: string): Observable<void> {
    return this.guardar({ quitarBuzon: accountId }, () =>
      this.local.removeAccount(accountId)
    );
  }

  /**
   * Sube al servidor lo que el navegador traía y limpia esos campos de
   * `localStorage` (las licencias se quedan, y también lo que el servidor no
   * acepta, que se avisa aparte). Quien llama recarga al terminar. Si otro
   * dispositivo subió primero (409), se fusiona con parches en vez de pisarlo.
   */
  subirLocales(): Observable<void> {
    return defer(() => {
      this.migrando.set(true);
      this.errorMigracion.set(undefined);
      return from(this.subirAsync());
    });
  }

  private async subirAsync(): Promise<void> {
    const { documento } = prepararSubida(this.local.settings());
    try {
      const nuevo = await firstValueFrom(
        this.admin.guardarAjustesPortal({ ajustes: documento })
      );
      this.recibir(nuevo);
    } catch (error) {
      if (estadoHttp(error) !== 409) {
        throw error;
      }
      await this.fusionar();
    }
    this.limpiarLocales(true);
  }

  /** Tira lo que el navegador traía (el servidor ya tiene ajustes). */
  descartarLocales(): void {
    this.limpiarLocales(false);
  }

  /** Tira lo que no se pudo subir (el aviso lo ofrece, nunca se hace solo). */
  descartarNoSubidos(): void {
    this.limpiarLocales(false);
  }

  private limpiarLocales(conservarNoSubidos: boolean): void {
    // Las licencias se quedan; solo se vacían cuentas y modos.
    this.local.clearAccountSettings(
      conservarNoSubidos
        ? conSoloOmitidos(
            this.local.settings(),
            prepararSubida(this.local.settings()).omitidos
          )
        : undefined
    );
    this.localesResueltos.set(true);
  }

  private puedeAdministrar(): boolean {
    return !!(this.sesion.token() || this.admin.token());
  }

  /** Sin puente, o con uno viejo que no tiene la ruta: todo en `localStorage`. */
  private usaLocal(): boolean {
    return !this.conPuente || this.sinSoporte();
  }

  /**
   * Con puente, escribe al servidor y actualiza las señales con lo que
   * contesta; sin puente (o con uno viejo), hace lo de siempre en
   * `localStorage`. Los guardados van uno tras otro: el primero contra un
   * servidor vacío sube lo local, y los que siguen ya ven al servidor con
   * ajustes y mandan solo su parche.
   */
  private guardar(
    parche: ParcheAjustes,
    alLocal: () => void
  ): Observable<void> {
    const enLocal = () => {
      alLocal();
      this.pendienteRecarga.set(true);
    };
    if (this.usaLocal()) {
      return defer(() => {
        enLocal();
        return of(undefined);
      });
    }
    return this.enCola(() => from(this.guardarEnServidor(parche, enLocal)));
  }

  private async guardarEnServidor(
    parche: ParcheAjustes,
    enLocal: () => void
  ): Promise<void> {
    // Sin lectura previa no se manda nada a ciegas: un parche podría esconder
    // lo que este navegador trae. Se reintenta la lectura una vez.
    if (!this.servidor()) {
      await this.cargarInicial();
      if (this.sinSoporte()) {
        enLocal();
        return;
      }
      if (!this.servidor()) {
        throw new Error(
          'No se pudo leer el servidor; intenta de nuevo en un momento.'
        );
      }
    }
    const { cuerpo, subeLocal } = cuerpoDeGuardado(
      !this.usaServidor(),
      this.local.settings(),
      parche
    );
    try {
      const nuevo = await firstValueFrom(
        this.admin.guardarAjustesPortal(cuerpo)
      );
      this.recibir(nuevo);
    } catch (error) {
      // Otro dispositivo subió primero: nada se pisa, se fusiona con parches.
      if (!subeLocal || estadoHttp(error) !== 409) {
        throw error;
      }
      await this.fusionar(parche);
    }
    if (subeLocal) {
      this.limpiarLocales(true);
      this.subidoAlGuardar.set(true);
    }
  }

  /**
   * El servidor ya tiene ajustes (de otro dispositivo): se vuelve a leer y se
   * manda, como parches sueltos, lo de este navegador que el servidor aún no
   * tiene (unión de buzones y quitados; en los mapas gana el servidor), y al
   * final el cambio que se estaba haciendo. Nunca un documento completo.
   */
  private async fusionar(parche?: ParcheAjustes): Promise<void> {
    await this.cargarInicial();
    const actual = this.servidor();
    if (!actual) {
      throw new Error(
        'No se pudo leer el servidor; intenta de nuevo en un momento.'
      );
    }
    const parches = [
      ...parchesDeFusion(actual, this.local.settings()),
      ...(parche ? [parche] : [])
    ];
    for (const p of parches) {
      this.recibir(
        await firstValueFrom(
          this.admin.guardarAjustesPortal({ ...p } as Record<string, unknown>)
        )
      );
    }
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

function estadoHttp(error: unknown): number | undefined {
  return error instanceof HttpErrorResponse ? error.status : undefined;
}
