import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input
} from '@angular/core';
import { MONITOR_STATUS_LABEL, MonitorStatus } from '../core/models';

const STATUS_CLASS: Record<MonitorStatus, string> = {
  operativo:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  degradado:
    'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  caido: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  mantenimiento: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  desconocido:
    'bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300'
};

const DOT_CLASS: Record<MonitorStatus, string> = {
  operativo: 'bg-emerald-500',
  degradado: 'bg-amber-500',
  caido: 'bg-rose-500',
  mantenimiento: 'bg-sky-500',
  desconocido: 'bg-slate-400'
};

@Component({
  selector: 'pt-status-pill',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="chip" [class]="pillClass()">
      <span class="h-1.5 w-1.5 rounded-full" [class]="dotClass()"></span>
      {{ label() }}
    </span>
  `
})
export class StatusPillComponent {
  readonly status = input.required<MonitorStatus>();

  readonly label = computed(() => MONITOR_STATUS_LABEL[this.status()]);
  readonly pillClass = computed(() => STATUS_CLASS[this.status()]);
  readonly dotClass = computed(() => DOT_CLASS[this.status()]);
}
