import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject
} from '@angular/core';
import { teamWorkload } from '../../../core/state/portal.selectors';
import { PortalStore } from '../../../core/state/portal.store';
import { plural } from '../../../core/util/text.util';
import { RelativePipe } from '../../../ui/portal.pipes';

/** Carga del equipo de desarrollo: quién trae más y quién trae vencidos. */
@Component({
  selector: 'pt-slide-equipo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RelativePipe],
  host: { class: 'flex h-full flex-col gap-1' },
  template: `
    @if (conAsignados() > 0) {
      <p class="tv-row shrink-0 text-center text-ink-muted">
        {{ textoConAsignados() }}
      </p>
    }
    @if (cargas().length > 0) {
      <!--
        Todas las personas, en una rejilla por ancho (.tv-rejilla), con scroll
        si no caben.
      -->
      <div
        class="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain pr-1">
        <ul
          class="tv-rejilla !flex-none !overflow-visible !pr-0"
          style="--tv-min: 26rem">
          @for (carga of cargas(); track carga.person.id) {
            <li
              class="tv-card flex min-w-0 items-center gap-3 px-3 py-2 max-sm:flex-wrap">
              <span
                class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-soft text-base font-bold text-brand">
                {{ iniciales(carga.person.name) }}
              </span>

              <span class="min-w-0 flex-1 max-sm:basis-40">
                <span class="tv-nombre line-clamp-2">{{
                  carga.person.name
                }}</span>
                <span class="tv-dato block truncate">
                  {{ carga.person.role ?? 'Sin rol' }}
                  @if (carga.oldestOpen; as viejo) {
                    · Más antiguo: {{ viejo.title }} ·
                    {{ viejo.updatedAt | relativo }}
                  }
                </span>
                <span
                  class="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
                  <span
                    class="block h-full rounded-full"
                    [class]="carga.overdue > 0 ? 'bg-danger' : 'bg-accent'"
                    [style.width.%]="ancho(carga.open)"></span>
                </span>
              </span>

              <span
                class="flex shrink-0 gap-3 text-center max-sm:w-full max-sm:justify-around">
                <span class="min-w-[3.25rem]">
                  <span
                    class="block text-2xl font-bold tabular-nums leading-none text-ink">
                    {{ carga.open }}
                  </span>
                  <span class="tv-label !tracking-wide">Abiertos</span>
                </span>
                <span class="min-w-[3.25rem]">
                  <span
                    class="block text-2xl font-bold tabular-nums leading-none"
                    [class]="
                      carga.overdue > 0 ? 'text-danger' : 'text-ink-subtle'
                    ">
                    {{ carga.overdue }}
                  </span>
                  <span class="tv-label !tracking-wide">Vencidos</span>
                </span>
                <span class="min-w-[3.25rem]">
                  <span
                    class="block text-2xl font-bold tabular-nums leading-none"
                    [class]="
                      carga.blocked > 0 ? 'text-warn' : 'text-ink-subtle'
                    ">
                    {{ carga.blocked }}
                  </span>
                  <span class="tv-label !tracking-wide">Bloqueados</span>
                </span>
              </span>
            </li>
          }
        </ul>
      </div>
    } @else {
      <div class="flex h-full items-center justify-center">
        <p class="tv-title !font-normal text-ink-subtle">
          Ninguna fuente devolvió pendientes con responsable
        </p>
      </div>
    }

    @if (sinAsignar() > 0) {
      <p class="tv-row shrink-0 text-center text-ink-muted">
        {{ textoSinAsignar() }}
      </p>
    }
  `
})
export class EquipoSlideComponent {
  private readonly store = inject(PortalStore);

  /** Todas las personas con carga; la lista hace scroll. */
  readonly cargas = computed(() => teamWorkload(this.store.tasks()));

  readonly conAsignados = computed(
    () => this.cargas().filter((carga) => carga.open > 0).length
  );

  readonly textoConAsignados = computed(() => {
    const n = this.conAsignados();
    return `${plural(n, 'persona')} con pendientes asignados`;
  });

  readonly sinAsignar = computed(
    () =>
      this.store
        .tasks()
        .filter((tarea) => !tarea.assignee && tarea.status !== 'hecho').length
  );

  readonly textoSinAsignar = computed(
    () => `${plural(this.sinAsignar(), 'pendiente')} sin responsable`
  );

  private readonly maximo = computed(() =>
    Math.max(1, ...this.cargas().map((c) => c.open))
  );

  ancho(abiertos: number): number {
    return Math.round((abiertos / this.maximo()) * 100);
  }

  iniciales(nombre: string): string {
    return nombre
      .split(' ')
      .slice(0, 2)
      .map((parte) => parte.charAt(0).toUpperCase())
      .join('');
  }
}
