import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IaService, describirError } from '../core/ia/ia.service';
import { Borrador, EMPRESAS } from '../core/ia/ia.models';
import {
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  TaskItem,
  TaskPriority,
  TaskStatus
} from '../core/models';
import { LocalTaskStore } from '../core/sources/local/local-task.store';
import { PortalStore } from '../core/state/portal.store';
import { isOverdue } from '../core/util/date.util';
import { ACCOUNT_BAR_CLASS } from './account-colors';
import { AccountChipComponent } from './account-chip.component';
import { IconComponent } from './icon.component';
import { DayPipe, RelativePipe } from './portal.pipes';

const PRIORITY_CLASS: Record<TaskPriority, string> = {
  urgente: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  alta: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  media: 'bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300',
  baja: 'bg-slate-100 text-slate-500 dark:bg-slate-500/10 dark:text-slate-400'
};

const STATUS_CLASS: Record<TaskStatus, string> = {
  pendiente: 'text-ink-muted',
  en_progreso: 'text-info',
  bloqueado: 'text-danger',
  hecho: 'text-ok'
};

/** Color del chip de empresa, para distinguirlas de un vistazo. */
const COMPANY_CLASS: Record<string, string> = {
  'Itech Dev':
    'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  'Dealer Solutions':
    'bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300',
  NexusQTech:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  OperativAI:
    'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300'
};

/**
 * Renglon de pendiente. Lo comparten el panel, la lista y la vista de equipo.
 *
 * Cerrado enseña lo esencial; abierto (clic en el título) deja comentar,
 * marcar hecho, asignar a alguien del equipo y, si vino por correo, pedir un
 * borrador de respuesta. Todo eso se guarda en el puente y aplica a cualquier
 * origen: correo, Ops, Odoo o propios.
 */
