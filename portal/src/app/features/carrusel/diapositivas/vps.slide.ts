import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject
} from '@angular/core';
import { VpsHealth, VpsStatus } from '../../../core/models';
import { VpsService } from '../../../core/vps/vps.service';
import { IconComponent } from '../../../ui/icon.component';
import { SerieComponent } from '../../../ui/serie.component';
import { RelativePipe } from '../../../ui/portal.pipes';
import {
  claseUso,
  tiempoArriba,
  VPS_HEALTH_LABEL
} from '../../vps/vps.component';
import { DiapositivaConContenido } from '../carrusel.model';

const CLASE_TARJETA: Record<VpsHealth, string> = {
  bien: 'border-line',
  aviso:
    'border-amber-400 bg-amber-50 dark:border-amber-500/50 dark:bg-amber-500/10',
  critico:
    'border-rose-400 bg-rose-50 dark:border-rose-500/50 dark:bg-rose-500/10',
  sin_senal:
    'border-stone-400 bg-stone-100 dark:border-stone-400/50 dark:bg-stone-500/10'
};

const CLASE_ESTADO: Record<VpsHealth, string> = {
  bien: 'text-ok',
  aviso: 'text-warn',
  critico: 'text-danger',
  sin_senal: 'text-ink-muted'
};

/**
 * Los servidores en pantalla grande: nombre, estado en grande y color, CPU,
 * memoria y disco con sus barras, la curva de CPU y los contenedores
 * corriendo. Lo que esta mal va primero.
 */
@Component({
  selector: 'pt-slide-vps',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, RelativePipe, SerieComponent],
  host: { class: 'flex h-full flex-col' },
  template: `
    @if (visibles().length > 0) {
      <!--
        Todos los servidores, en una rejilla por ancho (.tv-rejilla). Nombre y
        estado arriba, CPU / memoria / disco en una sola fila de medidores, la
        curva de CPU y, si lo hay, el motivo.
      -->
      <div class="tv-rejilla" style="--tv-min: 16rem">
        @for (v of visibles(); track v.id) {
          <article
            class="tv-card flex min-w-0 flex-col gap-1.5 px-3 py-2"
            [class]="claseTarjeta(v)">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="tv-nombre line-clamp-2">{{ v.name }}</p>
                <p class="tv-dato truncate">
                  @if (v.online) {
                    arriba {{ arriba(v.uptimeSeconds) }} ·
                    {{ corriendo(v) }} contenedores
                  } @else if (v.lastSeen) {
                    última señal {{ v.lastSeen | relativo }}
                  }
                </p>
              </div>
              <p
                class="tv-estado flex shrink-0 items-center gap-1.5"
                [class]="claseEstado(v)">
                @if (v.health === 'bien') {
                  <pt-icon name="ok" class="h-5 w-5" />
                } @else if (v.health === 'sin_senal') {
                  <pt-icon name="reloj" class="h-5 w-5" />
                } @else {
                  <pt-icon name="alerta" class="h-5 w-5" />
                }
                {{ etiqueta[v.health] }}
              </p>
            </div>

            <div class="grid grid-cols-3 gap-3">
              @for (m of medidores(v); track m.nombre) {
                <div class="min-w-0">
                  <p class="tv-dato flex items-baseline justify-between gap-1">
                    <span class="truncate">{{ m.nombre }}</span>
                    <span
                      class="shrink-0 text-base font-bold tabular-nums text-ink"
                      >{{ m.valor ?? '—'
                      }}<span class="text-xs font-normal"> %</span></span
                    >
                  </p>
                  <div
                    class="mt-0.5 h-2 overflow-hidden rounded-full bg-surface-muted">
                    <div
                      class="h-full rounded-full"
                      [class]="claseUso(m.valor)"
                      [style.width.%]="m.valor ?? 0"></div>
                  </div>
                </div>
              }
            </div>

            <div class="text-accent [&_svg]:h-5">
              <pt-serie [puntos]="v.cpuHistory" nombre="CPU" />
            </div>
            @if (v.reason) {
              <p class="tv-dato line-clamp-2">{{ v.reason }}</p>
            }
          </article>
        }
      </div>
    } @else {
      <div
        class="flex flex-1 flex-col items-center justify-center gap-2 text-center text-ink-subtle">
        <pt-icon name="monitoreo" class="h-10 w-10" />
        <p class="text-lg">
          {{ lista() ? 'Sin servidores en Prometheus' : 'Cargando…' }}
        </p>
      </div>
    }
  `
})
export class VpsSlideComponent implements DiapositivaConContenido {
  private readonly servicio = inject(VpsService);

  readonly lista = this.servicio.lista;
  /** Ya respondio el puente y no hay servidores que enseñar. */
  /** Vacia solo cuando ya respondio y no hay nada; cargando no cuenta. */
  readonly vacia = computed(() => this.lista()?.length === 0);
  readonly etiqueta = VPS_HEALTH_LABEL;
  readonly ordenados = computed(() => {
    const peso: Record<VpsHealth, number> = {
      sin_senal: 0,
      critico: 1,
      aviso: 2,
      bien: 3
    };
    return [...(this.lista() ?? [])].sort(
      (a, b) => peso[a.health] - peso[b.health] || a.name.localeCompare(b.name)
    );
  });
  /** Todos, lo que esta mal primero; la cuadricula hace scroll. */
  readonly visibles = computed(() => this.ordenados());

  constructor() {
    this.servicio.cargar();
  }

  medidores(v: VpsStatus) {
    return [
      { nombre: 'CPU', valor: v.cpuPct },
      { nombre: 'Mem.', valor: v.memPct },
      { nombre: 'Disco', valor: v.diskPct }
    ];
  }

  corriendo(v: VpsStatus): number {
    return v.containers.filter((c) => c.running).length;
  }

  claseTarjeta(v: VpsStatus): string {
    return CLASE_TARJETA[v.health];
  }

  claseEstado(v: VpsStatus): string {
    return CLASE_ESTADO[v.health];
  }

  claseUso = claseUso;
  arriba = tiempoArriba;
}
