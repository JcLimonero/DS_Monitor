import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal
} from '@angular/core';
import {
  claseTono,
  estadoRenovacion
} from '../../../core/licencias/licencias.util';
import {
  LICENSE_PROVIDER_LABEL,
  LICENSE_UNIT_LABEL,
  LicenseUsage,
  daysToRenewal,
  usagePercent
} from '../../../core/models';
import {
  RENEWAL_WARN_DAYS,
  licensesNeedingAttention
} from '../../../core/state/portal.selectors';
import { PortalStore } from '../../../core/state/portal.store';
import { LICENSE_SOURCES } from '../../../core/sources/source.contracts';
import { plural } from '../../../core/util/text.util';
import { IconComponent } from '../../../ui/icon.component';
import { LicenciasMigracionComponent } from '../../../ui/licencias-migracion.component';
import { LicenciaAltaComponent } from '../../../ui/licencia-alta.component';
import { LicenciaRenovacionComponent } from '../../../ui/licencia-renovacion.component';
import { DiapositivaConContenido } from '../carrusel.model';

const CANTIDAD = new Intl.NumberFormat('es-MX', {
  notation: 'compact',
  maximumFractionDigits: 1
});
const MONTO = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });

/** Clase en <html> mientras el dialogo esta abierto (ver styles.scss). */
const CLASE_DIALOGO = 'con-dialogo';

