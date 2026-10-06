import { IaCrmComponent } from '../ia/ia-crm.component';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal
} from '@angular/core';
import {
  CRM_ACTIVITY_LABEL,
  CRM_STAGE_LABEL,
  CRM_STAGE_ORDER,
  CrmOpportunity,
  CrmStage
} from '../../core/models';
import { PuenteAdminService } from '../../core/sources/gateway/puente-admin.service';
import {
  daysWithoutMovement,
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
    IaCrmComponent,
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
  private readonly puente = inject(PuenteAdminService);

  readonly stageLabel = CRM_STAGE_LABEL;
  readonly stageOrder = CRM_STAGE_ORDER;

  /** La oportunidad que se está moviendo y el último error al moverla. */
  readonly moving = signal<string | undefined>(undefined);
  readonly moveError = signal<{ id: string; message: string } | undefined>(
    undefined
  );
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

  /**
   * Las oportunidades que llevan más de dos semanas sin moverse. Las que
   * llegan por ingesta cuentan desde su último movimiento (cambio de etapa o
   * actividad nueva), no desde que el emisor las reenvió.
   */
  readonly stale = computed(() => {
    const limit = Date.now() - 14 * 24 * 3_600_000;
    const since = (opportunity: CrmOpportunity) =>
      opportunity.lastMovementAt ?? opportunity.updatedAt;
    return this.store
      .opportunities()
      .filter(
        (opportunity) =>
          opportunity.stage !== 'ganado' && opportunity.stage !== 'perdido'
      )
      .filter((opportunity) => new Date(since(opportunity)).getTime() < limit)
      .sort((a, b) => since(a).localeCompare(since(b)));
  });

  /** "Sin movimiento: 3 días", o nada si el puente no lleva la cuenta. */
  quietLabel(opportunity: CrmOpportunity): string | undefined {
    const days = daysWithoutMovement(opportunity);
    if (days === undefined) {
      return undefined;
    }
    return days === 0
      ? 'Con movimiento hoy'
      : `Sin movimiento: ${plural(days, 'día')}`;
  }

  manualTitle(opportunity: CrmOpportunity): string {
    const manual = opportunity.stageManual;
    return manual
      ? `Movida por ${manual.by}. El emisor todavía la tiene en ${CRM_STAGE_LABEL[manual.reported]}.`
      : '';
  }

  /** El selector de etapa de una cotización: la manda el puente, no Odoo. */
  move(opportunity: CrmOpportunity, event: Event): void {
    const select = event.target as HTMLSelectElement;
    const stage = select.value as CrmStage;
    const undo = () => (select.value = opportunity.stage);
    if (stage === opportunity.stage || this.moving()) {
      undo();
      return;
    }
    // Una cerrada sale del embudo y desde aquí no se ve para regresarla.
    if (
      (stage === 'ganado' || stage === 'perdido') &&
      !confirm(
        `¿Marcar "${opportunity.name}" como ${CRM_STAGE_LABEL[stage].toLowerCase()}? Sale del embudo.`
      )
    ) {
      undo();
      return;
    }
    this.moving.set(opportunity.id);
    this.moveError.set(undefined);
    this.puente.moverEtapaCrm(opportunity.id, stage).subscribe({
      next: (updated) => {
        this.store.actualizarOportunidad(updated);
        this.moving.set(undefined);
      },
      error: (error: { error?: { error?: string }; message?: string }) => {
        undo();
        this.moveError.set({
          id: opportunity.id,
          message:
            error.error?.error ??
            error.message ??
            'No se pudo mover la oportunidad.'
        });
        this.moving.set(undefined);
      }
    });
  }

  closeTone(opportunity: CrmOpportunity): string {
    return opportunity.expectedClose && isOverdue(opportunity.expectedClose)
      ? 'text-danger'
      : 'text-ink-muted';
  }
}
