import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input
} from '@angular/core';
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

/** Renglon de pendiente. Lo comparten el panel, la lista y la vista de equipo. */
@Component({
  selector: 'pt-task-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AccountChipComponent, IconComponent, DayPipe, RelativePipe],
  template: `
    <article
      class="relative overflow-hidden rounded-lg border border-line bg-surface px-4 py-3 transition hover:border-brand/40">
      <span class="account-bar" [class]="barClass()"></span>
      <div class="flex items-start gap-3 pl-2">
        @if (task().origin === 'local') {
          <button
            type="button"
            class="mt-0.5 h-4 w-4 shrink-0 rounded border border-line transition hover:border-brand"
            [class.bg-brand]="done()"
            [class.border-brand]="done()"
            [attr.aria-label]="
              done() ? 'Marcar como pendiente' : 'Marcar como hecho'
            "
            (click)="toggle()"></button>
        }
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3
              class="text-sm font-medium text-ink"
              [class.line-through]="done()"
              [class.text-ink-subtle]="done()">
              {{ task().title }}
            </h3>
            <span class="chip" [class]="priorityClass()">{{
              priorityLabel()
            }}</span>
            @if (overdue()) {
              <span
                class="chip bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                Vencido
              </span>
            }
          </div>

          @if (task().description) {
            <p class="mt-1 line-clamp-2 text-sm text-ink-muted">
              {{ task().description }}
            </p>
          }

          <div
            class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
            <pt-account-chip [accountId]="task().accountId" />
            <span [class]="statusClass()">{{ statusLabel() }}</span>
            @if (task().assignee; as assignee) {
              <span>{{ assignee.name }}</span>
            } @else {
              <span class="text-ink-subtle">Sin asignar</span>
            }
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
        </div>

        <div class="flex shrink-0 items-center gap-1">
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
          @if (task().origin === 'local') {
            <button
              type="button"
              class="rounded p-1 text-ink-subtle transition hover:bg-surface-muted hover:text-danger"
              [attr.aria-label]="'Borrar ' + task().title"
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

  readonly task = input.required<TaskItem>();

  readonly done = computed(() => this.task().status === 'hecho');
  readonly overdue = computed(
    () => !this.done() && isOverdue(this.task().dueDate)
  );
  readonly priorityLabel = computed(
    () => TASK_PRIORITY_LABEL[this.task().priority]
  );
  readonly priorityClass = computed(() => PRIORITY_CLASS[this.task().priority]);
  readonly statusLabel = computed(() => TASK_STATUS_LABEL[this.task().status]);
  readonly statusClass = computed(() => STATUS_CLASS[this.task().status]);
  readonly barClass = computed(
    () =>
      ACCOUNT_BAR_CLASS[
        this.store.accountOf(this.task().accountId)?.color ?? 'slate'
      ]
  );

  /**
   * Marcar y borrar viven aquí, no en cada pantalla que muestre la tarjeta.
   * Solo aplican a los pendientes propios: los de Odoo y Ops se editan en su
   * propio sistema, y por eso sus botones ni siquiera se pintan.
   */
  toggle(): void {
    this.local.toggleDone(this.task().id);
    this.store.refreshTasks();
  }

  remove(): void {
    this.local.remove(this.task().id);
    this.store.refreshTasks();
  }
}
