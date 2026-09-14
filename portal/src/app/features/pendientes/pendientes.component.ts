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
  TASK_STATUS_LABEL,
  TaskItem,
  TaskOrigin,
  TaskPriority,
  TaskStatus
} from '../../core/models';
import { CURRENT_USER } from '../../core/sources/demo/demo-people';
import { LocalTaskStore } from '../../core/sources/local/local-task.store';
import {
  groupByDue,
  openTasks,
  overdueTasks
} from '../../core/state/portal.selectors';
import { PortalStore } from '../../core/state/portal.store';
import { DUE_BUCKET_LABEL, DUE_BUCKET_ORDER } from '../../core/util/date.util';
import { plural } from '../../core/util/text.util';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { IconComponent } from '../../ui/icon.component';
import { PageHeaderComponent } from '../../ui/page-header.component';
import { TaskCardComponent } from '../../ui/task-card.component';

/** Quien filtra la lista: yo, alguien del equipo, o todos. */
type OwnerFilter = 'todos' | 'mios' | string;

const ORIGIN_LABEL: Record<TaskOrigin, string> = {
  odoo: 'Odoo',
  ops: 'Ops',
  local: 'Propios'
};

@Component({
  selector: 'pt-pendientes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    EmptyStateComponent,
    FormsModule,
    IconComponent,
    PageHeaderComponent,
    TaskCardComponent
  ],
  templateUrl: './pendientes.component.html'
})
export class PendientesComponent {
  private readonly store = inject(PortalStore);
  private readonly local = inject(LocalTaskStore);

  readonly bucketLabel = DUE_BUCKET_LABEL;
  readonly originLabel = ORIGIN_LABEL;
  readonly statusLabel = TASK_STATUS_LABEL;
  readonly priorityLabel = TASK_PRIORITY_LABEL;
  readonly priorities: TaskPriority[] = ['urgente', 'alta', 'media', 'baja'];
  readonly statuses: TaskStatus[] = [
    'pendiente',
    'en_progreso',
    'bloqueado',
    'hecho'
  ];
  readonly origins: TaskOrigin[] = ['odoo', 'ops', 'local'];

  readonly search = signal('');
  readonly owner = signal<OwnerFilter>('todos');
  readonly origin = signal<TaskOrigin | 'todos'>('todos');
  readonly priority = signal<TaskPriority | 'todas'>('todas');
  readonly includeDone = signal(false);

  /** Alta rapida de un pendiente propio. */
  readonly newTitle = signal('');
  readonly newPriority = signal<TaskPriority>('media');
  readonly newDueDate = signal('');

  readonly people = computed(() => {
    const byId = new Map<string, string>();
    for (const task of this.store.tasks()) {
      if (task.assignee) {
        byId.set(task.assignee.id, task.assignee.name);
      }
    }
    return [...byId]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  private readonly filtered = computed<TaskItem[]>(() => {
    const term = this.search().trim().toLowerCase();
    const owner = this.owner();
    const origin = this.origin();
    const priority = this.priority();
    const includeDone = this.includeDone();

    return this.store.tasks().filter((task) => {
      if (!includeDone && task.status === 'hecho') {
        return false;
      }
      if (
        owner === 'mios' &&
        task.assignee &&
        task.assignee.id !== CURRENT_USER.id
      ) {
        return false;
      }
      if (
        owner !== 'todos' &&
        owner !== 'mios' &&
        task.assignee?.id !== owner
      ) {
        return false;
      }
      if (origin !== 'todos' && task.origin !== origin) {
        return false;
      }
      if (priority !== 'todas' && task.priority !== priority) {
        return false;
      }
      if (term) {
        const haystack = [
          task.title,
          task.description,
          task.project,
          ...task.tags
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(term);
      }
      return true;
    });
  });

  readonly groups = computed(() =>
    groupByDue(this.filtered(), DUE_BUCKET_ORDER)
  );
  readonly total = computed(() => this.filtered().length);
  readonly openCount = computed(() => openTasks(this.filtered()).length);
  readonly overdueCount = computed(() => overdueTasks(this.filtered()).length);

  readonly subtitle = computed(() =>
    [
      `${plural(this.total(), 'visible')} con los filtros`,
      plural(this.openCount(), 'abierto'),
      plural(this.overdueCount(), 'vencido')
    ].join(' · ')
  );

  readonly canAdd = computed(() => this.newTitle().trim().length > 0);

  addTask(): void {
    if (!this.canAdd()) {
      return;
    }
    const due = this.newDueDate();
    this.local.add({
      title: this.newTitle(),
      priority: this.newPriority(),
      // El input de tipo date entrega "2026-03-12"; se ancla a mediodia para
      // que el pendiente caiga en ese día sin importar la zona horaria.
      dueDate: due ? new Date(`${due}T12:00:00`).toISOString() : undefined
    });
    this.newTitle.set('');
    this.newDueDate.set('');
    this.store.refreshTasks();
  }

  clearFilters(): void {
    this.search.set('');
    this.owner.set('todos');
    this.origin.set('todos');
    this.priority.set('todas');
    this.includeDone.set(false);
  }
}
