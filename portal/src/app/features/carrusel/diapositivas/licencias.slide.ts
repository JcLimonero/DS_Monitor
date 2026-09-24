import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject
} from '@angular/core';
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
import { DiapositivaConContenido } from '../carrusel.model';

const CANTIDAD = new Intl.NumberFormat('es-MX', {
  notation: 'compact',
  maximumFractionDigits: 1
});
const MONTO = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });

/** Cuantas licencias caben en la rejilla sin apretarlas. */
/**
 * Cuantas caben: tres columnas de renglones compactos. Con decenas de
 * suscripciones y dominios, seis tarjetas grandes escondian el resto.
 */
const RENGLONES = 24;

/** Consumo de las suscripciones: cuánto se lleva usado y qué renueva pronto. */
@Component({
  selector: 'pt-slide-licencias',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'flex h-full flex-col gap-4' },
  template: `
    <div
      class="grid min-h-0 flex-1 auto-rows-min grid-cols-2 content-start gap-x-4 gap-y-2 overflow-y-auto xl:grid-cols-3">
      @for (licencia of licencias(); track licencia.id) {
        <article
          class="tv-card flex items-center gap-4 px-4 py-2.5"
          [class.border-warn]="renuevaPronto(licencia)">
          <div class="min-w-0 flex-1">
            <p
              class="truncate text-lg font-bold leading-tight text-ink 2xl:text-xl">
              {{ licencia.product }}
            </p>
            <p
              class="flex items-center gap-1.5 truncate text-sm 2xl:text-base"
              [class]="claseRenovacion(licencia)">
              @if (renuevaPronto(licencia)) {
                <pt-icon name="alerta" class="h-4 w-4 shrink-0" />
              }
              {{ renovacion(licencia) }}
            </p>
          </div>
          <div class="shrink-0 text-right">
            <p
              class="text-lg font-bold tabular-nums leading-tight text-ink 2xl:text-xl">
              {{
                licencia.cost !== undefined || licencia.unit !== 'dinero'
                  ? consumo(licencia)
                  : '—'
              }}
            </p>
            @if (licencia.limit) {
              <p class="text-sm tabular-nums" [class]="claseTexto(licencia)">
                {{ porcentaje(licencia) }}% del tope
              </p>
            } @else {
              <p class="truncate text-sm text-ink-subtle">
                {{ proveedor(licencia) }}
              </p>
            }
          </div>
        </article>
      }
    </div>

    <div
      class="flex shrink-0 flex-wrap items-center gap-x-8 gap-y-2 rounded-2xl border border-line bg-surface px-6 py-3">
      <p class="flex items-baseline gap-3">
        <span class="tv-label">Gasto del periodo</span>
        <span class="text-3xl font-bold tabular-nums text-info 2xl:text-4xl">{{
          gasto()
        }}</span>
      </p>
      <p
        class="ml-auto flex items-center gap-3 tv-row"
        [class.text-warn]="conAviso().length > 0">
        @if (conAviso().length > 0) {
          <pt-icon name="alerta" class="h-7 w-7" />
        } @else {
          <pt-icon name="ok" class="h-7 w-7 text-ok" />
        }
        {{ textoAvisos() }}
      </p>
    </div>
  `
})
export class LicenciasSlideComponent implements DiapositivaConContenido {
  private readonly store = inject(PortalStore);
  /**
   * Cada proveedor es un kind distinto (Anthropic, Cursor, dominios, buzones…).
   * Hay que esperarlos todos.
   */
  private readonly licenciasFuente = inject(LICENSE_SOURCES);

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

  /** Lo que necesita atención se ve primero. */
  readonly licencias = computed(() => {
    const avisadas = new Set(this.conAviso().map((licencia) => licencia.id));
    return [...this.store.licenses()]
      .sort(
        (a, b) =>
          Number(avisadas.has(b.id)) - Number(avisadas.has(a.id)) ||
          (a.renewsAt ?? '9').localeCompare(b.renewsAt ?? '9') ||
          usagePercent(b) - usagePercent(a)
      )
      .slice(0, RENGLONES);
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
    const dias = daysToRenewal(licencia);
    if (dias === undefined) {
      return 'Sin fecha de renovación';
    }
    if (dias < 0) {
      return 'Renovación vencida';
    }
    if (dias === 0) {
      return 'Renueva hoy';
    }
    return `Renueva en ${plural(dias, 'día')}`;
  }

  claseRenovacion(licencia: LicenseUsage): string {
    return this.renuevaPronto(licencia)
      ? 'text-warn font-bold'
      : 'text-ink-muted';
  }
}
