import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  TASK_PRIORITY_LABEL,
  TASK_PRIORITY_WEIGHT,
  TaskItem,
  TaskPriority
} from '../../core/models';
import { LocalTaskStore } from '../../core/sources/local/local-task.store';
import { PortalStore } from '../../core/state/portal.store';
import { plural } from '../../core/util/text.util';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { IconComponent } from '../../ui/icon.component';
import { PageHeaderComponent } from '../../ui/page-header.component';
import { TaskCardComponent } from '../../ui/task-card.component';

/**
 * Los pendientes personales: lo que uno se apunta para sí, aparte de lo que
 * viene de Odoo, de Ops o del correo. Se guardan en la aplicación.
 */
@Component({
  selector: 'pt-personales',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    EmptyStateComponent,
    FormsModule,
    IconComponent,
    PageHeaderComponent,
    TaskCardComponent
  ],
  templateUrl: './personales.component.html'
})
export class PersonalesComponent {
  private readonly store = inject(PortalStore);
  private readonly local = inject(LocalTaskStore);

  readonly priorityLabel = TASK_PRIORITY_LABEL;
  readonly priorities: TaskPriority[] = ['urgente', 'alta', 'media', 'baja'];

  readonly newTitle = signal('');
  readonly newPriority = signal<TaskPriority>('media');
  readonly newDueDate = signal('');
  readonly newProject = signal('');
  readonly includeDone = signal(false);

  readonly canAdd = computed(() => this.newTitle().trim().length > 0);
  readonly saveError = this.local.error;

  readonly open = computed<TaskItem[]>(() =>
    [...this.local.tasks()]
      .filter((task) => task.status !== 'hecho')
      .sort(
        (a, b) =>
          TASK_PRIORITY_WEIGHT[a.priority] - TASK_PRIORITY_WEIGHT[b.priority] ||
          (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9')
      )
  );

  readonly done = computed<TaskItem[]>(() =>
    [...this.local.tasks()]
      .filter((task) => task.status === 'hecho')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  );

  readonly subtitle = computed(() =>
    [
      plural(this.open().length, 'pendiente abierto', 'pendientes abiertos'),
      plural(this.done().length, 'hecho', 'hechos')
    ].join(' · ')
  );

  addTask(): void {
    if (!this.canAdd()) {
      return;
    }
    const due = this.newDueDate();
    this.local.add({
      title: this.newTitle(),
      priority: this.newPriority(),
      dueDate: due ? new Date(`${due}T12:00:00`).toISOString() : undefined,
      project: this.newProject() || undefined
    });
    this.newTitle.set('');
    this.newDueDate.set('');
    this.store.refreshTasks();
  }
}