/** Consumo de las suscripciones: cuánto se lleva usado y qué renueva pronto. */
@Component({
  selector: 'pt-slide-licencias',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IconComponent,
    LicenciaAltaComponent,
    LicenciaRenovacionComponent,
    LicenciasMigracionComponent
  ],
  host: {
    class: 'flex h-full flex-col gap-2',
    '(document:keydown.escape)': 'cerrar()'
  },
  template: `
    <div class="tv-rejilla" style="--tv-min: 15rem">
      @for (licencia of licencias(); track licencia.id) {
        <article
          class="tv-card flex min-h-[44px] min-w-0 cursor-pointer items-center gap-2 px-3 py-1.5 transition hover:border-brand/60 hover:bg-surface-muted"
          [class.border-warn]="renuevaPronto(licencia)"
          role="button"
          tabindex="0"
          aria-haspopup="dialog"
          [attr.aria-label]="'Confirmar renovación de ' + licencia.product"
          (click)="abrir(licencia)"
          (keydown.enter)="abrir(licencia)"
          (keydown.space)="abrir(licencia); $event.preventDefault()">
          <div class="min-w-0 flex-1">
            <p class="tv-nombre line-clamp-2">{{ licencia.product }}</p>
            <p
              class="tv-dato flex items-start gap-1"
              [class]="claseRenovacion(licencia)">
              @if (renuevaPronto(licencia)) {
                <pt-icon name="alerta" class="mt-0.5 h-3.5 w-3.5 shrink-0" />
              } @else if (renovada(licencia)) {
                <pt-icon name="ok" class="mt-0.5 h-3.5 w-3.5 shrink-0" />
              }
              <span class="min-w-0">{{ renovacion(licencia) }}</span>
            </p>
          </div>
          <div class="max-w-[50%] shrink-0 break-words text-right">
            <p class="text-base font-bold tabular-nums leading-tight text-ink">
              {{
                licencia.cost !== undefined || licencia.unit !== 'dinero'
                  ? consumo(licencia)
                  : '—'
              }}
            </p>
            @if (licencia.limit) {
              <p class="tv-dato tabular-nums" [class]="claseTexto(licencia)">
                {{ porcentaje(licencia) }}% del tope
              </p>
            } @else {
              <p class="tv-dato truncate !text-ink-subtle">
                {{ proveedor(licencia) }}
              </p>
            }
          </div>
        </article>
      }
    </div>

    <div
      class="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1 rounded-xl border border-line bg-surface px-3 py-1.5">
      <p class="flex items-baseline gap-2">
        <span class="tv-label">Gasto del periodo</span>
        <span class="text-2xl font-bold tabular-nums text-info">{{
          gasto()
        }}</span>
      </p>
      <p
        class="tv-row flex items-center gap-2"
        [class.text-warn]="conAviso().length > 0">
        @if (conAviso().length > 0) {
          <pt-icon name="alerta" class="h-5 w-5" />
        } @else {
          <pt-icon name="ok" class="h-5 w-5 text-ok" />
        }
        {{ textoAvisos() }}
      </p>
      <!--
        A la derecha y por encima (z-35) de los controles flotantes (z-30) y de las
        esquinas del kiosco, que son
        zonas de clic pegadas a los lados y taparian el boton. 44 px de alto:
        es un iPad, se toca con el dedo.
      -->
      <div
        class="relative z-[35] ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
        <pt-licencias-migracion [compacto]="true" />
        <button
          type="button"
          class="btn !h-[44px]"
          aria-haspopup="dialog"
          (click)="abrirAlta()">
          + Agregar licencia
        </button>
      </div>
    </div>

    <!--
      La confirmación de renovación (o el alta), encima del carrusel y de sus
      controles: igual que el detalle de un pendiente. En celular y iPad
      vertical es una hoja completa; desde lg, una ventana centrada. Clic
      fuera, Escape o el botón la cierran, y mientras está abierta el carrusel
      no avanza (enDialogo).
    -->
    @if (dialogoAbierto()) {
      <div
        class="dialogo-carrusel fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-0 md:items-center md:p-6"
        (click)="cerrar()">
        <div
          class="card flex h-full w-full max-w-xl flex-col rounded-none md:h-auto md:max-h-[90dvh] md:rounded-xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dialogo-licencia-titulo"
          (click)="$event.stopPropagation()">
          <header
            class="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2 md:px-5">
            <h2
              id="dialogo-licencia-titulo"
              class="text-sm font-semibold text-ink">
              {{ seleccionada() ? '¿Ya se renovó?' : 'Agregar una licencia' }}
            </h2>
            <button
              type="button"
              class="ml-auto flex h-11 w-11 items-center justify-center rounded-lg text-ink-subtle hover:bg-surface-muted hover:text-ink"
              aria-label="Cerrar"
              (click)="cerrar()">
              <pt-icon name="cerrar" class="h-5 w-5" />
            </button>
          </header>
          <div class="min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
            @if (seleccionada(); as licencia) {
              <pt-licencia-renovacion
                [licencia]="licencia"
                (cerrar)="cerrar()"
                (hecho)="cerrar()" />
            } @else {
              <pt-licencia-alta (cerrar)="cerrar()" (hecho)="cerrar()" />
            }
          </div>
        </div>
      </div>
    }
  `
})
export class LicenciasSlideComponent implements DiapositivaConContenido {
  private readonly store = inject(PortalStore);
  /**
   * Cada proveedor es un kind distinto (Anthropic, Cursor, dominios, buzones…).
   * Hay que esperarlos todos.
   */
  private readonly licenciasFuente = inject(LICENSE_SOURCES);
  private readonly destroyRef = inject(DestroyRef);

  /** La licencia que se esta confirmando como renovada (clic en su tarjeta). */
  readonly seleccionada = signal<LicenseUsage | undefined>(undefined);
  readonly altaAbierta = signal(false);
  readonly dialogoAbierto = computed(
    () => !!this.seleccionada() || this.altaAbierta()
  );

  /** El carrusel no avanza mientras alguien confirma o agrega una licencia. */
  readonly enDialogo = this.dialogoAbierto;

  constructor() {
    // Si el carrusel cambia de diapositiva con el dialogo abierto, la clase no se queda pegada.
    this.destroyRef.onDestroy(() =>
      document.documentElement.classList.remove(CLASE_DIALOGO)
    );
  }

  abrir(licencia: LicenseUsage): void {
    this.altaAbierta.set(false);
    this.seleccionada.set(licencia);
    // En celular el carrusel achica la raiz; con el dialogo abierto vuelve al
    // tamaño normal (ver styles.scss).
    document.documentElement.classList.add(CLASE_DIALOGO);
  }

