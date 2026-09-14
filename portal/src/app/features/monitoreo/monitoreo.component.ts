import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  MONITOR_ENVIRONMENT_LABEL,
  MONITOR_KIND_LABEL,
  MONITOR_STATUS_LABEL,
  MonitorEnvironment,
  MonitorStatus,
  MonitorTarget
} from '../../core/models';
import { PortalStore } from '../../core/state/portal.store';
import { plural } from '../../core/util/text.util';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { IconComponent } from '../../ui/icon.component';
import { PageHeaderComponent } from '../../ui/page-header.component';
import { RelativePipe } from '../../ui/portal.pipes';
import { SparklineComponent } from '../../ui/sparkline.component';
import { StatusPillComponent } from '../../ui/status-pill.component';

@Component({
  selector: 'pt-monitoreo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    EmptyStateComponent,
    FormsModule,
    IconComponent,
    PageHeaderComponent,
    RelativePipe,
    SparklineComponent,
    StatusPillComponent
  ],
  templateUrl: './monitoreo.component.html'
})
export class MonitoreoComponent {
  private readonly store = inject(PortalStore);

  readonly kindLabel = MONITOR_KIND_LABEL;
  readonly statusLabel = MONITOR_STATUS_LABEL;
  readonly environmentLabel = MONITOR_ENVIRONMENT_LABEL;
  readonly environments: MonitorEnvironment[] = [
    'produccion',
    'pruebas',
    'desarrollo'
  ];

  readonly environment = signal<MonitorEnvironment | 'todos'>('todos');
  readonly onlyProblems = signal(false);

  readonly targets = computed<MonitorTarget[]>(() => {
    const environment = this.environment();
    return this.store
      .targets()
      .filter(
        (target) =>
          environment === 'todos' || target.environment === environment
      )
      .filter(
        (target) =>
          !this.onlyProblems() ||
          target.status === 'caido' ||
          target.status === 'degradado'
      )
      .sort(
        (a, b) =>
          statusWeight(a.status) - statusWeight(b.status) ||
          a.name.localeCompare(b.name)
      );
  });

  readonly counts = computed(() => {
    const all = this.store.targets();
    const of = (status: MonitorStatus) =>
      all.filter((target) => target.status === status).length;
    return {
      total: all.length,
      operativo: of('operativo'),
      degradado: of('degradado'),
      caido: of('caido'),
      mantenimiento: of('mantenimiento')
    };
  });

  /** Disponibilidad promedio del día, sobre todos los destinos vigilados. */
  readonly averageUptime = computed(() => {
    const all = this.store.targets();
    if (all.length === 0) {
      return 0;
    }
    const sum = all.reduce((total, target) => total + target.uptime24h, 0);
    return Math.round((sum / all.length) * 10) / 10;
  });

  readonly subtitle = computed(() => {
    const counts = this.counts();
    return [
      plural(counts.total, 'destino'),
      plural(counts.caido, 'caído'),
      plural(counts.degradado, 'degradado'),
      `${this.averageUptime()}% de disponibilidad promedio hoy`
    ].join(' · ');
  });

  uptimeClass(uptime: number): string {
    if (uptime >= 99) {
      return 'text-ok';
    }
    return uptime >= 95 ? 'text-warn' : 'text-danger';
  }
}

/** Lo roto primero: el orden de la rejilla es el orden en que hay que atender. */
function statusWeight(status: MonitorStatus): number {
  switch (status) {
    case 'caido':
      return 0;
    case 'degradado':
      return 1;
    case 'mantenimiento':
      return 2;
    case 'desconocido':
      return 3;
    default:
      return 4;
  }
}