@Component({
  selector: 'pt-task-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AccountChipComponent,
    FormsModule,
    IconComponent,
    DayPipe,
    RelativePipe
  ],
  template: `
    <article
      class="relative overflow-hidden rounded-lg border border-line bg-surface px-4 py-3 transition hover:border-brand/40"
      [class.border-brand]="open()">
      <span class="account-bar" [class]="barClass()"></span>
      <div class="flex items-start gap-3 pl-2">
        <button
          type="button"
          class="mt-0.5 h-4 w-4 shrink-0 rounded border border-line transition hover:border-brand"
          [class.bg-brand]="done()"
          [class.border-brand]="done()"
          [disabled]="saving()"
          [attr.aria-label]="
            done() ? 'Marcar como pendiente' : 'Marcar como hecho'
          "
          (click)="toggle()"></button>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <button
              type="button"
              class="text-left text-sm font-medium text-ink hover:underline"
              [class.line-through]="done()"
              [class.text-ink-subtle]="done()"
              (click)="open.set(!open())">
              {{ task().title }}
            </button>
            <span class="chip" [class]="priorityClass()">{{
              priorityLabel()
            }}</span>
            @if (task().company; as company) {
              <span class="chip" [class]="companyClass()">{{ company }}</span>
            }
            @if (overdue()) {
              <span
                class="chip bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                Vencido
              </span>
            }
            @if (comments().length > 0) {
              <span class="chip bg-surface-muted text-ink-muted">
                {{ comments().length }}
                {{ comments().length === 1 ? 'comentario' : 'comentarios' }}
              </span>
            }
          </div>

          @if (task().description) {
            <p
              class="mt-1 whitespace-pre-line text-sm text-ink-muted"
              [class.line-clamp-2]="!open()">
              {{ task().description }}
            </p>
          }

          <div
            class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
            <pt-account-chip [accountId]="task().accountId" />
            @for (cuenta of task().alsoIn ?? []; track cuenta) {
              <pt-account-chip [accountId]="cuenta" />
            }
            <span [class]="statusClass()">{{ statusLabel() }}</span>
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded px-1 transition hover:bg-surface-muted hover:text-ink"
              [class.text-ink-subtle]="!task().assignee"
              [attr.aria-label]="
                task().assignee ? 'Cambiar responsable' : 'Asignar a alguien'
              "
              (click)="abrirAsignar()">
              <pt-icon name="equipo" class="h-3.5 w-3.5" />
              {{ task().assignee?.name ?? 'Sin asignar · asignar' }}
            </button>
            @if (task().project; as project) {
              <span class="text-ink-subtle">{{ project }}</span>
            }
            @if (task().dueDate; as due) {
              <span
                class="inline-flex items-center gap-1"
                [class.text-danger]="overdue()">
                <pt-icon name="reloj" class="h-3.5 w-3.5" />
                {{ due | dia }} · {{ due | relativo }}
              </span>
            }
          </div>

          @if (open()) {
            <div class="mt-3 space-y-3 border-t border-line pt-3">
              @if (comments().length > 0) {
                <ul class="space-y-1.5">
                  @for (c of comments(); track c.at) {
                    <li class="text-sm">
                      <span class="text-ink">{{ c.text }}</span>
                      <span class="ml-2 text-xs text-ink-subtle"
                        >{{ c.by ?? 'alguien' }} · {{ c.at | relativo }}</span
                      >
                    </li>
                  }
                </ul>
              }

              @if (ia.disponible) {
                <form
                  class="flex flex-wrap items-end gap-2"
                  (ngSubmit)="comment()">
                  <label class="min-w-0 flex-1">
                    <span class="mb-1 block text-xs font-medium text-ink-muted"
                      >Comentario</span
                    >
                    <input
                      class="field"
                      type="text"
                      placeholder="Qué pasó, qué falta…"
                      [ngModel]="draft()"
                      (ngModelChange)="draft.set($event)"
                      name="comentario-{{ task().id }}" />
                  </label>
                  <button
                    type="submit"
                    class="btn"
                    [disabled]="!draft().trim() || saving()">
                    Comentar
                  </button>
                </form>

                <div class="flex flex-wrap items-end gap-2">
                  <label>
                    <span class="mb-1 block text-xs font-medium text-ink-muted"
                      >Asignar a</span
                    >
                    <select
                      class="field"
                      [ngModel]="assignTo()"
                      (ngModelChange)="assignTo.set($event)"
                      name="asignar-{{ task().id }}">
                      <option value="">Nadie</option>
                      @for (p of ia.equipo(); track p.id) {
                        <option [value]="p.email ?? p.id">{{ p.name }}</option>
                      }
                    </select>
                  </label>
                  <button
                    type="button"
                    class="btn"
                    [disabled]="saving()"
                    (click)="assign()">
                    Asignar y avisar
                  </button>
                  <button
                    type="button"
                    class="btn"
                    [disabled]="saving()"
                    (click)="startEdit()">
                    Editar
                  </button>
                  @if (task().dueDate && ia.calendarios().length > 0) {
                    <button
                      type="button"
                      class="btn"
                      [disabled]="saving()"
                      (click)="agendar()">
                      <pt-icon name="agenda" class="h-4 w-4" />
                      Agendar
                    </button>
                  }
                  @if (task().origin === 'correo' && ia.activa() !== false) {
                    <button
                      type="button"
                      class="btn"
                      [disabled]="drafting()"
                      (click)="reply()">
                      <pt-icon name="bandeja" class="h-4 w-4" />
                      {{ drafting() ? 'Redactando…' : 'Borrador de respuesta' }}
                    </button>
                  }
                </div>
              }

              @if (editing(); as e) {
                <form
                  class="grid gap-2 rounded-lg bg-surface-muted p-3 sm:grid-cols-2"
                  (ngSubmit)="saveEdit()">
                  <label class="sm:col-span-2">
                    <span class="mb-1 block text-xs font-medium text-ink-muted"
                      >Título</span
                    >
                    <input
                      class="field"
                      type="text"
                      name="e-titulo-{{ task().id }}"
                      [ngModel]="e.title"
                      (ngModelChange)="patchEdit({ title: $event })" />
                  </label>
                  <label>
                    <span class="mb-1 block text-xs font-medium text-ink-muted"
                      >Prioridad</span
                    >
                    <select
                      class="field"
                      name="e-prio-{{ task().id }}"
                      [ngModel]="e.priority"
                      (ngModelChange)="patchEdit({ priority: $event })">
                      <option value="urgente">Urgente</option>
                      <option value="alta">Alta</option>
                      <option value="media">Media</option>
                      <option value="baja">Baja</option>
                    </select>
                  </label>
                  <label>
                    <span class="mb-1 block text-xs font-medium text-ink-muted"
                      >Para cuándo</span
                    >
                    <input
                      class="field"
                      type="datetime-local"
                      name="e-fecha-{{ task().id }}"
                      [ngModel]="e.dueLocal"
                      (ngModelChange)="patchEdit({ dueLocal: $event })" />
                  </label>
                  <label>
                    <span class="mb-1 block text-xs font-medium text-ink-muted"
                      >Empresa</span
                    >
                    <select
                      class="field"
                      name="e-emp-{{ task().id }}"
                      [ngModel]="e.company"
                      (ngModelChange)="patchEdit({ company: $event })">
                      <option value="">Sin empresa</option>
                      @for (emp of empresas; track emp) {
                        <option [value]="emp">{{ emp }}</option>
                      }
                    </select>
                  </label>
                  <label>
                    <span class="mb-1 block text-xs font-medium text-ink-muted"
                      >Proyecto / cliente</span
                    >
                    <input
                      class="field"
                      type="text"
                      name="e-proy-{{ task().id }}"
                      [ngModel]="e.project"
                      (ngModelChange)="patchEdit({ project: $event })" />
                  </label>
                  <div class="flex gap-2 sm:col-span-2">
                    <button
                      type="submit"
                      class="btn btn-primary"
                      [disabled]="saving() || !e.title.trim()">
                      Guardar cambios
                    </button>
                    <button
                      type="button"
                      class="btn"
                      (click)="editing.set(undefined)">
                      Cancelar
                    </button>
                  </div>
                </form>
              }

              @if (message(); as m) {
                <p class="text-xs text-ink-muted">{{ m }}</p>
              }

              @if (borrador(); as b) {
                <div class="rounded-lg bg-surface-muted p-3">
                  <p class="text-xs text-ink-muted">
                    Para: {{ b.para ?? '(sin remitente)' }} · Asunto:
                    {{ b.asunto }}
                  </p>
                  <textarea
                    class="field mt-2 min-h-32 w-full"
                    [ngModel]="b.cuerpo"
                    (ngModelChange)="
                      borrador.set({
                        para: b.para,
                        asunto: b.asunto,
                        cuerpo: $event
                      })
                    "
                    name="borrador-{{ task().id }}"></textarea>
                  <div class="mt-2 flex flex-wrap gap-2">
                    <a class="btn btn-primary" [href]="mailto()">
                      Abrir en mi correo
                    </a>
                    <button type="button" class="btn" (click)="copy()">
                      Copiar texto
                    </button>
                    <span class="self-center text-xs text-ink-subtle"
                      >Revísalo antes de mandar: el puente no envía nada por
                      ti.</span
                    >
                  </div>
                </div>
              }
            </div>
          }
        </div>

        <div class="flex shrink-0 items-center gap-1">
          <button
            type="button"
            class="rounded p-1 text-ink-subtle transition hover:bg-surface-muted hover:text-ink"
            [attr.aria-label]="
              open() ? 'Cerrar detalle' : 'Comentar, asignar o marcar'
            "
            [attr.aria-expanded]="open()"
            (click)="open.set(!open())">
            <pt-icon
              name="siguiente"
              class="h-4 w-4 transition"
              [class.rotate-90]="open()" />
          </button>
          @if (task().url; as url) {
            <a
              class="rounded p-1 text-ink-subtle transition hover:bg-surface-muted hover:text-ink"
              [href]="url"
              target="_blank"
              rel="noopener"
              [attr.aria-label]="'Abrir ' + task().title + ' en su sistema'">
              <pt-icon name="externo" class="h-4 w-4" />
            </a>
          }
          @if (task().origin === 'local' || done()) {
            <button
              type="button"
              class="rounded p-1 text-ink-subtle transition hover:bg-surface-muted hover:text-danger"
              [disabled]="saving()"
              [attr.aria-label]="'Eliminar ' + task().title"
              title="Eliminar"
              (click)="remove()">
              <pt-icon name="basura" class="h-4 w-4" />
            </button>
          }
        </div>
      </div>
    </article>
  `
})
export class TaskCardComponent {
  private readonly store = inject(PortalStore);
  private readonly local = inject(LocalTaskStore);
  readonly ia = inject(IaService);

