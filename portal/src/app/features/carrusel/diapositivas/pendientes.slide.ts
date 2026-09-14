import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject
} from '@angular/core';
import {
  TASK_PRIORITY_LABEL,
  TaskItem,
  TaskPriority
} from '../../../core/models';
import { byUrgency, openTasks } from '../../../core/state/portal.selectors';
import { PortalStore } from '../../../core/state/portal.store';
import { dueBucket, isOverdue } from '../../../core/util/date.util';
import { plural } from '../../../core/util/text.util';
import { IconComponent } from '../../../ui/icon.component';
import { DayPipe, TimePipe } from '../../../ui/portal.pipes';

/** Cuantos renglones caben en la pantalla sin que haya que hacer scroll. */
const RENGLONES = 7;

const CLASE_PRIORIDAD: Record<TaskPriority, string> = {
  urgente: 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200',
  alta: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
  media: 'bg-surface-muted text-ink-muted',
  baja: 'bg-surface-muted text-ink-subtle'
};

/** Lo que está vencido o vence hoy, de cualquier fuente. */
@Component({
  selector: 'pt-slide-pendientes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DayPipe, IconComponent, TimePipe],
  host: { class: 'flex h-full flex-col' },
  template: `
    @if (criticos().length > 0) {
      <ul
        class="flex min-h-0 flex-1 flex-col justify-center gap-3 overflow-hidden">
        @for (tarea of visibles(); track tarea.id) {
          <li
            class="tv-card flex shrink-0 items-center gap-5 px-6 py-4"
            [class.border-danger]="esVencido(tarea)">
            <span
              class="chip shrink-0 px-3 py-1 text-base"
              [class]="clasePrioridad(tarea)">
              {{ etiquetaPrioridad(tarea) }}
            </span>

            <span class="min-w-0 flex-1">
              <span class="block truncate tv-title">{{ tarea.title }}</span>
              <span
                class="mt-0.5 block truncate text-lg text-ink-muted 2xl:text-xl">
                {{ tarea.assignee?.name ?? 'Sin asignar' }}
                @if (tarea.project) {
                  · {{ tarea.project }}
                }
              </span>
            </span>

            <span class="shrink-0 text-right">
              <span
                class="block whitespace-nowrap tv-row font-bold"
                [class]="esVencido(tarea) ? 'text-danger' : 'text-ink'">
                {{
                  esVencido(tarea) ? 'Vencido' : 'Hoy ' + (tarea.dueDate | hora)
                }}
              </span>
              <span class="block whitespace-nowrap text-lg text-ink-muted">
                {{ tarea.dueDate | dia }}
              </span>
            </span>
          </li>
        }
      </ul>

      @if (restantes() > 0) {
        <p class="mt-3 shrink-0 text-center tv-row text-ink-muted">
          y {{ etiquetaRestantes() }} más
        </p>
      }
    } @else {
      <div
        class="flex h-full flex-col items-center justify-center gap-4 text-center">
        <pt-icon name="ok" class="h-24 w-24 text-ok" />
        <p class="text-4xl font-bold text-ink 2xl:text-5xl">
          Nada vencido ni para hoy
        </p>
        <p class="tv-row text-ink-muted">
          {{ abiertosTotal() }} abiertos, todos con fecha por delante
        </p>
      </div>
    }
  `
})
export class PendientesSlideComponent {
  private readonly store = inject(PortalStore);

  readonly criticos = computed(() => {
    const ahora = new Date();
    return openTasks(this.store.tasks())
      .filter((tarea) => {
        const cubeta = dueBucket(tarea.dueDate, ahora);
        return cubeta === 'vencido' || cubeta === 'hoy';
      })
      .sort((a, b) => byUrgency(a, b, ahora));
  });

  readonly visibles = computed(() => this.criticos().slice(0, RENGLONES));
  readonly restantes = computed(() =>
    Math.max(0, this.criticos().length - RENGLONES)
  );
  readonly etiquetaRestantes = computed(() =>
    plural(this.restantes(), 'pendiente')
  );
  readonly abiertosTotal = computed(() =>
    plural(openTasks(this.store.tasks()).length, 'pendiente')
  );

  esVencido(tarea: TaskItem): boolean {
    return isOverdue(tarea.dueDate);
  }

  clasePrioridad(tarea: TaskItem): string {
    return CLASE_PRIORIDAD[tarea.priority];
  }

  etiquetaPrioridad(tarea: TaskItem): string {
    return TASK_PRIORITY_LABEL[tarea.priority];
  }
}
