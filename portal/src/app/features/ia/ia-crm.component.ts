import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal
} from '@angular/core';
import { SugerenciaCrm } from '../../core/ia/ia.models';
import { IaService, describirError } from '../../core/ia/ia.service';
import { IconComponent } from '../../ui/icon.component';
import { RelativePipe } from '../../ui/portal.pipes';

/**
 * Lo que la IA vio en el correo que parece un prospecto o una queja de un
 * cliente. Cada sugerencia se crea en Odoo con un clic (como oportunidad o
 * como lead con prefijo "Queja:") o se descarta; nada entra al CRM solo.
 */
@Component({
  selector: 'pt-ia-crm',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, RelativePipe],
  template: `
    @if (sugerencias().length > 0) {
      <section class="card card-pad">
        <h2 class="text-sm font-semibold text-ink">Sugerencias del correo</h2>
        <p class="mt-0.5 text-xs text-ink-muted">
          Correos de clientes o prospectos que la IA propone registrar en el
          CRM.
        </p>
        <ul class="mt-3 space-y-2">
          @for (s of sugerencias(); track s.id) {
            <li
              class="flex flex-wrap items-start gap-3 rounded-lg border border-line p-3 text-sm">
              <div class="min-w-0 flex-1">
                <p class="font-medium text-ink">
                  <span
                    class="chip mr-2"
                    [class]="
                      s.tipo === 'queja'
                        ? 'bg-rose-100 text-rose-700'
                        : 'bg-emerald-100 text-emerald-700'
                    ">
                    {{ s.tipo === 'queja' ? 'Queja' : 'Oportunidad' }}
                  </span>
                  {{ s.nombre }}
                </p>
                <p class="mt-1 text-ink-muted">{{ s.resumen }}</p>
                <p class="mt-1 text-xs text-ink-subtle">
                  {{ s.contacto ?? '' }}
                  @if (s.correo) {
                    &lt;{{ s.correo }}&gt;
                  }
                  @if (s.empresa) {
                    · {{ s.empresa }}
                  }
                  · {{ s.analizadoEn | relativo }}
                </p>
                @if (mensajes()[s.id]; as m) {
                  <p class="mt-1 text-xs text-ink-muted">{{ m }}</p>
                }
              </div>
              <div class="flex shrink-0 gap-2">
                <button
                  type="button"
                  class="btn btn-primary"
                  [disabled]="ocupado() === s.id"
                  (click)="crear(s)">
                  <pt-icon name="mas" class="h-4 w-4" />
                  Crear en Odoo
                </button>
                <button
                  type="button"
                  class="btn"
                  [disabled]="ocupado() === s.id"
                  (click)="descartar(s)">
                  Descartar
                </button>
              </div>
            </li>
          }
        </ul>
      </section>
    }
  `
})
export class IaCrmComponent {
  private readonly ia = inject(IaService);

  readonly sugerencias = signal<SugerenciaCrm[]>([]);
  readonly ocupado = signal<string | undefined>(undefined);
  readonly mensajes = signal<Record<string, string>>({});

  constructor() {
    this.ia.sugerenciasCrm().subscribe({
      next: (s) => this.sugerencias.set(s),
      error: () => undefined
    });
  }

  crear(s: SugerenciaCrm): void {
    this.ocupado.set(s.id);
    this.ia.crearEnCrm(s.id).subscribe({
      next: (r) => {
        this.ocupado.set(undefined);
        this.sugerencias.update((lista) => lista.filter((x) => x.id !== s.id));
        window.open(r.url, '_blank', 'noopener');
      },
      error: (e: unknown) => {
        this.ocupado.set(undefined);
        this.mensajes.update((m) => ({ ...m, [s.id]: describirError(e) }));
      }
    });
  }

  descartar(s: SugerenciaCrm): void {
    this.ocupado.set(s.id);
    this.ia.descartarDeCrm(s.id).subscribe({
      next: () => {
        this.ocupado.set(undefined);
        this.sugerencias.update((lista) => lista.filter((x) => x.id !== s.id));
      },
      error: (e: unknown) => {
        this.ocupado.set(undefined);
        this.mensajes.update((m) => ({ ...m, [s.id]: describirError(e) }));
      }
    });
  }
}
