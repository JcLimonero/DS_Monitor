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

/** Cuantas personas caben antes de que los renglones se aprieten. */
const RENGLONES = 10;

/** Carga del equipo de desarrollo: quién trae más y quién trae vencidos. */
@Component({
  selector: 'pt-slide-equipo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RelativePipe],
  host: { class: 'flex h-full flex-col gap-2 2xl:gap-3' },
  template: `
    @if (conAsignados() > 0) {
      <p class="shrink-0 text-center tv-row text-ink-muted">
        {{ textoConAsignados() }}
      </p>
    }
    @if (cargas().length > 0) {
      <ul
        class="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-y-auto lg:grid-cols-2 lg:gap-2.5 2xl:grid-cols-1 2xl:gap-3">
        @for (carga of cargas(); track carga.person.id) {
          <li
            class="tv-card flex shrink-0 items-center gap-3 px-3 py-2.5 lg:gap-4 lg:px-4 lg:py-3 2xl:gap-6 2xl:px-6 2xl:py-4">
            <span
              class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-soft text-base font-bold text-brand lg:h-12 lg:w-12 lg:text-xl 2xl:h-16 2xl:w-16 2xl:text-2xl">
              {{ iniciales(carga.person.name) }}
            </span>

            <span class="min-w-0 flex-1">
              <span class="block truncate tv-title">{{
                carga.person.name
              }}</span>
              <span
                class="block truncate text-sm text-ink-muted lg:text-base 2xl:text-xl">
                {{ carga.person.role ?? 'Sin rol' }}
              </span>
              @if (carga.oldestOpen; as viejo) {
                <span
                  class="mt-1 hidden truncate text-sm text-ink-muted lg:block 2xl:text-lg">
                  Más antiguo: {{ viejo.title }} ·
                  {{ viejo.updatedAt | relativo }}
                </span>
              }
              <span
                class="mt-1.5 block h-1.5 w-full max-w-md overflow-hidden rounded-full bg-surface-muted 2xl:mt-2 2xl:h-2">
                <span
                  class="block h-full rounded-full"
                  [class]="carga.overdue > 0 ? 'bg-danger' : 'bg-accent'"
                  [style.width.%]="ancho(carga.open)"></span>
              </span>
            </span>

            <span class="flex shrink-0 gap-3 text-center 2xl:gap-6">
              <span class="w-16 lg:w-20 2xl:w-28">
                <span
                  class="block text-2xl font-bold tabular-nums text-ink lg:text-3xl 2xl:text-5xl">
                  {{ carga.open }}
                </span>
                <span class="tv-label">Abiertos</span>
              </span>
              <span class="w-16 lg:w-20 2xl:w-28">
                <span
                  class="block text-2xl font-bold tabular-nums lg:text-3xl 2xl:text-5xl"
                  [class]="
                    carga.overdue > 0 ? 'text-danger' : 'text-ink-subtle'
                  ">
                  {{ carga.overdue }}
                </span>
                <span class="tv-label">Vencidos</span>
              </span>
              <span class="w-16 lg:w-20 2xl:w-28">
                <span
                  class="block text-2xl font-bold tabular-nums lg:text-3xl 2xl:text-5xl"
                  [class]="carga.blocked > 0 ? 'text-warn' : 'text-ink-subtle'">
                  {{ carga.blocked }}
                </span>
                <span class="tv-label">Bloqueados</span>
              </span>
            </span>
          </li>
        }
      </ul>
    } @else {
      <div class="flex h-full items-center justify-center">
        <p class="text-3xl text-ink-subtle">
          Ninguna fuente devolvió pendientes con responsable
        </p>
      </div>
    }

    @if (sinAsignar() > 0) {
      <p class="shrink-0 text-center tv-row text-ink-muted">
        {{ textoSinAsignar() }}
      </p>
    }
  `
})
export class EquipoSlideComponent {
  private readonly store = inject(PortalStore);

  readonly cargas = computed(() =>
    teamWorkload(this.store.tasks()).slice(0, RENGLONES)
  );

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
