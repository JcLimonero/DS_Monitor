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
import {
  PUNTO_PLAZO,
  textoPlazo,
  tonoPlazo
} from '../../../core/util/plazo.util';
import { plural } from '../../../core/util/text.util';
import { IconComponent } from '../../../ui/icon.component';
import { DayPipe, TimePipe } from '../../../ui/portal.pipes';

/** Cuantos renglones caben por columna sin que haya que hacer scroll. */
const RENGLONES = 8;

const CLASE_PRIORIDAD: Record<TaskPriority, string> = {
  urgente: 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200',
  alta: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
  media: 'bg-surface-muted text-ink-muted',
  baja: 'bg-surface-muted text-ink-subtle'
};

interface Columna {
  id: 'hoy' | 'manana' | 'despues';
  titulo: string;
  tareas: TaskItem[];
  restantes: number;
}

/**
 * Los pendientes abiertos en tres columnas: hoy (con lo vencido arriba),
 * mañana, y lo que viene después con su fecha y un punto de color según lo
 * que falta. Lo sin fecha no sale aquí: no compite con lo que sí tiene
 * compromiso.
 */
@Component({
  selector: 'pt-slide-pendientes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DayPipe, IconComponent, TimePipe],
  host: { class: 'flex h-full flex-col' },
  template: `
    <div class="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
      @for (col of columnas(); track col.id) {
        <section class="tv-card flex min-h-0 flex-col px-5 py-4">
          <h2 class="flex shrink-0 items-baseline gap-3">
            <span class="tv-label">{{ col.titulo }}</span>
            <span class="text-lg font-bold text-ink-muted">
              {{ col.tareas.length + col.restantes }}
            </span>
          </h2>

          @if (col.tareas.length > 0) {
            <ul class="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
              @for (tarea of col.tareas; track tarea.id) {
                <li
                  class="flex shrink-0 items-start gap-3 rounded-lg border border-line px-3 py-2"
                  [class.border-danger]="esVencido(tarea)">
                  <span
                    class="mt-2 h-2.5 w-2.5 shrink-0 rounded-full"
                    [class]="punto(tarea)"></span>
                  <span class="min-w-0 flex-1">
                    <span
                      class="block text-lg font-bold leading-tight text-ink 2xl:text-xl">
                      {{ tarea.title }}
                    </span>
                    <span
                      class="mt-0.5 block truncate text-base text-ink-muted">
                      @if (tarea.company) {
                        {{ tarea.company }} ·
                      }
                      {{ tarea.assignee?.name ?? 'Sin asignar' }}
                    </span>
                  </span>
                  <span class="shrink-0 text-right">
                    @if (col.id === 'despues') {
                      <span
                        class="block whitespace-nowrap text-base font-bold text-ink">
                        {{ tarea.dueDate | dia }}
                      </span>
                      <span
                        class="block whitespace-nowrap text-sm text-ink-muted">
                        {{ plazo(tarea) }}
                      </span>
                    } @else if (esVencido(tarea)) {
                      <span
                        class="block whitespace-nowrap text-base font-bold text-danger">
                        Vencido
                      </span>
                      <span
                        class="block whitespace-nowrap text-sm text-ink-muted">
                        {{ tarea.dueDate | dia }}
                      </span>
                    } @else {
                      <span
                        class="block whitespace-nowrap text-base font-bold text-ink">
                        {{
                          tarea.dueHasTime
                            ? (tarea.dueDate | hora)
                            : col.id === 'hoy'
                              ? 'hoy'
                              : 'mañana'
                        }}
                      </span>
                      <span
                        class="chip mt-0.5 px-2 py-0.5 text-xs"
                        [class]="clasePrioridad(tarea)">
                        {{ etiquetaPrioridad(tarea) }}
                      </span>
                    }
                  </span>
                </li>
              }
            </ul>
            @if (col.restantes > 0) {
              <p class="mt-2 shrink-0 text-center text-base text-ink-muted">
                y {{ col.restantes }} más
              </p>
            }
          } @else {
            <div
              class="flex flex-1 flex-col items-center justify-center gap-2 text-center text-ink-subtle">
              <pt-icon name="ok" class="h-10 w-10 text-ok" />
              <p class="text-lg">Nada por aquí</p>
            </div>
          }
        </section>
      }
    </div>
  `
})
export class PendientesSlideComponent {
  private readonly store = inject(PortalStore);

  readonly columnas = computed<Columna[]>(() => {
    const ahora = new Date();
    const abiertos = openTasks(this.store.tasks()).sort((a, b) =>
      byUrgency(a, b, ahora)
    );
    const hoy = abiertos.filter((t) => {
      const c = dueBucket(t.dueDate, ahora);
      return c === 'vencido' || c === 'hoy';
    });
    const manana = abiertos.filter(
      (t) => dueBucket(t.dueDate, ahora) === 'manana'
    );
    const despues = abiertos
      .filter((t) => {
        const c = dueBucket(t.dueDate, ahora);
        return c === 'semana' || c === 'despues';
      })
      .sort((a, b) => (a.dueDate as string).localeCompare(b.dueDate as string));
    const columna = (
      id: Columna['id'],
      titulo: string,
      tareas: TaskItem[]
    ): Columna => ({
      id,
      titulo,
      tareas: tareas.slice(0, RENGLONES),
      restantes: Math.max(0, tareas.length - RENGLONES)
    });
    return [
      columna('hoy', 'Hoy', hoy),
      columna('manana', 'Mañana', manana),
      columna('despues', 'Por venir', despues)
    ];
  });

  readonly abiertosTotal = computed(() =>
    plural(openTasks(this.store.tasks()).length, 'pendiente')
  );

  esVencido(tarea: TaskItem): boolean {
    return isOverdue(tarea.dueDate);
  }

  punto(tarea: TaskItem): string {
    return tarea.dueDate
      ? PUNTO_PLAZO[tonoPlazo(tarea.dueDate)]
      : 'bg-ink-subtle';
  }

  plazo(tarea: TaskItem): string {
    return tarea.dueDate ? textoPlazo(tarea.dueDate) : '';
  }

  clasePrioridad(tarea: TaskItem): string {
    return CLASE_PRIORIDAD[tarea.priority];
  }

  etiquetaPrioridad(tarea: TaskItem): string {
    return TASK_PRIORITY_LABEL[tarea.priority];
  }
}
