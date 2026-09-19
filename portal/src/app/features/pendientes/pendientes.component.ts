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
      this.filtrosAbiertos.set(true);
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
  /** Los filtros se pliegan para que las dos columnas quepan en pantalla. */
  readonly filtrosAbiertos = signal(false);
  readonly filtrosActivos = computed(
    () =>
      [
        this.search().trim() !== '',
        this.owner() !== 'todos',
        this.origin() !== 'todos',
        this.priority() !== 'todas',
        this.company() !== 'todas',
        this.sender() !== 'todos',
        this.includeDone()
      ].filter(Boolean).length
  );
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
  /** "HH:mm" o vacío: sin hora el pendiente es "para ese día". */
  readonly newDueTime = signal('');
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

  /** Columna izquierda: lo que tiene fecha, agrupado por cuándo vence. */
  readonly groups = computed(() =>
    groupByDue(
      this.filtered().filter((t) => !!t.dueDate),
      DUE_BUCKET_ORDER
    ).filter((g) => g.bucket !== 'sin_fecha')
  );
  /**
   * Columna derecha: lo que aún no tiene fecha de entrega, lo más reciente
   * primero. En cuanto se le pone fecha, pasa a la izquierda.
   */
  readonly sinFecha = computed(() =>
    this.filtered()
      .filter((t) => !t.dueDate)
      .sort((a, b) => fechaDeAlta(b).localeCompare(fechaDeAlta(a)))
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
    const hora = due ? this.newDueTime() : '';
    const personal = this.vista() === 'personales';
    this.local.add({
      title: this.newTitle(),
      // Lo personal siempre es alta, y urgente si tiene fecha (el puente lo
      // vuelve a aplicar al guardar, por si viene de otro lado).
      priority: personal ? (due ? 'urgente' : 'alta') : this.newPriority(),
      // El input de tipo date entrega "2026-03-12"; sin hora se ancla a
      // mediodia para que caiga en ese día sin importar la zona horaria.
      dueDate: due
        ? new Date(`${due}T${hora || '12:00'}:00`).toISOString()
        : undefined,
      dueHasTime: !!hora,
      company: this.vista() === 'personales' ? undefined : this.newCompany(),
      personal: this.vista() === 'personales'
    });
    this.mostrarAlta.set(false);
    this.newTitle.set('');
    this.newDueDate.set('');
    this.newDueTime.set('');
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

/**
 * Cuándo se dio de alta: los propios llevan la marca de tiempo en el id
 * (`local-<ms>`); los demás, su última actualización.
 */
function fechaDeAlta(t: TaskItem): string {
  const ms = /^local-(?:\w+-)?(\d{13})/.exec(t.id)?.[1];
  return ms ? new Date(Number(ms)).toISOString() : t.updatedAt;
}
