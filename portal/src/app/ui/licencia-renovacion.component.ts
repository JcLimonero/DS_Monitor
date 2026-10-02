import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable, tap } from 'rxjs';
import { LicenciasService } from '../core/licencias/licencias.service';
import {
  claseTono,
  diaDe,
  estadoRenovacion,
  hoyYmd,
  sugerirProximaRenovacion,
  ymdAIso
} from '../core/licencias/licencias.util';
import { LICENSE_PROVIDER_LABEL, LicenseUsage } from '../core/models';
import { PortalStore } from '../core/state/portal.store';
import { DialogoComponent } from './dialogo.component';
import { DayPipe } from './portal.pipes';

/**
 * El contenido de "¿Ya se renovó?": confirma la renovación de una licencia con
 * su costo, moneda y la fecha de la siguiente, o solo corrige el costo o la
 * fecha. Lo comparten el módulo de Licencias, Integraciones y el carrusel, que
 * lo ponen cada quien en su propio diálogo (el del carrusel es un overlay que
 * pausa la rotación).
 */
@Component({
  selector: 'pt-licencia-renovacion',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DayPipe, DecimalPipe, FormsModule],
  template: `
    <div class="mb-4">
      <p class="text-base font-bold text-ink">{{ licencia().product }}</p>
      <p class="mt-0.5 text-sm text-ink-muted">
        {{ proveedor() }}
        @if (licencia().plan) {
          · {{ licencia().plan }}
        }
      </p>
      <p class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span [class]="clase()">{{ estado().texto }}</span>
        @if (licencia().renewsAt) {
          <span class="text-ink-muted">
            Fecha actual: {{ licencia().renewsAt | dia }}
          </span>
        }
      </p>
      @if (licencia().renewedAt; as confirmada) {
        <p class="mt-1 text-xs text-ink-subtle">
          Última confirmación: {{ confirmada | dia }}
          @if (licencia().renewalConfirmedBy; as por) {
            · {{ por }}
          }
        </p>
      }
    </div>

    @if (soloLocal()) {
      <p
        class="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
        role="status">
        Esta licencia solo está en este navegador. Primero sube lo capturado
        aquí al servidor (aviso en Licencias) y luego confirma la renovación.
      </p>
    }

    <form
      class="grid gap-3 sm:grid-cols-2"
      (ngSubmit)="renovar()"
      aria-label="Confirmar renovación">
      <label>
        <span class="mb-1 block text-xs font-medium text-ink-muted"
          >Costo de esta renovación</span
        >
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
          placeholder="MXN"
          [ngModel]="moneda()"
          (ngModelChange)="moneda.set($event)" />
      </label>
      <label class="sm:col-span-2">
        <span class="mb-1 block text-xs font-medium text-ink-muted"
          >Próxima renovación</span
        >
        <input
          class="field"
          type="date"
          name="renueva"
          [min]="hoy"
          [ngModel]="renuevaEn()"
          (ngModelChange)="renuevaEn.set($event)" />
        <span class="mt-1 block text-xs text-ink-subtle">
          Propuesta: {{ propuestaIso | dia }}, un periodo después de la fecha
          actual.
        </span>
      </label>
      <label class="sm:col-span-2">
        <span class="mb-1 block text-xs font-medium text-ink-muted"
          >Nota (opcional)</span
        >
        <input
          class="field"
          type="text"
          name="nota"
          maxlength="300"
          placeholder="Por ejemplo: factura 1234"
          [ngModel]="nota()"
          (ngModelChange)="nota.set($event)" />
      </label>

      @if (error(); as e) {
        <p
          class="sm:col-span-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200"
          role="alert">
          {{ e }}
        </p>
      }

      <div class="flex flex-wrap items-center gap-2 sm:col-span-2">
        <button
          type="submit"
          class="btn btn-primary"
          [disabled]="guardando() || !valida() || soloLocal()">
          Sí, ya se renovó
        </button>
        <button
          type="button"
          class="btn"
          [disabled]="guardando() || !valida() || soloLocal()"
          (click)="corregir()">
          Solo corregir costo o fecha
        </button>
        <button type="button" class="btn" (click)="cerrar.emit()">
          Cancelar
        </button>
      </div>
      <p class="text-xs text-ink-subtle sm:col-span-2">
        «Solo corregir» no registra la renovación: guarda el costo y la moneda
        y, si la cambiaste, la fecha.
      </p>
    </form>

    @if (historial().length > 0) {
      <div class="mt-4 border-t border-line pt-3">
        <p class="mb-2 text-xs font-bold text-ink">Confirmaciones recientes</p>
        <ul class="space-y-1.5">
          @for (h of historial(); track h.at) {
            <li class="text-xs text-ink-muted">
              <span class="font-semibold text-ink">{{ h.at | dia }}</span>
              · {{ h.by }}
              @if (h.cost !== undefined) {
                · {{ h.cost | number: '1.0-2' }} {{ h.currency }}
              }
              @if (h.renewsAt) {
                · próxima {{ h.renewsAt | dia }}
              }
              @if (h.note) {
                <span class="block text-ink-subtle">{{ h.note }}</span>
              }
            </li>
          }
        </ul>
      </div>
    }
  `
})
export class LicenciaRenovacionComponent implements OnInit {
  private readonly service = inject(LicenciasService);
  private readonly store = inject(PortalStore);