  readonly task = input.required<TaskItem>();

  readonly open = signal(false);
  readonly draft = signal('');
  readonly assignTo = signal('');
  readonly saving = signal(false);
  readonly drafting = signal(false);
  readonly message = signal<string | undefined>(undefined);
  readonly borrador = signal<Borrador | undefined>(undefined);
  readonly empresas = EMPRESAS;
  /** Copia editable del pendiente mientras el formulario está abierto. */
  readonly editing = signal<
    | {
        title: string;
        priority: string;
        dueLocal: string;
        company: string;
        project: string;
      }
    | undefined
  >(undefined);

  readonly done = computed(() => this.task().status === 'hecho');
  readonly overdue = computed(
    () => !this.done() && isOverdue(this.task().dueDate)
  );
  readonly comments = computed(() => this.task().comments ?? []);
  readonly priorityLabel = computed(
    () => TASK_PRIORITY_LABEL[this.task().priority]
  );
  readonly priorityClass = computed(() => PRIORITY_CLASS[this.task().priority]);
  readonly companyClass = computed(
    () =>
      COMPANY_CLASS[this.task().company ?? ''] ??
      'bg-surface-muted text-ink-muted'
  );
  readonly statusLabel = computed(() => TASK_STATUS_LABEL[this.task().status]);
  readonly statusClass = computed(() => STATUS_CLASS[this.task().status]);
  readonly barClass = computed(
    () =>
      ACCOUNT_BAR_CLASS[
        this.store.accountOf(this.task().accountId)?.color ?? 'slate'
      ]
  );
  readonly mailto = computed(() => {
    const b = this.borrador();
    if (!b) {
      return '';
    }
    return `mailto:${encodeURIComponent(b.para ?? '')}?subject=${encodeURIComponent(b.asunto)}&body=${encodeURIComponent(b.cuerpo)}`;
  });

