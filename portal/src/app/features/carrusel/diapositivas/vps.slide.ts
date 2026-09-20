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

/** Cuantas tarjetas caben en una pantalla de televisión. */
const MAXIMO = 6;

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
      <div
        class="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        @for (v of visibles(); track v.id) {
          <article
            class="tv-card flex min-h-0 flex-col gap-3 px-5 py-4"
            [class]="claseTarjeta(v)">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="truncate text-xl font-bold text-ink 2xl:text-2xl">
                  {{ v.name }}
                </p>
                <p class="truncate text-base text-ink-muted">
                  @if (v.online) {
                    arriba {{ arriba(v.uptimeSeconds) }} ·
                    {{ corriendo(v) }} contenedores
                  } @else if (v.lastSeen) {
                    última señal {{ v.lastSeen | relativo }}
                  }
                </p>
              </div>
              <p
                class="flex shrink-0 items-center gap-2 text-2xl font-bold 2xl:text-3xl"
                [class]="claseEstado(v)">
                @if (v.health === 'bien') {
                  <pt-icon name="ok" class="h-7 w-7" />
                } @else if (v.health === 'sin_senal') {
                  <pt-icon name="reloj" class="h-7 w-7" />
                } @else {
                  <pt-icon name="alerta" class="h-7 w-7" />
                }
                {{ etiqueta[v.health] }}
              </p>
            </div>

            <div class="grid grid-cols-3 gap-4">
              @for (m of medidores(v); track m.nombre) {
                <div>
                  <p
                    class="flex items-baseline justify-between text-base text-ink-muted">
                    <span>{{ m.nombre }}</span>
                    <span
                      class="text-2xl font-bold tabular-nums text-ink 2xl:text-3xl"
                      >{{ m.valor ?? '—'
                      }}<span class="text-base font-normal"> %</span></span
                    >
                  </p>
                  <div
                    class="mt-1 h-2.5 overflow-hidden rounded-full bg-surface-muted">
                    <div
                      class="h-full rounded-full"
                      [class]="claseUso(m.valor)"
                      [style.width.%]="m.valor ?? 0"></div>
                  </div>
                </div>
              }
            </div>

            <div class="text-accent">
              <pt-serie [puntos]="v.cpuHistory" nombre="CPU" />
            </div>
            @if (v.reason) {
              <p class="text-base text-ink-muted">{{ v.reason }}</p>
            }
          </article>
        }
      </div>
      @if (restantes() > 0) {
        <p class="mt-2 shrink-0 text-center text-base text-ink-muted">
          y {{ restantes() }} más
        </p>
      }
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
  readonly visibles = computed(() => this.ordenados().slice(0, MAXIMO));
  readonly restantes = computed(() =>
    Math.max(0, this.ordenados().length - MAXIMO)
  );

  constructor() {
    this.servicio.cargar();
  }

  medidores(v: VpsStatus) {
    return [
      { nombre: 'CPU', valor: v.cpuPct },
      { nombre: 'Memoria', valor: v.memPct },
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