  abrirAlta(): void {
    this.seleccionada.set(undefined);
    this.altaAbierta.set(true);
    document.documentElement.classList.add(CLASE_DIALOGO);
  }

  cerrar(): void {
    if (!this.dialogoAbierto()) {
      return;
    }
    this.seleccionada.set(undefined);
    this.altaAbierta.set(false);
    document.documentElement.classList.remove(CLASE_DIALOGO);
  }

  readonly vacia = computed(() => {
    for (const kind of new Set(
      this.licenciasFuente.map((fuente) => fuente.kind)
    )) {
      if (!this.store.fuenteContestada(kind)) {
        return false;
      }
    }
    return this.store.licenses().length === 0;
  });

  /** Todas, lo que necesita atención primero; la rejilla hace scroll. */
  readonly licencias = computed(() => {
    const avisadas = new Set(this.conAviso().map((licencia) => licencia.id));
    return [...this.store.licenses()].sort(
      (a, b) =>
        Number(avisadas.has(b.id)) - Number(avisadas.has(a.id)) ||
        (a.renewsAt ?? '9').localeCompare(b.renewsAt ?? '9') ||
        usagePercent(b) - usagePercent(a)
    );
  });

  readonly conAviso = computed(() =>
    licensesNeedingAttention(this.store.licenses())
  );

  /**
   * El gasto sumado por moneda: "$12,400 MXN · $310 USD". Sumar monedas
   * distintas daria un numero sin sentido, asi que cada una va aparte.
   */
  readonly gasto = computed(() => {
    const porMoneda = new Map<string, number>();
    for (const licencia of this.store.licenses()) {
      if (licencia.cost === undefined) {
        continue;
      }
      const moneda = licencia.currency ?? 'MXN';
      porMoneda.set(moneda, (porMoneda.get(moneda) ?? 0) + licencia.cost);
    }
    if (porMoneda.size === 0) {
      return '—';
    }
    return [...porMoneda.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([moneda, monto]) => `$${MONTO.format(monto)} ${moneda}`)
      .join(' · ');
  });

  readonly textoAvisos = computed(() =>
    this.conAviso().length === 0
      ? 'Ninguna licencia cerca del tope ni por renovar'
      : `${plural(this.conAviso().length, 'licencia')} por revisar`
  );

  proveedor(licencia: LicenseUsage): string {
    return LICENSE_PROVIDER_LABEL[licencia.provider];
  }

  porcentaje(licencia: LicenseUsage): number {
    return usagePercent(licencia);
  }

  consumo(licencia: LicenseUsage): string {
    if (licencia.unit === 'dinero') {
      return `${MONTO.format(licencia.used)} ${licencia.currency ?? ''}`.trim();
    }
    return `${CANTIDAD.format(licencia.used)} ${LICENSE_UNIT_LABEL[licencia.unit]}`;
  }

  claseBarra(licencia: LicenseUsage): string {
    const porcentaje = this.porcentaje(licencia);
    if (porcentaje >= 95) {
      return 'bg-danger';
    }
    return porcentaje >= 80 ? 'bg-warn' : 'bg-accent';
  }

  claseTexto(licencia: LicenseUsage): string {
    const porcentaje = this.porcentaje(licencia);
    if (porcentaje >= 95) {
      return 'text-danger';
    }
    return porcentaje >= 80 ? 'text-warn' : 'text-ink-muted';
  }

  renuevaPronto(licencia: LicenseUsage): boolean {
    const dias = daysToRenewal(licencia);
    return dias !== undefined && dias <= RENEWAL_WARN_DAYS;
  }

  renovacion(licencia: LicenseUsage): string {
    return estadoRenovacion(licencia).corto;
  }

  renovada(licencia: LicenseUsage): boolean {
    return estadoRenovacion(licencia).tipo === 'confirmada';
  }

  claseRenovacion(licencia: LicenseUsage): string {
    const estado = estadoRenovacion(licencia);
    return estado.tono === 'neutro'
      ? 'text-ink-muted'
      : `${claseTono(estado.tono)} font-bold`;
  }
}
