import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild
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
import { IaService, describirError } from '../../core/ia/ia.service';
import {
  EstadoBarrido,
  PuenteAdminService,
  ResumenAutoasignacion
} from '../../core/sources/gateway/puente-admin.service';
import { AvisosService } from '../../core/avisos/avisos.service';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { SesionService } from '../../core/acceso/sesion.service';
import { LocalTaskStore } from '../../core/sources/local/local-task.store';
import {
  groupByDue,
  openTasks,
  overdueTasks,
  tasksDueToday
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

/** Recorte rapido desde los accesos de arriba: vencidos o de hoy. */
type Foco = 'todos' | 'vencidos' | 'hoy';

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
  templateUrl: './pendientes.component.html',
  // En escritorio la pagina ocupa el alto disponible (cabecera del shell de
  // 4rem con su borde, mas 1.5rem de relleno arriba y abajo) y solo las
  // columnas hacen scroll.
  host: { class: 'block lg:flex lg:h-[calc(100dvh-7rem-1px)] lg:flex-col' }
})
export class PendientesComponent {
  private readonly store = inject(PortalStore);
  private readonly local = inject(LocalTaskStore);
  private readonly avisos = inject(AvisosService);
  private readonly sesion = inject(SesionService);
  private readonly admin = inject(PuenteAdminService);
  /** Con puente y equipo capturado se puede pedir el barrido de autoasignación. */
  readonly ia = inject(IaService);

  /** El campo de titulo del alta; recibe el foco al abrir el formulario. */
  private readonly tituloNuevo =
    viewChild<ElementRef<HTMLInputElement>>('tituloNuevo');

