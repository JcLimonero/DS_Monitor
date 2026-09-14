import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject
} from '@angular/core';
import { teamWorkload } from '../../../core/state/portal.selectors';
import { PortalStore } from '../../../core/state/portal.store';
import { plural } from '../../../core/util/text.util';

/** Cuantas personas caben antes de que los renglones se aprieten. */
const RENGLONES = 6;

/** Carga del equipo de desarrollo: quién trae más y quién trae vencidos. */
@Component({
  selector: 'pt-slide-equipo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full flex-col gap-3' },
  template: `
    @if (cargas().length > 0) {
      <ul
        class="flex min-h-0 flex-1 flex-col justify-center gap-3 overflow-hidden">
        @for (carga of cargas(); track carga.person.id) {
          <li class="tv-card flex shrink-0 items-center gap-6 px-6 py-4">
            <span
              class="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-brand-soft text-2xl font-bold text-brand">
              {{ iniciales(carga.person.name) }}
            </span>

            <span class="min-w-0 flex-1">
              <span class="block truncate tv-title">{{
                carga.person.name
              }}</span>
              <span class="block truncate text-lg text-ink-muted 2xl:text-xl">
                {{ carga.person.role ?? 'Sin rol' }}
              </span>
              <span
                class="mt-2 block h-2 w-full max-w-md overflow-hidden rounded-full bg-surface-muted">
                <span
                  class="block h-full rounded-full"
                  [class]="carga.overdue > 0 ? 'bg-danger' : 'bg-accent'"
                  [style.width.%]="ancho(carga.open)"></span>
              </span>
            </span>

            <span class="flex shrink-0 gap-6 text-center">
              <span class="w-28">
                <span
                  class="block text-4xl font-bold tabular-nums text-ink 2xl:text-5xl">
                  {{ carga.open }}
                </span>
                <span class="tv-label">Abiertos</span>
              </span>
              <span class="w-28">
                <span
                  class="block text-4xl font-bold tabular-nums 2xl:text-5xl"
                  [class]="
                    carga.overdue > 0 ? 'text-danger' : 'text-ink-subtle'
                  ">
                  {{ carga.overdue }}
                </span>
                <span class="tv-label">Vencidos</span>
              </span>
              <span class="w-28">
                <span
                  class="block text-4xl font-bold tabular-nums 2xl:text-5xl"
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
