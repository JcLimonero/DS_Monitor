import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject
} from '@angular/core';
import { HostedApp } from '../../../core/models';
import { PortalesService } from '../../../core/portales/portales.service';
import { IconComponent } from '../../../ui/icon.component';
import { PortalChipComponent } from '../../../ui/portal-chip.component';
import { RelativePipe } from '../../../ui/portal.pipes';

/**
 * Los portales montados en Coolify, en pantalla grande: una tarjeta por
 * servidor con sus aplicaciones y servicios, el estado en color y el
 * dominio. Lo que no corre va primero; si todo esta bien, se dice.
 */
@Component({
  selector: 'pt-slide-portales',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, PortalChipComponent, RelativePipe],
  host: { class: 'flex h-full flex-col' },
  template: `
    @if (grupos().length > 0) {
      <p class="mb-3 shrink-0 text-lg text-ink-muted">
        {{ total() }} portales ·
        @if (mal() === 0) {
          <span class="text-ok">todos corriendo</span>
        } @else {
          <span class="text-danger">{{ mal() }} con atención</span>
        }
      </p>
      <div
        class="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto lg:grid-cols-2 xl:grid-cols-3">
        @for (g of grupos(); track g.servidor) {
          <section class="tv-card flex min-h-0 flex-col px-5 py-4">
            <h2 class="flex shrink-0 items-baseline gap-3">
              <span class="tv-label">{{ g.servidor }}</span>
              <span class="text-lg font-bold text-ink-muted">
                {{ g.portales.length }}
              </span>
            </h2>
            <ul class="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
              @for (p of g.portales; track p.id) {
                <li
                  class="flex shrink-0 items-start gap-3 rounded-lg border px-3 py-2"
                  [class]="claseFila(p)">
                  <span
                    class="mt-2 h-2.5 w-2.5 shrink-0 rounded-full"
                    [class]="punto(p)"></span>
                  <span class="min-w-0 flex-1">
                    <span
                      class="block truncate text-lg font-bold leading-tight text-ink 2xl:text-xl">
                      {{ p.name }}
                    </span>
                    <span
                      class="mt-0.5 block truncate text-base text-ink-muted">
                      {{
                        p.url || (p.kind === 'app' ? 'aplicación' : 'servicio')
                      }}
                      @if (p.lastDeployAt) {
                        · desplegado {{ p.lastDeployAt | relativo }}
                      }
                    </span>
                  </span>
                  <pt-portal-chip class="shrink-0 text-base" [portal]="p" />
                </li>
              }
            </ul>
          </section>
        }
      </div>
    } @else {
      <div
        class="flex flex-1 flex-col items-center justify-center gap-2 text-center text-ink-subtle">
        <pt-icon name="despliegue" class="h-10 w-10" />
        <p class="text-lg">
          {{
            servicio.sinConfigurar()
              ? 'Coolify sin conectar (Integraciones → Servicios)'
              : servicio.lista()
                ? 'Sin portales en Coolify'
                : 'Cargando…'
          }}
        </p>
      </div>
    }
  `
})
export class PortalesSlideComponent {
  readonly servicio = inject(PortalesService);

  /** Por servidor, con lo que no corre primero dentro de cada uno. */
  readonly grupos = computed(() =>
    this.servicio.porServidor().map((g) => ({
      servidor: g.servidor,
      portales: [...g.portales].sort(
        (a, b) => this.peso(a) - this.peso(b) || a.name.localeCompare(b.name)
      )
    }))
  );
  readonly total = computed(() => (this.servicio.lista() ?? []).length);
  readonly mal = computed(() => this.servicio.mal().length);

  constructor() {
    this.servicio.cargar();
  }

  private peso(p: HostedApp): number {
    if (p.status === 'error') {
      return 0;
    }
    if (p.status === 'stopped') {
      return 1;
    }
    if (p.status === 'running' && p.healthy === false) {
      return 2;
    }
    return p.status === 'unknown' ? 3 : 4;
  }

  punto(p: HostedApp): string {
    if (p.status === 'running' && p.healthy !== false) {
      return 'bg-ok';
    }
    if (p.status === 'unknown') {
      return 'bg-ink-subtle';
    }
    return p.status === 'running' ? 'bg-warn' : 'bg-danger';
  }

  claseFila(p: HostedApp): string {
    if (p.status === 'stopped' || p.status === 'error') {
      return 'border-rose-400 bg-rose-50 dark:border-rose-500/50 dark:bg-rose-500/10';
    }
    if (p.status === 'running' && p.healthy === false) {
      return 'border-amber-400 bg-amber-50 dark:border-amber-500/50 dark:bg-amber-500/10';
    }
    return 'border-line';
  }
}
