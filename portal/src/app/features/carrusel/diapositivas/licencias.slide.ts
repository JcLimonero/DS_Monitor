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
  licensesNeedingAttention,
  spendCurrency,
  totalSpend
} from '../../../core/state/portal.selectors';
import { PortalStore } from '../../../core/state/portal.store';
import { plural } from '../../../core/util/text.util';
import { IconComponent } from '../../../ui/icon.component';

const CANTIDAD = new Intl.NumberFormat('es-MX', {
  notation: 'compact',
  maximumFractionDigits: 1
});
const MONTO = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });

/** Cuantas licencias caben en la rejilla sin apretarlas. */
const RENGLONES = 6;

/** Consumo de las suscripciones: cuánto se lleva usado y qué renueva pronto. */
@Component({
  selector: 'pt-slide-licencias',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'flex h-full flex-col gap-4' },
  template: `
    <div class="grid min-h-0 flex-1 grid-cols-2 gap-4 xl:grid-cols-3">
      @for (licencia of licencias(); track licencia.id) {
        <article
          class="tv-card flex min-h-0 flex-col justify-center gap-4 px-5 py-4">
          <div class="min-w-0">
            <p class="truncate text-xl font-bold text-ink 2xl:text-2xl">
              {{ licencia.product }}
            </p>
            <p class="truncate text-base text-ink-muted">
              {{ proveedor(licencia) }}
              @if (licencia.manual) {
                · capturado a mano
              }
            </p>
          </div>

          <div>
            <p class="flex items-baseline justify-between gap-3">
              <span
                class="text-2xl font-bold tabular-nums text-ink 2xl:text-3xl">
                {{ consumo(licencia) }}
              </span>
              @if (licencia.limit) {
                <span
                  class="text-xl font-bold tabular-nums 2xl:text-2xl"
                  [class]="claseTexto(licencia)">
                  {{ porcentaje(licencia) }}%
                </span>
              }
            </p>
            @if (licencia.limit) {
              <span
                class="mt-2 block h-2.5 overflow-hidden rounded-full bg-surface-muted">
                <span
                  class="block h-full rounded-full"
                  [class]="claseBarra(licencia)"
                  [style.width.%]="porcentaje(licencia)"></span>
              </span>
            } @else {
              <p class="mt-2 text-base text-ink-subtle">sin tope contratado</p>
            }
          </div>

          <p
            class="flex items-center gap-2 text-lg 2xl:text-xl"
            [class]="claseRenovacion(licencia)">
            @if (renuevaPronto(licencia)) {
              <pt-icon name="alerta" class="h-5 w-5" />
            }
            {{ renovacion(licencia) }}
          </p>
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
export class LicenciasSlideComponent {
  private readonly store = inject(PortalStore);

  /** Lo que necesita atención se ve primero. */
  readonly licencias = computed(() => {
    const avisadas = new Set(this.conAviso().map((licencia) => licencia.id));
    return [...this.store.licenses()]
      .sort(
        (a, b) =>
          Number(avisadas.has(b.id)) - Number(avisadas.has(a.id)) ||
          usagePercent(b) - usagePercent(a)
      )
      .slice(0, RENGLONES);
  });

  readonly conAviso = computed(() =>
    licensesNeedingAttention(this.store.licenses())
  );

  readonly gasto = computed(() => {
    const moneda = spendCurrency(this.store.licenses());
    return moneda
      ? `${MONTO.format(totalSpend(this.store.licenses()))} ${moneda}`
      : 'varias monedas';
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