  constructor() {
    this.ia.cargarEquipo();
    // Si al entrar hay un barrido en curso (lo arranco otra pestaña, Telegram
    // o esta misma antes de recargar), se retoma el sondeo.
    if (this.ia.disponible) {
      this.admin.estadoAutoasignacion().subscribe({
        next: (estado) => {
          if (estado.enCurso) {
            this.autoasignando.set(true);
            this.mostrarAvance(estado);
            this.sondearAutoasignacion();
          }
        },
        error: () => undefined
      });
    }
    inject(DestroyRef).onDestroy(() => this.detenerSondeo());
    effect(() => {
      const campo = this.tituloNuevo();
      if (this.mostrarAlta() && campo) {
        campo.nativeElement.focus();
      }
    });
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
      this.abrirId.set(abrir);
      this.clearFiltersSuave();
    }
    effect(() => guardarMostrarHechos(this.includeDone()));
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
  /**
   * Los hechos no se muestran por omision; el interruptor se recuerda en este
   * navegador. Lo que se marco hecho en esta sesion y el pendiente que se
   * abrio desde una liga se ven aunque el interruptor este apagado.
   */
  readonly includeDone = signal(leerMostrarHechos());
  /** El pendiente que se pidio abrir por liga (`?abrir=`), aunque este hecho. */
  private readonly abrirId = signal<string | undefined>(undefined);
  /** Vencidos o de hoy, desde los accesos; "todos" no recorta. */
  readonly foco = signal<Foco>('todos');
  /** Del negocio (lo normal) o personales (lo que no es del negocio). */
  readonly vista = signal<'negocio' | 'personales'>('negocio');
  /** El formulario de alta se abre a pedido: la lista es lo primero. */
  readonly mostrarAlta = signal(false);
  /** En celular los filtros se pliegan detras del boton "Filtros". */
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
        this.foco() !== 'todos'
      ].filter(Boolean).length
  );
  readonly sinAsignar = computed(
    () =>
      this.store
        .tasks()
        .filter((t) => t.status !== 'hecho' && !t.assignee && !t.personal)
        .length
  );

  /**
   * Barrido de autoasignación: el botón abre una confirmación en línea y,
   * al aceptar, el puente recorre en segundo plano todos los pendientes de
   * correo sin responsable (puede tardar minutos: hasta 40 consultas a la
   * IA). Mientras corre se pregunta cómo va cada 3 s.
   */
  readonly confirmandoAutoasignar = signal(false);
  /** Incluir los que la IA ya revisó y siguen sin responsable ni sugerencia. */
  readonly reintentarRevisados = signal(false);
  readonly autoasignando = signal(false);
  readonly resultadoAutoasignacion = signal<
    { texto: string; error?: boolean } | undefined
  >(undefined);
  /** Lo asignado hasta ahora, para el "Revisando… (N asignados hasta ahora)". */
  readonly avanceAutoasignacion = signal<number | undefined>(undefined);
  private sondeo: ReturnType<typeof setInterval> | undefined;

  /** Alta rapida de un pendiente propio. */
  readonly newTitle = signal('');
  readonly newPriority = signal<TaskPriority>('media');
  readonly newDueDate = signal('');
  /** "HH:mm" o vacío: sin hora el pendiente es "para ese día". */
  readonly newDueTime = signal('');
  readonly newCompany = signal('');

  /** El equipo capturado mas quien aparezca como responsable en la lista. */
  readonly people = computed(() => {
    const byId = new Map<string, string>();
    for (const persona of this.ia.equipo()) {
      byId.set(persona.id, persona.name);
    }
    for (const task of this.store.tasks()) {
      if (task.assignee) {
        byId.set(task.assignee.id, task.assignee.name);
      }
    }
    return [...byId]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  /** Lo que pasa los filtros, antes del recorte de los accesos. */
  private readonly filtradoSinFoco = computed<TaskItem[]>(() => {
    const term = this.search().trim().toLowerCase();
    const owner = this.owner();
    const origin = this.origin();
    const priority = this.priority();
    const company = this.company();
    const sender = this.sender();
    const vista = this.vista();
    const includeDone = this.includeDone();
    this.abrirId();

    const base =
      vista === 'personales' ? this.local.tasks() : this.store.tasks();
    return base.filter((task) => {
      if (
        !includeDone &&
        task.status === 'hecho' &&
        !this.store.recienHechos().has(task.id) &&
        task.id !== this.abrirId()
      ) {
        return false;
      }
      if (owner === 'nadie' && task.assignee) {
        return false;
      }
      if (owner === 'mios') {
        // Lo mío: a mi nombre o donde doy seguimiento.
        const yo = this.sesion.correo()?.toLowerCase();
        const mio = (p?: { email?: string }) =>
          !!yo && p?.email?.toLowerCase() === yo;
        if (!mio(task.assignee) && !(task.followers ?? []).some(mio)) {
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

  private readonly filtered = computed<TaskItem[]>(() => {
    const foco = this.foco();
    const base = this.filtradoSinFoco();
    return foco === 'vencidos'
      ? overdueTasks(base)
      : foco === 'hoy'
        ? tasksDueToday(base)
        : base;
  });

  /** Cifras de los accesos: cuentan sobre el filtro actual, sin el recorte. */
  readonly vencidos = computed(
    () => overdueTasks(this.filtradoSinFoco()).length
  );
  readonly deHoy = computed(() => tasksDueToday(this.filtradoSinFoco()).length);

  /** Un acceso activo se vuelve a pulsar para quitarlo. */
  enfocar(foco: Foco): void {
    this.foco.set(this.foco() === foco ? 'todos' : foco);
  }

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

  pedirAutoasignar(): void {
    this.resultadoAutoasignacion.set(undefined);
    this.reintentarRevisados.set(false);
    this.confirmandoAutoasignar.set(true);
  }

  cancelarAutoasignar(): void {
    this.confirmandoAutoasignar.set(false);
  }

  autoasignarConfirmado(): void {
    if (this.autoasignando()) {
      return;
    }
    this.confirmandoAutoasignar.set(false);
    this.autoasignando.set(true);
    this.avanceAutoasignacion.set(undefined);
    this.resultadoAutoasignacion.set(undefined);
    this.admin
      .autoasignar({ reintentar: this.reintentarRevisados() })
      .subscribe({
        next: () => this.sondearAutoasignacion(),
        error: (error: unknown) => {
          this.autoasignando.set(false);
          this.resultadoAutoasignacion.set({
            texto: describirError(error),
            error: true
          });
        }
      });
  }

  /** Pregunta cómo va cada 3 s hasta que el puente diga que terminó. */
  private sondearAutoasignacion(): void {
    this.detenerSondeo();
    const consultar = () =>
      this.admin.estadoAutoasignacion().subscribe({
        next: (estado) => {
          if (estado.enCurso) {
            this.mostrarAvance(estado);
            return;
          }
          this.detenerSondeo();
          this.autoasignando.set(false);
          this.avanceAutoasignacion.set(undefined);
          this.resultadoAutoasignacion.set(
            estado.error
              ? { texto: `El barrido falló: ${estado.error}`, error: true }
              : estado.resumen
                ? { texto: describirAutoasignacion(estado.resumen) }
                : { texto: 'Sin barridos recientes.' }
          );
          // Para ver los responsables nuevos y los chips "Sugerido".
          this.store.refreshTasks();
        },
        error: (error: unknown) => {
          this.detenerSondeo();
          this.autoasignando.set(false);
          this.avanceAutoasignacion.set(undefined);
          this.resultadoAutoasignacion.set({
            texto: describirError(error),
            error: true
          });
        }
      });
    this.sondeo = setInterval(consultar, 3000);
    consultar();
  }

  private mostrarAvance(estado: EstadoBarrido): void {
    const r = estado.resumen;
    this.avanceAutoasignacion.set(
      r ? r.asignadosPorRegla.length + r.asignadosPorIa.length : undefined
    );
  }

  private detenerSondeo(): void {
    if (this.sondeo !== undefined) {
      clearInterval(this.sondeo);
      this.sondeo = undefined;
    }
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
    this.foco.set('todos');
  }
}

/** El resultado del barrido en una línea: qué quedó asignado, sugerido o sin propuesta. */
function describirAutoasignacion(r: ResumenAutoasignacion): string {
  const asignados = r.asignadosPorRegla.length + r.asignadosPorIa.length;
  return (
    `Asignados ${asignados} (regla ${r.asignadosPorRegla.length}, IA ${r.asignadosPorIa.length})` +
    ` · Sugeridos ${r.sugeridos.length}` +
    ` · Sin propuesta ${r.sinPropuesta}` +
    (r.omitidos > 0 ? ` · ${r.omitidos} por revisar en otra corrida` : '')
  );
}

/**
 * Cuándo se dio de alta: los propios llevan la marca de tiempo en el id
 * (`local-<ms>`); los demás, su última actualización.
 */
function fechaDeAlta(t: TaskItem): string {
  const ms = /^local-(?:\w+-)?(\d{13})/.exec(t.id)?.[1];
  return ms ? new Date(Number(ms)).toISOString() : t.updatedAt;
}

/** Preferencia de este navegador: si se ven o no los pendientes hechos. */
const CLAVE_MOSTRAR_HECHOS = 'ds-monitor.pendientes.mostrar-hechos';

function leerMostrarHechos(): boolean {
  try {
    return localStorage.getItem(CLAVE_MOSTRAR_HECHOS) === '1';
  } catch {
    return false;
  }
}

function guardarMostrarHechos(mostrar: boolean): void {
  try {
    if (mostrar) {
      localStorage.setItem(CLAVE_MOSTRAR_HECHOS, '1');
    } else {
      localStorage.removeItem(CLAVE_MOSTRAR_HECHOS);
    }
  } catch {
    // Sin almacenamiento (modo privado): se queda solo en la sesion.
  }
}
