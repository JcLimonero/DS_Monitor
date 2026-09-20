import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { AvisosService } from '../../../core/avisos/avisos.service';
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
import { TaskCardComponent } from '../../../ui/task-card.component';
import { DiapositivaConContenido } from '../carrusel.model';

/** Tope por columna: a tamaño de television no caben mas sin scroll. */
const RENGLONES = 12;

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
 *
 * Al tocar un renglon se abre el pendiente en un dialogo encima del carrusel,
 * con la misma tarjeta de la lista ya desplegada, para comentar, reasignar o
 * marcar hecho sin salir de la pantalla. Mientras el dialogo esta abierto el
 * carrusel no avanza (`enDialogo`).
 */
@Component({
  selector: 'pt-slide-pendientes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DayPipe, IconComponent, RouterLink, TaskCardComponent, TimePipe],
  host: {
    class: 'flex h-full flex-col',
    '(document:keydown.escape)': 'cerrar()'
  },
  template: `
    <div
      class="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:grid-rows-[minmax(0,1fr)] lg:gap-5">
      @for (col of columnas(); track col.id) {
        <section class="tv-card flex min-h-0 flex-col px-5 py-4">
          <h2 class="flex shrink-0 items-baseline gap-3">
            <span class="tv-label">{{ col.titulo }}</span>
            <span class="text-lg font-bold text-ink-muted">
              {{ col.tareas.length + col.restantes }}
            </span>
          </h2>

          @if (col.tareas.length > 0) {
            <ul class="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
              @for (tarea of col.tareas; track tarea.id) {
                <li
                  class="flex shrink-0 cursor-pointer items-start gap-3 rounded-lg border border-line px-3 py-2 transition hover:border-brand/60 hover:bg-surface-muted"
                  [class.border-danger]="esVencido(tarea)"
                  role="link"
                  tabindex="0"
                  [attr.aria-label]="'Abrir ' + tarea.title"
                  (click)="abrir(tarea)"
                  (keydown.enter)="abrir(tarea)">
                  <span
                    class="mt-2 h-2.5 w-2.5 shrink-0 rounded-full"
                    [class]="punto(tarea)"></span>
                  <span class="min-w-0 flex-1">
                    <span class="block tv-row font-bold leading-tight text-ink">
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

    <!--
      El detalle del pendiente, encima del carrusel (y de sus controles
      flotantes). En el celular y el iPad vertical es una hoja a pantalla
      completa con la barra de arriba fija y el cuerpo con scroll; desde el
      iPad apaisado (lg) es una ventana centrada. Clic fuera, Escape o el
      boton lo cierran.
    -->
    @if (seleccionada(); as tarea) {
      <div
        class="dialogo-carrusel fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-0 lg:items-center lg:p-6"
        (click)="cerrar()">
        <div
          class="card flex h-full w-full max-w-3xl flex-col rounded-none lg:h-auto lg:max-h-[90dvh] lg:rounded-xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dialogo-pendiente-titulo"
          (click)="$event.stopPropagation()">
          <header
            class="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2 lg:px-5">
            <h2
              id="dialogo-pendiente-titulo"
              class="text-sm font-semibold text-ink">
              Pendiente
            </h2>
            <a
              class="ml-auto text-sm font-semibold text-brand hover:underline"
              routerLink="/pendientes"
              [queryParams]="{ abrir: tarea.id }">
              Ver en Pendientes →
            </a>
            <button
              type="button"
              class="flex h-11 w-11 items-center justify-center rounded-lg text-ink-subtle hover:bg-surface-muted hover:text-ink"
              aria-label="Cerrar"
              (click)="cerrar()">
              <pt-icon name="cerrar" class="h-5 w-5" />
            </button>
          </header>
          <div class="min-h-0 flex-1 overflow-y-auto p-4 lg:p-5">
            <pt-task-card [task]="tarea" />
          </div>
        </div>
      </div>
    }
  `
})
export class PendientesSlideComponent implements DiapositivaConContenido {
  private readonly store = inject(PortalStore);
  private readonly avisos = inject(AvisosService);

  /** Ninguna de las tres columnas tiene algo. */
  readonly vacia = computed(() =>
    this.columnas().every((col) => col.tareas.length === 0)
  );

  /**
   * El id del pendiente abierto en el dialogo. Se guarda el id y no el objeto
   * para que la tarjeta refleje lo que se edite (estado, responsable) con la
   * misma copia que tiene el store.
   */
  private readonly seleccionadaId = signal<string | undefined>(undefined);
  /**
   * La ultima copia que se vio de ese pendiente. Mientras las fuentes
   * refrescan, `tasks()` puede venir un momento sin el; con el respaldo el
   * dialogo no parpadea ni se cierra a media edicion.
   */
  private readonly respaldo = signal<TaskItem | undefined>(undefined);
  private readonly enStore = computed(() => {
    const id = this.seleccionadaId();
    return id ? this.store.tasks().find((t) => t.id === id) : undefined;
  });
  readonly seleccionada = computed(() =>
    this.seleccionadaId() ? (this.enStore() ?? this.respaldo()) : undefined
  );

  /** Le dice al carrusel que no avance mientras alguien edita. */
  readonly enDialogo = computed(() => !!this.seleccionada());

  constructor() {
    // Cada vez que el store trae el pendiente, se actualiza el respaldo.
    effect(() => {
      const tarea = this.enStore();
      if (tarea) {
        this.respaldo.set(tarea);
      }
    });
  }

  /**
   * Abre el pendiente en el dialogo. Se avisa antes por `avisos.abrir` para
   * que la tarjeta nazca desplegada, igual que cuando se llega desde la
   * campana.
   */
  abrir(tarea: TaskItem): void {
    this.avisos.abrir.set(tarea.id);
    this.respaldo.set(tarea);
    this.seleccionadaId.set(tarea.id);
  }

  cerrar(): void {
    const id = this.seleccionadaId();
    if (!id) {
      return;
    }
    if (this.avisos.abrir() === id) {
      this.avisos.abrir.set(undefined);
    }
    this.seleccionadaId.set(undefined);
    this.respaldo.set(undefined);
  }

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