  readonly licencia = input.required<LicenseUsage>();
  /** Cancelar. */
  readonly cerrar = output<void>();
  /** Ya quedó guardado (renovada o corregida). */
  readonly hecho = output<void>();

  readonly costo = signal<number | string | null>(null);
  readonly moneda = signal('MXN');
  readonly renuevaEn = signal('');
  readonly nota = signal('');
  readonly guardando = signal(false);
  readonly error = signal<string | undefined>(undefined);

  readonly hoy = hoyYmd();
  protected propuesta = '';
  protected propuestaIso = '';

  readonly estado = computed(() => estadoRenovacion(this.licencia()));
  readonly clase = computed(() => `font-bold ${claseTono(this.estado().tono)}`);
  readonly proveedor = computed(
    () => LICENSE_PROVIDER_LABEL[this.licencia().provider]
  );

  /** Las últimas cinco, la más reciente arriba. */
  readonly historial = computed(() =>
    [...(this.service.ajustes()[this.licencia().id]?.history ?? [])]
      .slice(-5)
      .reverse()
  );

  readonly soloLocal = computed(() =>
    this.service.manualesSoloLocal().has(this.licencia().id)
  );

  readonly valida = computed(() => {
    const costo = this.costoNumero();
    const moneda = this.moneda().trim();
    return (
      this.renuevaEn() !== '' &&
      (costo === undefined || (Number.isFinite(costo) && costo >= 0)) &&
      (moneda === '' || /^[A-Za-z]{3}$/.test(moneda))
    );
  });

  ngOnInit(): void {
    const l = this.licencia();
    this.costo.set(l.cost ?? null);
    this.moneda.set(l.currency ?? 'MXN');
    this.propuesta = sugerirProximaRenovacion(l);
    this.propuestaIso = ymdAIso(this.propuesta);
    this.renuevaEn.set(this.propuesta);
  }

  private costoNumero(): number | undefined {
    const texto = String(this.costo() ?? '').trim();
    return texto === '' ? undefined : Number(texto);
  }

  renovar(): void {
    if (this.guardando() || !this.valida()) {
      return;
    }
    const costo = this.costoNumero();
    const moneda = this.moneda().trim().toUpperCase();
    // Los dominios guardan su fecha y costo en el dominio mismo: al terminar
    // se vuelven a pedir las licencias para que la tarjeta los vea al momento.
    this.enviar(
      this.service
        .renovar({
          id: this.licencia().id,
          ...(costo !== undefined ? { costo } : {}),
          ...(moneda ? { moneda } : {}),
          renuevaEn: this.renuevaEn(),
          ...(this.nota().trim() ? { nota: this.nota().trim() } : {})
        })
        .pipe(tap(() => this.store.refreshLicenses()))
    );
  }

  /** Cambia costo, moneda y (si se tocó) la fecha, sin dejar constancia. */
  corregir(): void {
    if (this.guardando() || !this.valida()) {
      return;
    }
    const l = this.licencia();
    const costo = this.costoNumero();
    const moneda = this.moneda().trim().toUpperCase();
    const parche: Parameters<LicenciasService['guardarAjuste']>[1] = {};
    if (costo !== undefined && costo !== l.cost) {
      parche.cost = costo;
    }
    if (moneda && moneda !== (l.currency ?? 'MXN')) {
      parche.currency = moneda;
    }
    // La fecha propuesta es para "ya se renovó"; aquí solo cuenta si se cambió.
    if (
      this.renuevaEn() !== this.propuesta &&
      this.renuevaEn() !== diaDe(l.renewsAt)
    ) {
      parche.renewsAt = this.renuevaEn();
    }
    if (Object.keys(parche).length === 0) {
      this.hecho.emit();
      return;
    }
    this.enviar(this.service.guardarAjuste(l.id, parche));
  }

  private enviar(peticion: Observable<unknown>): void {
    this.guardando.set(true);
    this.error.set(undefined);
    peticion.subscribe({
      next: () => {
        this.guardando.set(false);
        this.hecho.emit();
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

/** El mismo contenido en el diálogo estándar del portal (no el del carrusel). */
@Component({
  selector: 'pt-licencia-renovacion-dialogo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogoComponent, LicenciaRenovacionComponent],
  template: `
    <pt-dialogo titulo="¿Ya se renovó?" (cerrar)="cerrar.emit()">
      <pt-licencia-renovacion
        [licencia]="licencia()"
        (cerrar)="cerrar.emit()"
        (hecho)="cerrar.emit()" />
    </pt-dialogo>
  `
})
export class LicenciaRenovacionDialogoComponent {
  readonly licencia = input.required<LicenseUsage>();
  readonly cerrar = output<void>();
}
