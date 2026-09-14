import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject
} from '@angular/core';
import {
  CRM_ACTIVITY_LABEL,
  CRM_STAGE_LABEL,
  CrmOpportunity
} from '../../core/models';
import {
  pipelineByStage,
  weightedPipeline
} from '../../core/state/portal.selectors';
import { PortalStore } from '../../core/state/portal.store';
import { isOverdue } from '../../core/util/date.util';
import { plural } from '../../core/util/text.util';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { IconComponent } from '../../ui/icon.component';
import { PageHeaderComponent } from '../../ui/page-header.component';
import { DayPipe, MoneyPipe, RelativePipe } from '../../ui/portal.pipes';

@Component({
  selector: 'pt-crm',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DayPipe,
    EmptyStateComponent,
    IconComponent,
    MoneyPipe,
    PageHeaderComponent,
    RelativePipe
  ],
  templateUrl: './crm.component.html'
})
export class CrmComponent {
  private readonly store = inject(PortalStore);

  readonly stageLabel = CRM_STAGE_LABEL;
  readonly activityLabel = CRM_ACTIVITY_LABEL;

  readonly stages = computed(() => pipelineByStage(this.store.opportunities()));

  /** El embudo son las etapas vivas; ganado y perdido se resumen aparte. */
  readonly openStages = computed(() =>
    this.stages().filter(
      (stage) => stage.stage !== 'ganado' && stage.stage !== 'perdido'
    )
  );

  readonly won = computed(() =>
    this.stages().find((stage) => stage.stage === 'ganado')
  );
  readonly lost = computed(() =>
    this.stages().find((stage) => stage.stage === 'perdido')
  );

  readonly weighted = computed(() =>
    weightedPipeline(this.store.opportunities())
  );
  readonly openTotal = computed(() =>
    this.openStages().reduce((total, stage) => total + stage.total, 0)
  );
  readonly openCount = computed(() =>
    this.openStages().reduce(
      (total, stage) => total + stage.opportunities.length,
      0
    )
  );

  readonly activities = computed(() =>
    [...this.store.activities()].sort((a, b) =>
      a.dueDate.localeCompare(b.dueDate)
    )
  );

  readonly lateActivities = computed(
    () =>
      this.activities().filter((activity) => isOverdue(activity.dueDate)).length
  );

  readonly lateLabel = computed(
    () => `${plural(this.lateActivities(), 'atrasada')}`
  );

  isLate(iso: string): boolean {
    return isOverdue(iso);
  }

  /** Las oportunidades que llevan más de dos semanas sin moverse. */
  readonly stale = computed(() => {
    const limit = Date.now() - 14 * 24 * 3_600_000;
    return this.store
      .opportunities()
      .filter(
        (opportunity) =>
          opportunity.stage !== 'ganado' && opportunity.stage !== 'perdido'
      )
      .filter(
        (opportunity) => new Date(opportunity.updatedAt).getTime() < limit
      )
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  });

  closeTone(opportunity: CrmOpportunity): string {
    return opportunity.expectedClose && isOverdue(opportunity.expectedClose)
      ? 'text-danger'
      : 'text-ink-muted';
  }
}
