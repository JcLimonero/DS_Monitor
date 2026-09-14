import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  DEPLOYMENT_ENVIRONMENT_LABEL,
  DEPLOYMENT_STATE_LABEL,
  Deployment,
  DeploymentState,
  PLATFORM_INDICATOR_LABEL,
  PlatformIndicator,
  PlatformStatus
} from '../../core/models';
import {
  deploymentsToday,
  failedDeployments,
  platformIncidents,
  runningDeployments
} from '../../core/state/portal.selectors';
import { PortalStore } from '../../core/state/portal.store';
import { plural } from '../../core/util/text.util';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { IconComponent } from '../../ui/icon.component';
import { PageHeaderComponent } from '../../ui/page-header.component';
import { DayPipe, RelativePipe, TimePipe } from '../../ui/portal.pipes';

const CLASE_ESTADO: Record<DeploymentState, string> = {
  listo:
    'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200',
  construyendo: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200',
  en_cola:
    'bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300',
  error: 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-200',
  cancelado:
    'bg-slate-200 text-slate-600 dark:bg-slate-500/20 dark:text-slate-400'
};

const CLASE_PLATAFORMA: Record<PlatformIndicator, string> = {
  operativo: 'text-ok',
  menor: 'text-warn',
  mayor: 'text-danger',
  critico: 'text-danger',
  mantenimiento: 'text-info',
  desconocido: 'text-ink-subtle'
};

@Component({
  selector: 'pt-despliegues',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DayPipe,
    EmptyStateComponent,
    FormsModule,
    IconComponent,
    PageHeaderComponent,
    RelativePipe,
    TimePipe
  ],
  templateUrl: './despliegues.component.html'
})
export class DesplieguesComponent {
  readonly store = inject(PortalStore);

  readonly estadoLabel = DEPLOYMENT_STATE_LABEL;
  readonly entornoLabel = DEPLOYMENT_ENVIRONMENT_LABEL;
  readonly plataformaLabel = PLATFORM_INDICATOR_LABEL;

  /** Filtros de la lista. Vacio quiere decir "todos". */
  readonly proyecto = signal<'todos' | string>('todos');
  readonly soloProblemas = signal(false);

  readonly proyectos = computed(() =>
    [...new Set(this.store.deployments().map((d) => d.project))].sort()
  );

  readonly despliegues = computed<Deployment[]>(() => {
    const proyecto = this.proyecto();
    return this.store
      .deployments()
      .filter((d) => proyecto === 'todos' || d.project === proyecto)
      .filter(
        (d) =>
          !this.soloProblemas() ||
          d.state === 'error' ||
          d.state === 'cancelado'
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });

  readonly fallidos = computed(() =>
    failedDeployments(this.store.deployments())
  );
  readonly enCurso = computed(() =>
    runningDeployments(this.store.deployments())
  );
  readonly deHoy = computed(() => deploymentsToday(this.store.deployments()));
  readonly incidentes = computed(() =>
    platformIncidents(this.store.platformStatus())
  );

  readonly subtitle = computed(() =>
    [
      `${plural(this.deHoy().length, 'despliegue')} hoy`,
      `${this.enCurso().length} en curso`,
      `${this.fallidos().length} con error`
    ].join(' · ')
  );

  claseEstado(despliegue: Deployment): string {
    return CLASE_ESTADO[despliegue.state];
  }

  clasePlataforma(estado: PlatformStatus): string {
    return CLASE_PLATAFORMA[estado.indicator];
  }

  /** "1 min 36 s". Sin duración devuelve cadena vacia. */
  duracion(despliegue: Deployment): string {
    const segundos = despliegue.durationSeconds;
    if (segundos === undefined) {
      return '';
    }
    if (segundos < 60) {
      return `${segundos} s`;
    }
    const minutos = Math.floor(segundos / 60);
    const resto = segundos % 60;
    return resto === 0 ? `${minutos} min` : `${minutos} min ${resto} s`;
  }

  limpiarFiltros(): void {
    this.proyecto.set('todos');
    this.soloProblemas.set(false);
  }
}
