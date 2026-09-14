import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { CURRENT_USER } from '../../core/sources/demo/demo-people';
import { PortalStore } from '../../core/state/portal.store';
import {
  byUrgency,
  deploymentsToday,
  failedDeployments,
  licensesNeedingAttention,
  runningDeployments,
  spendCurrency,
  totalSpend,
  meetingConflicts,
  meetingsOn,
  openTasks,
  overdueTasks,
  pipelineByStage,
  targetsNeedingAttention,
  tasksDueToday,
  upcomingMeetings,
  weightedPipeline
} from '../../core/state/portal.selectors';
import { formatLongDay } from '../../core/util/date.util';
import { plural } from '../../core/util/text.util';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { IconComponent } from '../../ui/icon.component';
import { PageHeaderComponent } from '../../ui/page-header.component';
import {
  DayPipe,
  MoneyPipe,
  RelativePipe,
  TimePipe
} from '../../ui/portal.pipes';
import { StatTileComponent } from '../../ui/stat-tile.component';
import { StatusPillComponent } from '../../ui/status-pill.component';
import { TaskCardComponent } from '../../ui/task-card.component';

/** Cuántos renglones caben en cada tarjeta del panel sin volverla una lista. */
const PREVIEW_LIMIT = 5;

/** El gasto se lee de un vistazo: sin centavos y con separador de miles. */
const MONTO = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });

@Component({
  selector: 'pt-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DayPipe,
    EmptyStateComponent,
    IconComponent,
    MoneyPipe,
    PageHeaderComponent,
    RelativePipe,
    RouterLink,
    StatTileComponent,
    StatusPillComponent,
    TaskCardComponent,
    TimePipe
  ],
  templateUrl: './panel.component.html'
})
export class PanelComponent {
  readonly store = inject(PortalStore);

  readonly today = new Date();
  readonly todayLabel = formatLongDay(this.today);

  readonly openTotal = computed(() => openTasks(this.store.tasks()).length);
  readonly overdue = computed(() => overdueTasks(this.store.tasks()));
  readonly dueToday = computed(() => tasksDueToday(this.store.tasks()));

  /** Lo mio primero: el panel es de uno, no del tablero del equipo. */
  readonly myUrgent = computed(() =>
    openTasks(this.store.tasks())
      .filter((task) => !task.assignee || task.assignee.id === CURRENT_USER.id)
      .sort((a, b) => byUrgency(a, b))
      .slice(0, PREVIEW_LIMIT)
  );

  readonly todayMeetings = computed(() =>
    meetingsOn(this.store.meetings(), this.today)
  );
  readonly nextMeetings = computed(() =>
    upcomingMeetings(this.store.meetings(), new Date(), 4)
  );
  readonly conflicts = computed(() => meetingConflicts(this.store.meetings()));

  readonly troubled = computed(() =>
    targetsNeedingAttention(this.store.targets())
  );
  readonly targetsPreview = computed(() =>
    // Lo que falla se ve primero; lo sano se apila abajo.
    [...this.store.targets()]
      .sort(
        (a, b) => Number(b.status === 'caido') - Number(a.status === 'caido')
      )
      .slice(0, PREVIEW_LIMIT)
  );

  readonly weighted = computed(() =>
    weightedPipeline(this.store.opportunities())
  );
  readonly openOpportunities = computed(() =>
    pipelineByStage(this.store.opportunities())
      .filter((s) => s.stage !== 'ganado' && s.stage !== 'perdido')
      .reduce((total, stage) => total + stage.opportunities.length, 0)
  );

  readonly tasksHint = computed(
    () =>
      `${this.overdue().length} vencidos · ${this.dueToday().length} para hoy`
  );

  readonly meetingsHint = computed(() => {
    const total = this.conflicts().length;
    return total === 0
      ? 'Sin empalmes'
      : `${plural(total, 'empalme')} por resolver`;
  });

  readonly targetsHint = computed(
    () => `${plural(this.store.targets().length, 'destino')} vigilados`
  );

  readonly crmHint = computed(
    () =>
      `${plural(this.openOpportunities(), 'oportunidad', 'oportunidades')} abiertas`
  );

  readonly gasto = computed(() => totalSpend(this.store.licenses()));
  readonly gastoMoneda = computed(() => spendCurrency(this.store.licenses()));
  readonly gastoTexto = computed(() => {
    const moneda = this.gastoMoneda();
    // Sin una moneda común el total no significa nada, y decirlo es mejor que
    // sumar dólares con pesos.
    return moneda
      ? `${MONTO.format(this.gasto())} ${moneda}`
      : 'varias monedas';
  });
  readonly licenciasConAviso = computed(() =>
    licensesNeedingAttention(this.store.licenses())
  );
  readonly gastoHint = computed(() =>
    this.licenciasConAviso().length === 0
      ? `${plural(this.store.licenses().length, 'licencia')} al corriente`
      : `${plural(this.licenciasConAviso().length, 'licencia')} con aviso`
  );

  readonly despliegesHoy = computed(() =>
    deploymentsToday(this.store.deployments())
  );
  readonly desplieguesFallidos = computed(() =>
    failedDeployments(this.store.deployments())
  );
  readonly desplieguesEnCurso = computed(() =>
    runningDeployments(this.store.deployments())
  );
  readonly desplieguesHint = computed(() =>
    [
      `${this.desplieguesFallidos().length} con error`,
      `${this.desplieguesEnCurso().length} en curso`
    ].join(' · ')
  );

  readonly nextActivities = computed(() =>
    [...this.store.activities()]
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, PREVIEW_LIMIT)
  );
}
