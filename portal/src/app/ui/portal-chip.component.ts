import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { HostedApp, HostedAppStatus } from '../core/models';

export const PORTAL_STATUS_LABEL: Record<HostedAppStatus, string> = {
  running: 'Corriendo',
  stopped: 'Detenido',
  error: 'Con error',
  unknown: 'Sin dato'
};

/** El estado de un portal de Coolify, con color; "sin salud" si corre pero no responde. */
@Component({
  selector: 'pt-portal-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ` <span class="chip" [class]="clase()">{{ etiqueta() }}</span> `
})
export class PortalChipComponent {
  readonly portal = input.required<HostedApp>();

  etiqueta(): string {
    const p = this.portal();
    if (p.status === 'running' && p.healthy === false) {
      return 'Sin salud';
    }
    return PORTAL_STATUS_LABEL[p.status];
  }

  clase(): string {
    const p = this.portal();
    if (p.status === 'running' && p.healthy !== false) {
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300';
    }
    if (p.status === 'unknown') {
      return 'bg-surface-muted text-ink-muted';
    }
    return p.status === 'running'
      ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200'
      : 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200';
  }
}
