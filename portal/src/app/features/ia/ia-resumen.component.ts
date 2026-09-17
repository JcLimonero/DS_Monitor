import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal
} from '@angular/core';
import { IaService, describirError } from '../../core/ia/ia.service';
import { ResumenDia } from '../../core/ia/ia.models';
import { IconComponent } from '../../ui/icon.component';
import { RelativePipe } from '../../ui/portal.pipes';

/**
 * El resumen del día que redacta la IA: un titular y tres o cuatro líneas.
 * En el carrusel va grande (`tv`); en el panel, como tarjeta. Si el puente
 * no tiene IA no pinta nada: la pantalla sigue igual que antes.
 */
@Component({
  selector: 'pt-ia-resumen',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, RelativePipe],
  template: `
    @if (resumen(); as r) {
      @if (tv()) {
        <div class="flex h-full flex-col">
          <p class="tv-label shrink-0">Hoy, en corto</p>
          <p
            class="mt-2 text-3xl font-bold leading-tight text-ink 2xl:text-4xl">
            {{ r.titular }}
          </p>
          <ul class="mt-4 flex min-h-0 flex-1 flex-col justify-around gap-2">
            @for (linea of r.lineas; track $index) {
              <li class="flex items-start gap-3 text-xl text-ink 2xl:text-2xl">
                <span
                  class="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-brand"></span>
                <span>{{ linea }}</span>
              </li>
            }
          </ul>
        </div>
      } @else {
        <section class="card card-pad">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p
                class="text-xs font-bold uppercase tracking-wide text-ink-subtle">
                Hoy, en corto
              </p>
              <h2 class="mt-1 text-base font-semibold text-ink">
                {{ r.titular }}
              </h2>
            </div>
            <button
              type="button"
              class="btn"
              [disabled]="cargando()"
              (click)="regenerar()"
              aria-label="Volver a generar el resumen">
              <pt-icon name="refrescar" class="h-4 w-4" />
            </button>
          </div>
          <ul class="mt-3 space-y-1.5 text-sm text-ink">
            @for (linea of r.lineas; track $index) {
              <li class="flex items-start gap-2">
                <span
                  class="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand"></span>
                <span>{{ linea }}</span>
              </li>
            }
          </ul>
          <p class="mt-3 text-xs text-ink-subtle">
            Generado {{ r.generadoEn | relativo }} por la IA del portal.
            @if (error(); as e) {
              · {{ e }}
            }
          </p>
        </section>
      }
    }
  `
})
export class IaResumenComponent {
  private readonly ia = inject(IaService);

  readonly tv = input(false);
  readonly resumen = signal<ResumenDia | undefined>(undefined);
  readonly cargando = signal(false);
  readonly error = signal<string | undefined>(undefined);

  constructor() {
    this.ia.resumen().subscribe({
      next: (r) => this.resumen.set(r.resumen),
      error: () => undefined
    });
  }

  regenerar(): void {
    this.cargando.set(true);
    this.error.set(undefined);
    this.ia.generarResumen().subscribe({
      next: (r) => {
        this.resumen.set(r.resumen);
        this.cargando.set(false);
      },
      error: (e: unknown) => {
        this.error.set(describirError(e));
        this.cargando.set(false);
      }
    });
  }
}
