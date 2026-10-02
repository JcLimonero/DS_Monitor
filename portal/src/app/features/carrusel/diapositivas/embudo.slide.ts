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
import { CRM_SOURCES } from '../../../core/sources/source.contracts';
import { isOverdue } from '../../../core/util/date.util';
import { plural } from '../../../core/util/text.util';
import { IconComponent } from '../../../ui/icon.component';
import { DayPipe, MoneyPipe } from '../../../ui/portal.pipes';
import { DiapositivaConContenido } from '../carrusel.model';

/** Cuantas oportunidades se alcanzan a listar por etapa. */
const POR_ETAPA = 3;

/**
 * El embudo de Odoo por etapa y lo que hay que hacer con el.
 *
 * Las actividades van en columnas por ancho y, si aun asi no caben, la lista
 * se desplaza sola.
 *
 * Las columnas del embudo no se estiran: con dos oportunidades por etapa
 * quedaban tres cuartos de pantalla en blanco. El espacio que sobra se lo lleva
 * la lista de actividades, que es lo accionable de esta pantalla.
 */
@Component({
  selector: 'pt-slide-embudo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DayPipe, IconComponent, MoneyPipe],
  host: { class: 'flex h-full flex-col gap-2' },
  template: `
    <div class="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4">
      @for (etapa of etapas(); track etapa.stage) {
        <section class="tv-card min-w-0 px-3 py-2">
          <p class="tv-label">{{ nombre(etapa.stage) }}</p>
          <p class="text-2xl font-bold tabular-nums leading-tight text-ink">
            {{ etapa.total | moneda }}
          </p>
          <p class="tv-dato">
            {{ conteo(etapa.opportunities.length) }}
          </p>

          <ul class="mt-1.5 space-y-1">
            @for (
              oportunidad of etapa.opportunities.slice(0, porEtapa);
              track oportunidad.id
            ) {
              <li class="rounded-lg bg-surface-muted px-2 py-1">
                <p class="tv-nombre line-clamp-2">
                  {{ oportunidad.partner }}
                </p>
                <p class="tv-dato flex items-baseline justify-between">
                  <span class="tabular-nums">
                    {{ oportunidad.amount | moneda: oportunidad.currency }}
                  </span>
                  <span>{{ oportunidad.probability }}%</span>
                </p>
              </li>
            } @empty {
              <li class="tv-row text-ink-subtle">Sin oportunidades</li>
            }
            @if (etapa.opportunities.length > porEtapa) {
              <li class="tv-dato text-center">
                y {{ etapa.opportunities.length - porEtapa }} más
              </li>
            }
          </ul>
        </section>
      }
    </div>

    <div
      class="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1 rounded-xl border border-line bg-surface px-3 py-1.5">
      <p class="flex items-baseline gap-2">
        <span class="tv-label">Ponderado</span>
        <span class="text-2xl font-bold tabular-nums text-info">
          {{ ponderado() | moneda }}
        </span>
      </p>
      <p
        class="tv-row flex items-center gap-2"
        [class.text-danger]="atrasadas() > 0">
        @if (atrasadas() > 0) {
          <pt-icon name="alerta" class="h-5 w-5" />
        } @else {
          <pt-icon name="ok" class="h-5 w-5 text-ok" />
        }
        {{ textoAtrasadas() }}
      </p>
    </div>

    <section class="tv-card flex min-h-0 flex-1 flex-col px-3 py-2">
      <h2 class="shrink-0 tv-label">Siguientes actividades</h2>
      @if (actividades().length > 0) {
        <!--
          Las actividades en columnas por ancho: con 14 renglones de una
          columna sobraba medio ancho y faltaba alto.
        -->
        <ul
          class="tv-rejilla mt-1.5 !gap-x-4 !gap-y-1.5"
          style="--tv-min: 24rem">
          @for (actividad of actividades(); track actividad.id) {
            <li class="flex min-w-0 items-center gap-3">
              <span
                class="chip w-20 shrink-0 justify-center bg-surface-muted py-0.5 text-xs text-ink-muted">
                {{ tipo(actividad) }}
              </span>
              <span class="min-w-0 flex-1">
                <span class="tv-nombre line-clamp-2">
                  {{ actividad.summary }}
                </span>
                <span class="tv-dato line-clamp-1">
                  {{ actividad.opportunityName ?? 'Sin oportunidad' }}
                  @if (actividad.responsible) {
                    · {{ actividad.responsible.name }}
                  }
                </span>
              </span>
              <span
                class="tv-dato shrink-0 whitespace-nowrap text-right font-bold"
                [class]="tarde(actividad) ? '!text-danger' : ''">
                {{ tarde(actividad) ? 'Atrasada · ' : ''
                }}{{ actividad.dueDate | dia }}
              </span>
            </li>
          }
        </ul>
      } @else {
        <p class="tv-row mt-2 flex-1 text-ink-subtle">
          Odoo no devolvió actividades programadas
        </p>
      }
    </section>
  `
})
export class EmbudoSlideComponent implements DiapositivaConContenido {
  private readonly store = inject(PortalStore);
  /** El CRM del portal es Odoo. */
  private readonly crms = inject(CRM_SOURCES);

  /**
   * Sin oportunidades ni actividades no hay embudo que enseñar.
   * Hasta que Odoo conteste, las listas vacías son la carga, no el dato.
   */
  readonly vacia = computed(() => {
    for (const kind of new Set(this.crms.map((fuente) => fuente.kind))) {
      if (!this.store.fuenteContestada(kind)) {
        return false;
      }
    }
    return (
      this.store.opportunities().length === 0 &&
      this.store.activities().length === 0
    );
  });

  readonly porEtapa = POR_ETAPA;

  readonly etapas = computed(() =>
    pipelineByStage(this.store.opportunities()).filter(
      (etapa) => etapa.stage !== 'ganado' && etapa.stage !== 'perdido'
    )
  );

  readonly ponderado = computed(() =>
    weightedPipeline(this.store.opportunities())
  );

  /** Todas, lo atrasado primero y luego lo mas proximo; la lista hace scroll. */
  readonly actividades = computed(() =>
    [...this.store.activities()].sort((a, b) =>
      a.dueDate.localeCompare(b.dueDate)
    )
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
