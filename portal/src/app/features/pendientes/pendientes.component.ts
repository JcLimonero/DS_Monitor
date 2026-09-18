import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  SENDER_KIND_LABEL,
  SenderKind,
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  TaskItem,
  TaskOrigin,
  TaskPriority,
  TaskStatus
} from '../../core/models';
import { EMPRESAS } from '../../core/ia/ia.models';
import { AvisosService } from '../../core/avisos/avisos.service';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { SesionService } from '../../core/acceso/sesion.service';
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
  correo: 'Correo',
  local: 'Propios'
};

@Component({
  selector: 'pt-pendientes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
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
  private readonly avisos = inject(AvisosService);
  private readonly sesion = inject(SesionService);

  constructor() {
    // Llegar desde un aviso (o desde una liga en el correo) abre ese
    // pendiente aunque este hecho o no pase los filtros.
    const params = inject(ActivatedRoute).snapshot.queryParamMap;
    if (params.get('owner') === 'nadie') {
      this.owner.set('nadie');
    }
    if (params.get('vista') === 'personales') {
      this.vista.set('personales');
    }
    const abrir = params.get('abrir');
    if (abrir) {
      this.avisos.abrir.set(abrir);
      this.includeDone.set(true);
      this.clearFiltersSuave();
    }
  }

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
  readonly origins: TaskOrigin[] = ['odoo', 'ops', 'correo', 'local'];

  readonly search = signal('');
  readonly owner = signal<OwnerFilter>('todos');
  readonly origin = signal<TaskOrigin | 'todos'>('todos');
  readonly priority = signal<TaskPriority | 'todas'>('todas');
  readonly company = signal<string>('todas');
  /** De quién viene (solo aplica a los de correo). */
  readonly sender = signal<SenderKind | 'todos'>('todos');
  readonly senderLabel = SENDER_KIND_LABEL;
  readonly senders: SenderKind[] = ['empresa', 'equipo', 'por_identificar'];
  readonly porIdentificar = computed(
    () =>
      this.store
        .tasks()
        .filter(
          (t) => t.status !== 'hecho' && t.senderKind === 'por_identificar'
        ).length
  );
  readonly empresas = EMPRESAS;
  readonly includeDone = signal(false);
  /** Del negocio (lo normal) o personales (lo que no es del negocio). */
  readonly vista = signal<'negocio' | 'personales'>('negocio');
  /** El formulario de alta se abre a pedido: la lista es lo primero. */
  readonly mostrarAlta = signal(false);
  readonly sinAsignar = computed(
    () =>
      this.store
        .tasks()
        .filter((t) => t.status !== 'hecho' && !t.assignee && !t.personal)
        .length
  );

  /** Alta rapida de un pendiente propio. */
  readonly newTitle = signal('');
  readonly newPriority = signal<TaskPriority>('media');
  readonly newDueDate = signal('');
  readonly newCompany = signal('');

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
    const company = this.company();
    const sender = this.sender();
    const vista = this.vista();
    const includeDone = this.includeDone();

    const base =
      vista === 'personales' ? this.local.tasks() : this.store.tasks();
    return base.filter((task) => {
      if (
        !includeDone &&
        task.status === 'hecho' &&
        !this.store.recienHechos().has(task.id)
      ) {
        return false;
      }
      if (owner === 'nadie' && task.assignee) {
        return false;
      }
      if (owner === 'mios') {
        const yo = this.sesion.correo()?.toLowerCase();
        if (!task.assignee || task.assignee.email?.toLowerCase() !== yo) {
          return false;
        }
      }
      if (
        owner !== 'todos' &&
        owner !== 'mios' &&
        owner !== 'nadie' &&
        task.assignee?.id !== owner
      ) {
        return false;
      }
      if (vista === 'personales' ? !task.personal : !!task.personal) {
        return false;
      }
      if (origin !== 'todos' && task.origin !== origin) {
        return false;
      }
      if (priority !== 'todas' && task.priority !== priority) {
        return false;
      }
      if (
        company === 'ninguna'
          ? !!task.company
          : company !== 'todas' && task.company !== company
      ) {
        return false;
      }
      if (sender !== 'todos' && task.senderKind !== sender) {
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

  /** Del negocio siempre lleva empresa; lo personal se apunta en Personales. */
  readonly canAdd = computed(
    () =>
      this.newTitle().trim().length > 0 &&
      (this.vista() === 'personales' || this.newCompany() !== '')
  );

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
      dueDate: due ? new Date(`${due}T12:00:00`).toISOString() : undefined,
      company: this.vista() === 'personales' ? undefined : this.newCompany(),
      personal: this.vista() === 'personales'
    });
    this.mostrarAlta.set(false);
    this.newTitle.set('');
    this.newDueDate.set('');
    this.store.refreshTasks();
  }

  private clearFiltersSuave(): void {
    this.search.set('');
    this.owner.set('todos');
    this.origin.set('todos');
    this.priority.set('todas');
    this.company.set('todas');
    this.sender.set('todos');
  }

  clearFilters(): void {
    this.search.set('');
    this.owner.set('todos');
    this.origin.set('todos');
    this.priority.set('todas');
    this.company.set('todas');
    this.sender.set('todos');
    this.includeDone.set(false);
  }
}
