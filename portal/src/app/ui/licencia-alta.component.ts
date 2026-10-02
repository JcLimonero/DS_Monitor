import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NewManualLicense } from '../core/config/local-settings.store';
import { PORTAL_CONFIG } from '../core/config/portal-config.token';
import { LicenciasService } from '../core/licencias/licencias.service';
import { ymdAIso } from '../core/licencias/licencias.util';
import {
  LICENSE_PROVIDER_LABEL,
  LicenseProvider,
  ManualLicense,
  ManualLicensePeriod
} from '../core/models';
import { DialogoComponent } from './dialogo.component';
import { IconComponent } from './icon.component';

/**
 * El formulario de alta de una licencia que no llega por ninguna fuente. Lo
 * usan Integraciones → Licencias, el módulo Licencias y el carrusel: todos
 * guardan por `LicenciasService`, así que la licencia queda en el puente y la
 * ven todos los dispositivos.
 */
@Component({
  selector: 'pt-licencia-alta',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent],
  template: `
    <form class="grid gap-3 sm:grid-cols-2" (ngSubmit)="agregar()">
      <label class="sm:col-span-2">
        <span class="mb-1 block text-xs font-medium text-ink-muted"
          >Producto</span
        >
        <input
          class="field"
          type="text"
          name="producto"
          maxlength="80"
          placeholder="Por ejemplo: Claude Max"
          [ngModel]="producto()"
          (ngModelChange)="producto.set($event)" />
      </label>
      <label>
        <span class="mb-1 block text-xs font-medium text-ink-muted"
          >Proveedor</span
        >
        <select
          class="field"
          name="proveedor"
          [ngModel]="proveedor()"
          (ngModelChange)="proveedor.set($event)">
          @for (opcion of proveedores; track opcion) {
            <option [value]="opcion">{{ etiqueta[opcion] }}</option>
          }
        </select>
      </label>
      <label>
        <span class="mb-1 block text-xs font-medium text-ink-muted"
          >Cuenta</span
        >
        <select
          class="field"
          name="cuenta"
          [ngModel]="cuenta()"
          (ngModelChange)="cuenta.set($event)">
          <option value="">Elige una cuenta</option>
          @for (c of cuentas(); track c.id) {
            <option [value]="c.id">{{ c.label }}</option>
          }
        </select>
      </label>
      <label>
        <span class="mb-1 block text-xs font-medium text-ink-muted">Costo</span>
        <input
          class="field"
          type="number"
          step="0.01"
          min="0"
          name="costo"
          inputmode="decimal"
          [ngModel]="costo()"
          (ngModelChange)="costo.set($event)" />
      </label>
      <label>
        <span class="mb-1 block text-xs font-medium text-ink-muted"
          >Moneda</span
        >
        <input
          class="field"
          type="text"
          name="moneda"
          maxlength="3"
          autocapitalize="characters"
          [ngModel]="moneda()"
          (ngModelChange)="moneda.set($event)" />
      </label>
      <label>
        <span class="mb-1 block text-xs font-medium text-ink-muted"
          >Periodo</span
        >
        <select
          class="field"
          name="periodo"
          [ngModel]="periodo()"
          (ngModelChange)="periodo.set($event)">
          <option value="mensual">Mensual</option>
          <option value="anual">Anual</option>
          <option value="otro">Otro</option>
        </select>
      </label>
      <label>
        <span class="mb-1 block text-xs font-medium text-ink-muted"
          >Renueva el</span
        >
        <input
          class="field"
          type="date"
          name="renueva"
          [ngModel]="renueva()"
          (ngModelChange)="renueva.set($event)" />
      </label>
      <label class="sm:col-span-2">
        <span class="mb-1 block text-xs font-medium text-ink-muted"
          >Plan o nota</span
        >
        <input
          class="field"
          type="text"
          name="plan"
          maxlength="80"
          placeholder="Por ejemplo: plan personal, 1 asiento"
          [ngModel]="plan()"
          (ngModelChange)="plan.set($event)" />
      </label>
      <label class="sm:col-span-2">
        <span class="mb-1 block text-xs font-medium text-ink-muted"
          >Liga (opcional)</span
        >
        <input
          class="field"
          type="url"
          name="url"
          placeholder="https://"
          [ngModel]="url()"
          (ngModelChange)="url.set($event)" />
      </label>

      @if (error(); as e) {
        <p
          class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900 sm:col-span-2 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200"
          role="alert">
          {{ e }}
        </p>
      }

      <div class="flex flex-wrap items-center gap-2 sm:col-span-2">
        <button
          type="submit"
          class="btn btn-primary"
          [disabled]="guardando() || !puede()">
          <pt-icon name="mas" class="h-4 w-4" />
          Agregar licencia
        </button>
        <button type="button" class="btn" (click)="cerrar.emit()">
          Cancelar
        </button>
      </div>
    </form>
  `
})
export class LicenciaAltaComponent {
  private readonly service = inject(LicenciasService);
  private readonly config = inject(PORTAL_CONFIG);

