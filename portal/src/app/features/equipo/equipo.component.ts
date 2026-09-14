import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal
} from '@angular/core';
import { TaskItem } from '../../core/models';
import { teamWorkload } from '../../core/state/portal.selectors';
import { PortalStore } from '../../core/state/portal.store';
import { plural } from '../../core/util/text.util';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { PageHeaderComponent } from '../../ui/page-header.component';
import { TaskCardComponent } from '../../ui/task-card.component';

@Component({
  selector: 'pt-equipo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EmptyStateComponent, PageHeaderComponent, TaskCardComponent],
  templateUrl: './equipo.component.html'
})
export class EquipoComponent {
  private readonly store = inject(PortalStore);

  /** Persona cuyo detalle está abierto. Solo una a la vez. */
  readonly expanded = signal<string | undefined>(undefined);

  readonly loads = computed(() => teamWorkload(this.store.tasks()));

  readonly unassigned = computed<TaskItem[]>(() =>
    this.store
      .tasks()
      .filter((task) => !task.assignee && task.status !== 'hecho')
  );

  /** La carga más alta del equipo; sirve de escala para las barras. */
  readonly subtitle = computed(
    () => `${plural(this.loads().length, 'persona')} con pendientes asignados`
  );

  private readonly maxOpen = computed(() =>
    Math.max(1, ...this.loads().map((load) => load.open))
  );

  readonly unassignedHint = computed(
    () =>
      `${plural(this.unassigned().length, 'pendiente')} abiertos que nadie tiene a su nombre`
  );

  barWidth(open: number): number {
    return Math.round((open / this.maxOpen()) * 100);
  }

  toggle(personId: string): void {
    this.expanded.update((current) =>
      current === personId ? undefined : personId
    );
  }

  openTasksOf(personId: string): TaskItem[] {
    return (
      this.loads()
        .find((load) => load.person.id === personId)
        ?.tasks.filter((task) => task.status !== 'hecho') ?? []
    );
  }

  initials(name: string): string {
    return name
      .split(' ')
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('');
  }
}
