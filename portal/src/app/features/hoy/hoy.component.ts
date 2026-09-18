import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { SesionService } from '../../core/acceso/sesion.service';
import {
  meetingsOn,
  overdueTasks,
  tasksDueToday,
  upcomingMeetings
} from '../../core/state/portal.selectors';
import { PortalStore } from '../../core/state/portal.store';
import { accountsOf } from '../../core/util/meetings.util';
import { IconComponent } from '../../ui/icon.component';
import { TimePipe } from '../../ui/portal.pipes';
import { TaskCardComponent } from '../../ui/task-card.component';
import { AvisosConfigComponent } from '../ia/avisos-config.component';
import { IaResumenComponent } from '../ia/ia-resumen.component';

/**
 * Hoy: la pantalla de inicio en el celular. Las juntas del día, lo que
 * venció y lo que vence hoy, el resumen de la IA y el botón de dictar.
 * Nada de filtros ni configuración: lo que hace falta ver de camino.
 */
@Component({
  selector: 'pt-hoy',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AvisosConfigComponent,
    IaResumenComponent,
    IconComponent,
    RouterLink,
    TaskCardComponent,
    TimePipe
  ],
  templateUrl: './hoy.component.html'
})
export class HoyComponent {
  private readonly store = inject(PortalStore);
  private readonly sesion = inject(SesionService);

  readonly fecha = new Date().toLocaleDateString('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  });

  readonly juntas = computed(() =>
    meetingsOn(this.store.meetings(), new Date())
  );
  readonly siguientes = computed(() =>
    upcomingMeetings(this.store.meetings(), new Date(), 3)
  );
  readonly vencidos = computed(() =>
    overdueTasks(this.store.tasks()).sort((a, b) =>
      (a.dueDate ?? '').localeCompare(b.dueDate ?? '')
    )
  );
  readonly paraHoy = computed(() => tasksDueToday(this.store.tasks()));
  /** Lo asignado a quien entró, fuera de lo vencido y lo de hoy. */
  readonly mios = computed(() => {
    const yo = this.sesion.correo()?.toLowerCase();
    if (!yo) {
      return [];
    }
    return this.store
      .tasks()
      .filter(
        (t) =>
          t.status !== 'hecho' &&
          t.assignee?.email?.toLowerCase() === yo &&
          !this.vencidos().includes(t) &&
          !this.paraHoy().includes(t)
      )
      .slice(0, 5);
  });
  readonly sinHomologar = computed(
    () => this.store.unmirroredMeetings().length
  );
  readonly cargando = this.store.loading;

  cuentas(junta: { accountId: string; alsoIn?: string[] }): string {
    return accountsOf(junta as never)
      .map((id) => this.store.accountOf(id)?.label ?? id)
      .join(' · ');
  }
}
