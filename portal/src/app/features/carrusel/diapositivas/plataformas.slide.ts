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
import { MONITOR_SOURCES } from '../../../core/sources/source.contracts';
import { IconComponent } from '../../../ui/icon.component';
import { SparklineComponent } from '../../../ui/sparkline.component';
import { DiapositivaConContenido } from '../carrusel.model';

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
    'border-sky-400 bg-sky-50 dark:border-stone-400/50 dark:bg-stone-500/10',
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
  host: { class: 'flex h-full flex-col' },
  template: `
    @if (destinos().length > 0) {
      <!--
        Todas las tarjetas, en una rejilla que decide sus columnas por el ancho
        (.tv-rejilla). Las filas miden lo que su contenido y, si aun asi sobran,
        la rejilla se desplaza sola. El estado es lo que se lee de lejos: color,
        icono y etiqueta; el resto va en una linea chica.
      -->
      <div class="tv-rejilla" style="--tv-min: 10.5rem">
        @for (destino of destinos(); track destino.id) {
          <article
            class="tv-card flex min-w-0 flex-col gap-1 px-3 py-2"
            [class]="claseTarjeta(destino)">
            <p class="tv-nombre line-clamp-2">{{ destino.name }}</p>

            <p
              class="tv-estado flex items-center gap-1.5"
              [class]="claseEstado(destino)">
              @if (destino.status === 'caido') {
                <pt-icon name="alerta" class="h-5 w-5 shrink-0" />
              } @else if (destino.status === 'operativo') {
                <pt-icon name="ok" class="h-5 w-5 shrink-0" />
              }
              <span class="min-w-0">{{ etiqueta(destino) }}</span>
            </p>

            <div class="text-accent [&_svg]:h-5">
              <pt-sparkline [checks]="destino.history" />
            </div>

            <p
              class="tv-dato flex items-baseline justify-between gap-2 tabular-nums">
              <span class="min-w-0 truncate">
                {{ entorno(destino) }} ·
                {{
                  destino.latencyMs !== undefined
                    ? destino.latencyMs + ' ms'
                    : 'sin respuesta'
                }}
              </span>
              <span
                class="shrink-0 text-base font-bold"
                [class]="claseDisponibilidad(destino)">
                {{ destino.uptime24h }}%
              </span>
            </p>
          </article>
        }
      </div>
    } @else {
      <!-- Sin destinos vigilados no hay nada que pintar: se dice en grande. -->
      <div
        class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <pt-icon name="ok" class="h-12 w-12 text-ok" />
        <p class="tv-title">Sin plataformas vigiladas</p>
        <p class="tv-row text-ink-muted">
          Los sitios se dan de alta en Integraciones › Sitios
        </p>
      </div>
    }
  `
})
export class PlataformasSlideComponent implements DiapositivaConContenido {
  private readonly store = inject(PortalStore);
  /** Los sitios vigilados salen de la fuente `monitor`. */
  private readonly monitores = inject(MONITOR_SOURCES);

  readonly vacia = computed(() => {
    for (const kind of new Set(this.monitores.map((fuente) => fuente.kind))) {
      if (!this.store.fuenteContestada(kind)) {
        return false;
      }
    }
    return this.store.targets().length === 0;
  });

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
