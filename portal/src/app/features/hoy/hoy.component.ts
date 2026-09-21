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
import { SourceKind, SyncState } from '../../core/models';
import { accountsOf } from '../../core/util/meetings.util';
import { AvisosService } from '../../core/avisos/avisos.service';
import { EjecucionesService } from '../../core/ejecuciones/ejecuciones.service';
import { VpsService } from '../../core/vps/vps.service';
import { PortalesService } from '../../core/portales/portales.service';
import {
  CLASE_PLAZO,
  PUNTO_PLAZO,
  textoPlazo,
  tonoPlazo
} from '../../core/util/plazo.util';
import { IconComponent, IconName } from '../../ui/icon.component';
import { PageHeaderComponent } from '../../ui/page-header.component';
import { DayPipe, TimePipe } from '../../ui/portal.pipes';
import { TaskCardComponent } from '../../ui/task-card.component';
import { IaResumenComponent } from '../ia/ia-resumen.component';

/** Un aviso de arriba de la pagina: que pasa, que tan grave y a donde lleva. */
interface AvisoHoy {
  id: string;
  tono: 'warn' | 'danger';
  icono: IconName;
  titulo: string;
  detalle: string;
  ruta: string;
  queryParams?: Record<string, string>;
}

/**
 * A que pestaña de Integraciones se manda a quien quiere arreglar una fuente
 * caida, segun de que tipo sea. Lo que no se sabe ubicar cae en Correo, que
 * es donde mas seguido se rompe algo.
 */
const PESTANA_POR_FUENTE: Partial<Record<SourceKind, string>> = {
  google: 'correo',
  microsoft: 'correo',
  imap: 'correo',
  dominios: 'dominios',
  monitor: 'sitios',
  prometheus: 'servidores',
  anthropic: 'licencias',
  cursor: 'licencias',
  figma: 'licencias',
  vercel: 'servicios',
  github: 'servicios',
  odoo: 'servicios',
  coolify: 'servicios',
  openrouter: 'ia'
};

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
    PageHeaderComponent,
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
  /** Las integraciones que no están bien (error o atrasadas), para avisar. */
  readonly ejecucionesMal = inject(EjecucionesService).mal;
  /** Servidores con atención (umbral o sin señal). */
  readonly vpsMal = inject(VpsService).mal;
  /** Portales de Coolify detenidos o sin salud. */
  readonly portalesMal = inject(PortalesService).mal;

  readonly fecha = capitalizar(
    new Date().toLocaleDateString('es-MX', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    })
  );
  /** Fuentes que fallaron al sincronizar (buzones, monitoreo, Odoo...). */
  readonly fuentesMal = this.store.failedSources;

  /**
   * Todo lo que anda mal, en una sola lista: servidores, portales,
   * integraciones y fuentes. La plantilla lo pinta como un banner si es uno
   * solo y como una tarjeta con renglones si son varios.
   */
  readonly alertas = computed<AvisoHoy[]>(() => {
    const avisos: AvisoHoy[] = [];
    const vps = this.vpsMal();
    if (vps.length > 0) {
      avisos.push({
        id: 'vps',
        tono: 'warn',
        icono: 'monitor',
        titulo: `${vps.length} ${vps.length === 1 ? 'servidor' : 'servidores'} con atención`,
        detalle: vps
          .map((v) => `${v.name}${v.reason ? ` (${v.reason})` : ''}`)
          .join(' · '),
        ruta: '/vps'
      });
    }
    const portales = this.portalesMal();
    if (portales.length > 0) {
      avisos.push({
        id: 'portales',
        tono: 'danger',
        icono: 'despliegue',
        titulo: `${portales.length} ${portales.length === 1 ? 'portal' : 'portales'} de Coolify sin correr bien`,
        detalle: portales
          .map((p) => `${p.name}${p.server ? ` (${p.server})` : ''}`)
          .join(' · '),
        ruta: '/vps'
      });
    }
    const ejecuciones = this.ejecucionesMal();
    if (ejecuciones.length > 0) {
      avisos.push({
        id: 'ejecuciones',
        tono: 'danger',
        icono: 'alerta',
        titulo: `${ejecuciones.length} ${ejecuciones.length === 1 ? 'integración' : 'integraciones'} sin correr bien`,
        detalle: ejecuciones
          .map(
            (e) =>
              `${e.nombre} (${e.estado === 'error' ? 'falló' : 'atrasada'})`
          )
          .join(' · '),
        ruta: '/ejecuciones'
      });
    }
    const fuentes = this.fuentesMal();
    if (fuentes.length > 0) {
      avisos.push({
        id: 'fuentes',
        tono: 'danger',
        icono: 'monitoreo',
        titulo: `${fuentes.length} ${fuentes.length === 1 ? 'fuente' : 'fuentes'} sin conexión`,
        detalle: fuentes.map((f) => f.label).join(' · '),
        ruta: '/integraciones',
        queryParams: { tab: pestanaDeFuentes(fuentes) }
      });
    }
    return avisos;
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
  /** Pendientes cuyo responsable pidió que se los quiten; hay que decidir. */
  readonly solicitudes = computed(() =>
    this.store.tasks().filter((t) => t.reassignRequest && t.status !== 'hecho')
  );
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
          // A mi nombre o donde doy seguimiento, como "Míos" en Pendientes.
          (t.assignee?.email?.toLowerCase() === yo ||
            (t.followers ?? []).some((p) => p.email?.toLowerCase() === yo)) &&
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

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** La pestaña de la primera fuente que se sabe ubicar; si no, Correo. */
function pestanaDeFuentes(fuentes: readonly SyncState[]): string {
  for (const fuente of fuentes) {
    const pestana = PESTANA_POR_FUENTE[fuente.kind];
    if (pestana) {
      return pestana;
    }
  }
  return 'correo';
}
