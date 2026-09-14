import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject
} from '@angular/core';
import {
  MONITOR_ENVIRONMENT_LABEL,
  MONITOR_STATUS_LABEL,
  MonitorStatus,
  MonitorTarget
} from '../../../core/models';
import { PortalStore } from '../../../core/state/portal.store';
import { IconComponent } from '../../../ui/icon.component';
import { SparklineComponent } from '../../../ui/sparkline.component';

/**
 * Colores de estado a tamaño de pantalla.
 *
 * A varios metros el color se lee antes que el texto, asi que cada estado pinta
 * la tarjeta entera y no solo una etiqueta chica.
 */
const CLASE_TARJETA: Record<MonitorStatus, string> = {
  operativo: 'border-line',
  degradado:
    'border-amber-400 bg-amber-50 dark:border-amber-500/50 dark:bg-amber-500/10',
  caido:
    'border-rose-400 bg-rose-50 dark:border-rose-500/50 dark:bg-rose-500/10',
  mantenimiento:
    'border-sky-400 bg-sky-50 dark:border-sky-500/50 dark:bg-sky-500/10',
  desconocido: 'border-line'
};

const CLASE_ESTADO: Record<MonitorStatus, string> = {
  operativo: 'text-ok',
  degradado: 'text-warn',
  caido: 'text-danger',
  mantenimiento: 'text-info',
  desconocido: 'text-ink-subtle'
};

/** Todos los destinos vigilados, lo roto primero. */
@Component({
  selector: 'pt-slide-plataformas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, SparklineComponent],
  host: { class: 'block h-full' },
  template: `
    <div class="grid h-full grid-cols-2 gap-4 xl:grid-cols-4">
      @for (destino of destinos(); track destino.id) {
        <article
          class="tv-card flex min-h-0 flex-col justify-between gap-2 px-5 py-4"
          [class]="claseTarjeta(destino)">
          <div class="min-w-0">
            <p class="truncate text-xl font-bold text-ink 2xl:text-2xl">
              {{ destino.name }}
            </p>
            <p class="truncate text-base text-ink-muted">
              {{ destino.environment }}
            </p>
          </div>

          <p
            class="flex items-center gap-2 text-2xl font-bold 2xl:text-3xl"
            [class]="claseEstado(destino)">
            @if (destino.status === 'caido') {
              <pt-icon name="alerta" class="h-7 w-7" />
            } @else if (destino.status === 'operativo') {
              <pt-icon name="ok" class="h-7 w-7" />
            }
            {{ etiqueta(destino) }}
          </p>

          <div class="text-accent">
            <pt-sparkline [checks]="destino.history" />
          </div>

          <p
            class="flex items-baseline justify-between text-lg text-ink-muted 2xl:text-xl">
            <span class="tabular-nums">
              {{
                destino.latencyMs !== undefined
                  ? destino.latencyMs + ' ms'
                  : 'sin respuesta'
              }}
            </span>
            <span
              class="font-bold tabular-nums"
              [class]="claseDisponibilidad(destino)">
              {{ destino.uptime24h }}%
            </span>
          </p>
        </article>
      }
    </div>
  `
})
export class PlataformasSlideComponent {
  private readonly store = inject(PortalStore);

  readonly destinos = computed(() =>
    [...this.store.targets()].sort(
      (a, b) => peso(a.status) - peso(b.status) || a.name.localeCompare(b.name)
    )
  );

  claseTarjeta(destino: MonitorTarget): string {
    return CLASE_TARJETA[destino.status];
  }

  claseEstado(destino: MonitorTarget): string {
    return CLASE_ESTADO[destino.status];
  }

  entorno(destino: MonitorTarget): string {
    return MONITOR_ENVIRONMENT_LABEL[destino.environment];
  }

  etiqueta(destino: MonitorTarget): string {
    return MONITOR_STATUS_LABEL[destino.status];
  }

  claseDisponibilidad(destino: MonitorTarget): string {
    if (destino.uptime24h >= 99) {
      return 'text-ok';
    }
    return destino.uptime24h >= 95 ? 'text-warn' : 'text-danger';
  }
}

function peso(status: MonitorStatus): number {
  switch (status) {
    case 'caido':
      return 0;
    case 'degradado':
      return 1;
    case 'mantenimiento':
      return 2;
    case 'desconocido':
      return 3;
    default:
      return 4;
  }
}
