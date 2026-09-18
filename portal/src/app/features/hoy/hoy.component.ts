import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal
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
import { AvisosService } from '../../core/avisos/avisos.service';
import {
  Ejecucion,
  PuenteAdminService
} from '../../core/sources/gateway/puente-admin.service';
import {
  CLASE_PLAZO,
  PUNTO_PLAZO,
  textoPlazo,
  tonoPlazo
} from '../../core/util/plazo.util';
import { IconComponent } from '../../ui/icon.component';
import { DayPipe, TimePipe } from '../../ui/portal.pipes';
import { TaskCardComponent } from '../../ui/task-card.component';
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
    IaResumenComponent,
    IconComponent,
    RouterLink,
    TaskCardComponent,
    DayPipe,
    TimePipe
  ],
  templateUrl: './hoy.component.html'
})
export class HoyComponent {
  private readonly store = inject(PortalStore);
  private readonly sesion = inject(SesionService);
  private readonly admin = inject(PuenteAdminService);

  /** Las integraciones que no están bien (error o atrasadas), para avisar. */
  readonly ejecucionesMal = signal<Ejecucion[]>([]);

  constructor() {
    this.cargarEjecuciones();
  }

  private cargarEjecuciones(): void {
    if (!this.admin.disponible) {
      return;
    }
    this.admin.ejecuciones().subscribe({
      next: (lista) =>
        this.ejecucionesMal.set(
          lista.filter((e) => e.estado === 'error' || e.estado === 'atrasada')
        ),
      error: () => this.ejecucionesMal.set([])
    });
  }

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
  /** Lo marcado hecho en esta sesión: se queda a la vista con "Reabrir". */
  readonly hechosAhora = computed(() => {
    const ids = this.store.recienHechos();
    return this.store
      .tasks()
      .filter((t) => ids.has(t.id) && t.status === 'hecho');
  });

  private readonly avisos = inject(AvisosService);

  /** Lo que se cerró ayer (por su última actualización). */
  readonly ayer = computed(() => {
    const ayer = new Date();
    ayer.setDate(ayer.getDate() - 1);
    const clave = ayer.toDateString();
    return this.store
      .tasks()
      .filter(
        (t) =>
          t.status === 'hecho' && new Date(t.updatedAt).toDateString() === clave
      );
  });
  /** Lo que el equipo movió ayer desde sus ligas. */
  readonly movimientosAyer = computed(() => {
    const ayer = new Date();
    ayer.setDate(ayer.getDate() - 1);
    const clave = ayer.toDateString();
    return this.avisos
      .avisos()
      .filter((a) => new Date(a.en).toDateString() === clave);
  });
  /** Entregas después de hoy, en los próximos 30 días, con color por plazo. */
  readonly proximas = computed(() => {
    const hoy = new Date();
    hoy.setHours(23, 59, 59, 999);
    const limite = hoy.getTime() + 30 * 86_400_000;
    return this.store
      .tasks()
      .filter(
        (t) =>
          t.status !== 'hecho' &&
          t.dueDate &&
          Date.parse(t.dueDate) > hoy.getTime() &&
          Date.parse(t.dueDate) <= limite
      )
      .sort((a, b) => (a.dueDate as string).localeCompare(b.dueDate as string))
      .map((t) => ({
        t,
        punto: PUNTO_PLAZO[tonoPlazo(t.dueDate as string)],
        clase: CLASE_PLAZO[tonoPlazo(t.dueDate as string)],
        texto: textoPlazo(t.dueDate as string)
      }));
  });

  cuentas(junta: { accountId: string; alsoIn?: string[] }): string {
    return accountsOf(junta as never)
      .map((id) => this.store.accountOf(id)?.label ?? id)
      .join(' · ');
  }
}