  /** Cancelar. */
  readonly cerrar = output<void>();
  /** La licencia ya quedó guardada. */
  readonly hecho = output<ManualLicense>();

  readonly etiqueta = LICENSE_PROVIDER_LABEL;
  readonly proveedores: LicenseProvider[] = [
    'otro',
    'anthropic',
    'cursor',
    'figma',
    'vercel'
  ];
  /** Cuentas a las que se puede colgar una licencia capturada a mano. */
  readonly cuentas = computed(() =>
    this.config.accounts.filter((cuenta) => cuenta.enabled)
  );

  readonly producto = signal('');
  readonly proveedor = signal<LicenseProvider>('otro');
  readonly cuenta = signal('');
  readonly costo = signal<number | string | null>(null);
  readonly moneda = signal('MXN');
  readonly periodo = signal<ManualLicensePeriod>('mensual');
  readonly renueva = signal('');
  readonly plan = signal('');
  readonly url = signal('');
  readonly guardando = signal(false);
  readonly error = signal<string | undefined>(undefined);

  readonly puede = computed(
    () => this.producto().trim().length > 0 && this.cuenta().length > 0
  );

  agregar(): void {
    if (!this.puede() || this.guardando()) {
      return;
    }
    const texto = String(this.costo() ?? '').trim();
    const costo = texto === '' ? undefined : Number(texto);
    if (costo !== undefined && (!Number.isFinite(costo) || costo < 0)) {
      this.error.set('El costo debe ser un número de 0 en adelante.');
      return;
    }
    const moneda = this.moneda().trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(moneda)) {
      this.error.set('La moneda es de 3 letras, por ejemplo MXN.');
      return;
    }
    const alta: NewManualLicense = {
      product: this.producto().trim(),
      provider: this.proveedor(),
      accountId: this.cuenta(),
      plan: this.plan().trim() || undefined,
      cost: costo,
      currency: moneda,
      period: this.periodo(),
      renewsAt: this.renueva() ? ymdAIso(this.renueva()) : undefined,
      url: this.url().trim() || undefined
    };
    this.guardando.set(true);
    this.error.set(undefined);
    this.service.guardarManual(alta).subscribe({
      next: (licencia) => {
        this.guardando.set(false);
        this.hecho.emit(licencia);
      },
      error: (e: unknown) => {
        this.guardando.set(false);
        const http = e as { error?: { error?: string }; message?: string };
        this.error.set(
          http?.error?.error ?? http?.message ?? 'No se pudo guardar.'
        );
      }
    });
  }
}

/** El alta en el diálogo estándar del portal (no el del carrusel). */
@Component({
  selector: 'pt-licencia-alta-dialogo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogoComponent, LicenciaAltaComponent],
  template: `
    <pt-dialogo titulo="Agregar una licencia a mano" (cerrar)="cerrar.emit()">
      <pt-licencia-alta (cerrar)="cerrar.emit()" (hecho)="cerrar.emit()" />
    </pt-dialogo>
  `
})
export class LicenciaAltaDialogoComponent {
  readonly cerrar = output<void>();
}
