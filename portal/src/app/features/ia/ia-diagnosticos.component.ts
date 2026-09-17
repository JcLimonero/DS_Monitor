import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal
} from '@angular/core';
import { Diagnostico } from '../../core/ia/ia.models';
import { IaService } from '../../core/ia/ia.service';
import { IconComponent } from '../../ui/icon.component';
import { RelativePipe } from '../../ui/portal.pipes';

/**
 * Diagnóstico de lo que está caído o falló: qué pasa, la causa probable y
 * qué hacer primero, con la evidencia (respuesta HTTP o bitácora) a la mano.
 */
@Component({
  selector: 'pt-ia-diagnosticos',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, RelativePipe],
  template: `
    @if (visibles().length > 0) {
      <section class="card card-pad">
        <h2 class="text-sm font-semibold text-ink">Diagnóstico de la IA</h2>
        <ul class="mt-3 space-y-3">
          @for (d of visibles(); track d.id) {
            <li class="rounded-lg border border-line p-3 text-sm">
              <p class="flex items-start gap-2 font-medium text-ink">
                <pt-icon
                  name="alerta"
                  class="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                <span>{{ d.objetivo }}</span>
              </p>
              <p class="mt-1 text-ink">{{ d.resumen }}</p>
              @if (d.causa) {
                <p class="mt-1 text-ink-muted">
                  <strong>Causa:</strong> {{ d.causa }}
                </p>
              }
              @if (d.accion) {
                <p class="text-ink-muted">
                  <strong>Qué hacer:</strong> {{ d.accion }}
                </p>
              }
              <details class="mt-2">
                <summary class="cursor-pointer text-xs text-ink-subtle">
                  Evidencia · {{ d.generadoEn | relativo }}
                </summary>
                <pre
                  class="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-surface-muted p-2 font-mono text-xs text-ink-muted"
                  >{{ d.evidencia }}</pre>
              </details>
            </li>
          }
        </ul>
      </section>
    }
  `
})
export class IaDiagnosticosComponent {
  private readonly ia = inject(IaService);

  readonly clase = input<'sitio' | 'despliegue' | undefined>(undefined);
  readonly diagnosticos = signal<Diagnostico[]>([]);

  readonly visibles = computed(() => {
    const clase = this.clase();
    return clase
      ? this.diagnosticos().filter((d) => d.clase === clase)
      : this.diagnosticos();
  });

  constructor() {
    this.ia.diagnosticos().subscribe({
      next: (d) => this.diagnosticos.set(d),
      error: () => undefined
    });
  }
}
