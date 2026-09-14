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
} from '../../core/models';
import {
  RENEWAL_WARN_DAYS,
  licensesNeedingAttention,
  spendCurrency,
  totalSpend
} from '../../core/state/portal.selectors';
import { PortalStore } from '../../core/state/portal.store';
import { plural } from '../../core/util/text.util';
import { AccountChipComponent } from '../../ui/account-chip.component';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { IconComponent } from '../../ui/icon.component';
import { PageHeaderComponent } from '../../ui/page-header.component';
import { DayPipe, RelativePipe } from '../../ui/portal.pipes';

/** Formato compacto para cifras grandes de consumo, como los tokens. */
const CANTIDAD = new Intl.NumberFormat('es-MX', {
  notation: 'compact',
  maximumFractionDigits: 1
});
const DINERO = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });

@Component({
  selector: 'pt-licencias',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AccountChipComponent,
    DayPipe,
    EmptyStateComponent,
    IconComponent,
    PageHeaderComponent,
    RelativePipe
  ],
  templateUrl: './licencias.component.html'
})
export class LicenciasComponent {
  private readonly store = inject(PortalStore);

  readonly proveedorLabel = LICENSE_PROVIDER_LABEL;
  readonly unidadLabel = LICENSE_UNIT_LABEL;
  readonly diasAviso = RENEWAL_WARN_DAYS;

  /** Lo que necesita atención primero; el resto ordenado por proveedor. */
  readonly licencias = computed(() => {
    const conAviso = new Set(
      licensesNeedingAttention(this.store.licenses()).map((l) => l.id)
    );
    return [...this.store.licenses()].sort(
      (a, b) =>
        Number(conAviso.has(b.id)) - Number(conAviso.has(a.id)) ||
        a.provider.localeCompare(b.provider) ||
        a.product.localeCompare(b.product)
    );
  });

  readonly conAviso = computed(() =>
    licensesNeedingAttention(this.store.licenses())
  );
  readonly gasto = computed(() => totalSpend(this.store.licenses()));
  readonly moneda = computed(() => spendCurrency(this.store.licenses()));
  readonly manuales = computed(() =>
    this.store.licenses().filter((l) => l.manual)
  );

  readonly subtitle = computed(() => {
    const moneda = this.moneda();
    const gasto = moneda
      ? `${DINERO.format(this.gasto())} ${moneda} este periodo`
      : 'gasto en varias monedas';
    return [
      plural(this.store.licenses().length, 'licencia'),
      gasto,
      `${this.conAviso().length} con aviso`
    ].join(' · ');
  });

  porcentaje(licencia: LicenseUsage): number {
    return usagePercent(licencia);
  }

  /** Verde mientras haya holgura, ámbar al acercarse y rojo casi sin cupo. */
  claseBarra(licencia: LicenseUsage): string {
    const porcentaje = this.porcentaje(licencia);
    if (porcentaje >= 95) {
      return 'bg-danger';
    }
    return porcentaje >= 80 ? 'bg-warn' : 'bg-accent';
  }

  consumo(licencia: LicenseUsage): string {
    const unidad = this.unidadLabel[licencia.unit];
    if (licencia.unit === 'dinero') {
      const moneda = licencia.currency ?? '';
      return licencia.limit
        ? `${DINERO.format(licencia.used)} de ${DINERO.format(licencia.limit)} ${moneda}`
        : `${DINERO.format(licencia.used)} ${moneda}`;
    }
    return licencia.limit
      ? `${CANTIDAD.format(licencia.used)} de ${CANTIDAD.format(licencia.limit)} ${unidad}`
      : `${CANTIDAD.format(licencia.used)} ${unidad}`;
  }

  costo(licencia: LicenseUsage): string {
    if (licencia.cost === undefined) {
      return 'Sin costo reportado';
    }
    return `${DINERO.format(licencia.cost)} ${licencia.currency ?? ''}`.trim();
  }

  dias(licencia: LicenseUsage): number | undefined {
    return daysToRenewal(licencia);
  }

  /** True cuando la renovación ya entra en la ventana de aviso. */
  renuevaPronto(licencia: LicenseUsage): boolean {
    const dias = this.dias(licencia);
    return dias !== undefined && dias <= RENEWAL_WARN_DAYS;
  }

  inactivos(licencia: LicenseUsage): number {
    return licencia.members.filter((miembro) => !miembro.active).length;
  }

  cantidad(valor: number): string {
    return CANTIDAD.format(valor);
  }
}
