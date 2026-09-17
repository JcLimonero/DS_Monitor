import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal
} from '@angular/core';
import { Alerta } from '../../core/ia/ia.models';
import { IaService } from '../../core/ia/ia.service';
import { IconComponent } from '../../ui/icon.component';

/**
 * Alertas de licencias y dominios: cargos que suben, suscripciones repetidas,
 * licencias sin uso, dominios por vencer. Las detectan reglas en el puente y
 * la IA las redacta; sin IA salen igual, más secas. `tipos` filtra qué
 * enseñar en cada módulo.
 */
@Component({
  selector: 'pt-ia-alertas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    @if (visibles().length > 0) {
      <section class="card card-pad">
        <h2 class="text-sm font-semibold text-ink">{{ titulo() }}</h2>
        <ul class="mt-3 space-y-2">
          @for (a of visibles(); track a.id) {
            <li class="flex items-start gap-3 text-sm">
              <pt-icon
                name="alerta"
                class="mt-0.5 h-4 w-4 shrink-0"
                [class]="
                  a.gravedad === 'grave' ? 'text-danger' : 'text-warn'
                " />
              <div class="min-w-0">
                <p class="font-medium text-ink">{{ a.titulo }}</p>
                <p class="text-ink-muted">{{ a.texto ?? a.detalle }}</p>
              </div>
            </li>
          }
        </ul>
      </section>
    }
  `
})
export class IaAlertasComponent {
  private readonly ia = inject(IaService);

  readonly tipos = input<Alerta['tipo'][] | undefined>(undefined);
  readonly titulo = input('Alertas');
  readonly alertas = signal<Alerta[]>([]);

  readonly visibles = computed(() => {
    const tipos = this.tipos();
    return tipos
      ? this.alertas().filter((a) => tipos.includes(a.tipo))
      : this.alertas();
  });

  constructor() {
    this.ia.alertas().subscribe({
      next: (a) => this.alertas.set(a),
      error: () => undefined
    });
  }
}
