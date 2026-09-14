import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject
} from '@angular/core';
import {
  CRM_ACTIVITY_LABEL,
  CRM_STAGE_LABEL,
  CrmActivity,
  CrmStage
} from '../../../core/models';
import {
  pipelineByStage,
  weightedPipeline
} from '../../../core/state/portal.selectors';
import { PortalStore } from '../../../core/state/portal.store';
import { isOverdue } from '../../../core/util/date.util';
import { plural } from '../../../core/util/text.util';
import { IconComponent } from '../../../ui/icon.component';
import { DayPipe, MoneyPipe } from '../../../ui/portal.pipes';

/** Cuantas oportunidades se alcanzan a listar por etapa. */
const POR_ETAPA = 3;

/** Cuantas actividades caben en la banda de abajo. */
const ACTIVIDADES = 5;

/**
 * El embudo de Odoo por etapa y lo que hay que hacer con el.
 *
 * Las columnas del embudo no se estiran: con dos oportunidades por etapa
 * quedaban tres cuartos de pantalla en blanco. El espacio que sobra se lo lleva
 * la lista de actividades, que es lo accionable de esta pantalla.
 */
@Component({
  selector: 'pt-slide-embudo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DayPipe, IconComponent, MoneyPipe],
  host: { class: 'flex h-full flex-col gap-4' },
  template: `
    <div class="grid shrink-0 grid-cols-2 gap-4 xl:grid-cols-4">
      @for (etapa of etapas(); track etapa.stage) {
        <section class="tv-card px-5 py-4">
          <p class="tv-label">{{ nombre(etapa.stage) }}</p>
          <p class="mt-1 text-3xl font-bold tabular-nums text-ink 2xl:text-4xl">
            {{ etapa.total | moneda }}
          </p>
          <p class="text-base text-ink-muted">
            {{ conteo(etapa.opportunities.length) }}
          </p>

          <ul class="mt-3 space-y-2">
            @for (
              oportunidad of etapa.opportunities.slice(0, porEtapa);
              track oportunidad.id
            ) {
              <li class="rounded-lg bg-surface-muted px-3 py-2">
                <p class="truncate text-lg font-bold text-ink 2xl:text-xl">
                  {{ oportunidad.partner }}
                </p>
                <p
                  class="flex items-baseline justify-between text-base text-ink-muted">
                  <span class="tabular-nums">
                    {{ oportunidad.amount | moneda: oportunidad.currency }}
                  </span>
                  <span>{{ oportunidad.probability }}%</span>
                </p>
              </li>
            } @empty {
              <li class="text-lg text-ink-subtle">Sin oportunidades</li>
            }
          </ul>
        </section>
      }
    </div>

    <div
      class="flex shrink-0 flex-wrap items-center gap-x-8 gap-y-2 rounded-2xl border border-line bg-surface px-6 py-3">
      <p class="flex items-baseline gap-3">
        <span class="tv-label">Ponderado</span>
        <span class="text-3xl font-bold tabular-nums text-info 2xl:text-4xl">
          {{ ponderado() | moneda }}
        </span>
      </p>
      <p
        class="flex items-center gap-3 tv-row"
        [class.text-danger]="atrasadas() > 0">
        @if (atrasadas() > 0) {
          <pt-icon name="alerta" class="h-7 w-7" />
        } @else {
          <pt-icon name="ok" class="h-7 w-7 text-ok" />
        }
        {{ textoAtrasadas() }}
      </p>
    </div>

    <section class="tv-card flex min-h-0 flex-1 flex-col px-6 py-4">
      <h2 class="shrink-0 tv-label">Siguientes actividades</h2>
      @if (actividades().length > 0) {
        <ul
          class="mt-2 flex min-h-0 flex-1 flex-col justify-around overflow-hidden">
          @for (actividad of actividades(); track actividad.id) {
            <li class="flex items-center gap-5">
              <span
                class="chip w-32 shrink-0 justify-center bg-surface-muted py-1 text-base text-ink-muted">
                {{ tipo(actividad) }}
              </span>
              <span class="min-w-0 flex-1">
                <span
                  class="block truncate text-xl font-bold text-ink 2xl:text-2xl">
                  {{ actividad.summary }}
                </span>
                <span
                  class="block truncate text-base text-ink-muted 2xl:text-lg">
                  {{ actividad.opportunityName ?? 'Sin oportunidad' }}
                  @if (actividad.responsible) {
                    · {{ actividad.responsible.name }}
                  }
                </span>
              </span>
              <span
                class="shrink-0 whitespace-nowrap tv-row font-bold"
                [class]="tarde(actividad) ? 'text-danger' : 'text-ink-muted'">
                {{ tarde(actividad) ? 'Atrasada · ' : ''
                }}{{ actividad.dueDate | dia }}
              </span>
            </li>
          }
        </ul>
      } @else {
        <p class="mt-3 flex-1 text-2xl text-ink-subtle">
          Odoo no devolvió actividades programadas
        </p>
      }
    </section>
  `
})
export class EmbudoSlideComponent {
  private readonly store = inject(PortalStore);

  readonly porEtapa = POR_ETAPA;

  readonly etapas = computed(() =>
    pipelineByStage(this.store.opportunities()).filter(
      (etapa) => etapa.stage !== 'ganado' && etapa.stage !== 'perdido'
    )
  );

  readonly ponderado = computed(() =>
    weightedPipeline(this.store.opportunities())
  );

  /** Lo atrasado primero, y luego lo mas proximo. */
  readonly actividades = computed(() =>
    [...this.store.activities()]
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, ACTIVIDADES)
  );

  readonly atrasadas = computed(
    () =>
      this.store
        .activities()
        .filter((actividad) => isOverdue(actividad.dueDate)).length
  );

  readonly textoAtrasadas = computed(() =>
    this.atrasadas() === 0
      ? 'Ninguna actividad atrasada'
      : plural(this.atrasadas(), 'actividad atrasada', 'actividades atrasadas')
  );

  nombre(stage: CrmStage): string {
    return CRM_STAGE_LABEL[stage];
  }

  conteo(total: number): string {
    return plural(total, 'oportunidad', 'oportunidades');
  }

  tipo(actividad: CrmActivity): string {
    return CRM_ACTIVITY_LABEL[actividad.type];
  }

  tarde(actividad: CrmActivity): boolean {
    return isOverdue(actividad.dueDate);
  }
}