  constructor() {
    this.ia.cargarEquipo();
  }

  /**
   * Marcar hecho vale para cualquier origen: se anota en el puente y se
   * sirve encima de lo que diga la fuente. Sin puente (demostración) solo
   * los propios cambian, en memoria.
   */
  /** Abre la tarjeta y lleva el foco al selector de responsable. */
  abrirAsignar(): void {
    this.open.set(true);
    setTimeout(() => {
      const select = document.querySelector<HTMLSelectElement>(
        `select[name="asignar-${CSS.escape(this.task().id)}"]`
      );
      select?.focus();
    });
  }

  toggle(): void {
    if (!this.ia.disponible) {
      if (this.task().origin === 'local') {
        this.local.toggleDone(this.task().id);
        this.store.refreshTasks();
      }
      return;
    }
    this.guardar({ hecho: !this.done() });
  }

  comment(): void {
    const texto = this.draft().trim();
    if (!texto) {
      return;
    }
    this.guardar({ comentario: texto }, () => this.draft.set(''));
  }

  assign(): void {
    this.guardar({ asignarA: this.assignTo(), tarea: this.task() });
  }

  reply(): void {
    this.drafting.set(true);
    this.message.set(undefined);
    this.ia.respuesta(this.task().id).subscribe({
      next: (b) => {
        this.borrador.set(b);
        this.drafting.set(false);
      },
      error: (error: unknown) => {
        this.message.set(describirError(error));
        this.drafting.set(false);
      }
    });
  }

  startEdit(): void {
    const t = this.task();
    this.editing.set({
      title: t.title,
      priority: t.priority,
      dueLocal: t.dueDate ? aLocal(t.dueDate) : '',
      company: t.company ?? '',
      project: t.project ?? ''
    });
  }

  patchEdit(
    cambio: Partial<NonNullable<ReturnType<typeof this.editing>>>
  ): void {
    this.editing.update((e) => (e ? { ...e, ...cambio } : e));
  }

  saveEdit(): void {
    const e = this.editing();
    if (!e || !e.title.trim()) {
      return;
    }
    this.guardar(
      {
        cambios: {
          title: e.title,
          priority: e.priority as TaskPriority,
          dueDate: e.dueLocal ? new Date(e.dueLocal).toISOString() : undefined,
          company: e.company || undefined,
          project: e.project || undefined
        }
      },
      () => this.editing.set(undefined)
    );
  }

  /** Crea la junta en el calendario a la hora del pendiente (una hora). */
  agendar(): void {
    const t = this.task();
    const calendarios = this.ia.calendarios();
    const cuenta =
      calendarios.length === 1
        ? calendarios[0]
        : calendarios.find((c) => confirm(`¿Agendar en ${c.usuario}?`));
    if (!cuenta || !t.dueDate) {
      return;
    }
    this.saving.set(true);
    this.ia
      .agendar(cuenta.id, {
        titulo: t.title,
        inicio: t.dueDate,
        lugar: t.project,
        cuerpo: t.description,
        invitados: t.assignee?.email ? [t.assignee.email] : []
      })
      .subscribe({
        next: (r) => {
          this.saving.set(false);
          this.message.set(
            `Agendada en ${cuenta.usuario}.${r.joinUrl ? ' Con liga de Teams.' : ''}`
          );
          this.store.refreshMeetings();
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.message.set(describirError(error));
        }
      });
  }

  copy(): void {
    const b = this.borrador();
    if (b) {
      void navigator.clipboard?.writeText(b.cuerpo);
      this.message.set('Copiado.');
    }
  }

  /**
   * Los propios se borran siempre; los demás (correo, Ops, Odoo) solo cuando
   * ya están hechos, y lo que se borra es la vista: la fuente no se toca.
   */
  remove(): void {
    if (!confirm(`¿Eliminar "${this.task().title}"?`)) {
      return;
    }
    if (!this.ia.disponible) {
      this.local.remove(this.task().id);
      this.store.refreshTasks();
      return;
    }
    this.guardar({ eliminar: true });
  }

  private guardar(
    cambio: Parameters<IaService['anotar']>[1],
    luego?: () => void
  ): void {
    this.saving.set(true);
    this.message.set(undefined);
    this.ia.anotar(this.task().id, cambio).subscribe({
      next: (r) => {
        this.saving.set(false);
        this.message.set(r.aviso);
        luego?.();
        this.local.invalidar();
        this.store.refreshTasks();
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.message.set(describirError(error));
      }
    });
  }
}

/** ISO → valor de un input datetime-local, en hora local. */
function aLocal(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
