import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject
} from '@angular/core';
import {
  LicenseUsage,
  Meeting,
  daysToRenewal,
  isNearLimit,
  usagePercent
} from '../../../core/models';
import {
  RENEWAL_WARN_DAYS,
  failedDeployments,
  licensesNeedingAttention,
  meetingConflicts,
  meetingsOn,
  openTasks,
  overdueTasks,
  targetsNeedingAttention,
  tasksDueToday,
  upcomingMeetings,
  weightedPipeline
} from '../../../core/state/portal.selectors';
import { PortalStore } from '../../../core/state/portal.store';
import { accountsOf } from '../../../core/util/meetings.util';
import { plural } from '../../../core/util/text.util';
import { CrmService } from '../../../core/sources/gateway/crm.service';
import { IaService } from '../../../core/ia/ia.service';
import { IconComponent } from '../../../ui/icon.component';
import { IaResumenComponent } from '../../ia/ia-resumen.component';
import { MoneyPipe, TimePipe } from '../../../ui/portal.pipes';

/** Un aviso de la columna de atención: qué pasa y qué tan grave es. */
interface Aviso {
  id: string;
  texto: string;
  detalle?: string;
  grave: boolean;
}

/** Cuantas juntas se listan en "lo que sigue". */
const SIGUIENTES = 6;

/** Cuantos avisos caben en "requiere atencion" sin que se desborde. */
const AVISOS = 8;

/**
 * Portada del carrusel: las cuatro cifras del día, lo que sigue en la agenda y
 * lo que requiere atención.
 *
 * Es la pantalla que más gente ve de reojo al pasar, asi que las cifras van
 * arriba y grandes, y el detalle abajo para quien se detiene.
 */
@Component({
  selector: 'pt-slide-resumen',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IaResumenComponent, IconComponent, MoneyPipe, TimePipe],
  host: { class: 'flex h-full flex-col gap-2' },
  template: `
    <!-- En una tablet apaisada las cuatro cifras van en un renglon: dejan alto para lo de abajo. -->
    <div class="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4">
      <div class="tv-card min-w-0 px-3 py-2">
        <p class="tv-label">Pendientes abiertos</p>
        <p class="tv-numero mt-1" [class.text-danger]="vencidos() > 0">
          {{ abiertos() }}
        </p>
        <p class="tv-dato mt-1">
          <span
            [class.text-danger]="vencidos() > 0"
            [class.font-bold]="vencidos() > 0">
            {{ vencidos() }} vencidos
          </span>
          · {{ paraHoy() }} para hoy
          @if (sinResponsable() > 0) {
            · {{ sinResponsable() }} sin responsable
          }
        </p>
      </div>

      <div class="tv-card min-w-0 px-3 py-2">
        <p class="tv-label">Juntas hoy</p>
        <p class="tv-numero mt-1">{{ juntasHoy().length }}</p>
        <p class="tv-dato mt-1 truncate">
          {{ empalmes().length > 0 ? empalmesTexto() : 'Sin empalmes' }}
        </p>
      </div>

      <div class="tv-card min-w-0 px-3 py-2">
        <p class="tv-label">Plataformas con problema</p>
        <p
          class="tv-numero mt-1"
          [class]="conProblema().length > 0 ? 'text-danger' : 'text-ok'">
          {{ conProblema().length }}
        </p>
        <p class="tv-dato mt-1">{{ vigiladas() }} vigiladas</p>
      </div>

      <div class="tv-card min-w-0 px-3 py-2">
        <p class="tv-label">Embudo ponderado</p>
        <!-- El importe es mas largo que una cifra: con el tamano de las otras se salia de la tarjeta. -->
        <p class="tv-numero mt-1 text-[length:2.25rem] text-info">
          {{ ponderado() | moneda }}
        </p>
        <p class="tv-dato mt-1">{{ oportunidades() }}</p>
      </div>
    </div>

    <!-- Sin juntas por delante, "Lo que sigue" se reduce a una linea. -->
    @if (siguientes().length === 0) {
      <p class="tv-row flex shrink-0 items-center gap-2 text-ink-subtle">
        <pt-icon name="agenda" class="h-5 w-5 shrink-0" />
        Ya no quedan juntas por delante
      </p>
    }

    <!--
      Las tarjetas ocupan justo el alto que queda (grid-rows minmax 0) y cada una
      hace scroll por dentro; asi nunca se salen de la pantalla ni tapan el pie.
    -->
    <div
      class="grid min-h-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-3 sm:grid-rows-[minmax(0,1fr)]">
      @if (ia.activa()) {
        <section
          class="tv-card flex min-h-0 flex-col overflow-y-auto overscroll-contain px-3 py-2">
          <pt-ia-resumen [tv]="true" />
        </section>
      }
      @if (siguientes().length > 0) {
        <section
          class="tv-card flex min-h-0 flex-col overflow-y-auto overscroll-contain px-3 py-2"
          [class.sm:col-span-2]="!ia.activa()">
          <h2 class="tv-label shrink-0">Lo que sigue</h2>
          <ul
            class="mt-1.5 flex min-h-0 flex-1 flex-col justify-around gap-1.5 overflow-y-auto overscroll-contain">
            @for (junta of siguientes(); track junta.id) {
              <li class="flex items-baseline gap-3">
                <span
                  class="w-16 shrink-0 text-xl font-bold tabular-nums text-ink">
                  {{ junta.start | hora }}
                </span>
                <span class="min-w-0 flex-1">
                  <span class="tv-nombre line-clamp-2">
                    {{ junta.title }}
                  </span>
                  <span class="tv-dato line-clamp-1">
                    {{ cuenta(junta) }}
                    @if (junta.location) {
                      · {{ junta.location }}
                    }
                  </span>
                </span>
              </li>
            }
          </ul>
        </section>
      }

      <!-- Sin juntas se lleva el ancho que dejaron; asi no queda media pantalla vacia. -->
      <section
        class="tv-card flex min-h-0 flex-col overflow-y-auto overscroll-contain px-3 py-2"
        [class]="claseAtencion()">
        <h2 class="tv-label shrink-0">Requiere atención</h2>
        @if (avisos().length > 0) {
          <ul
            class="mt-1.5 flex min-h-0 flex-1 flex-col justify-around gap-1.5 overflow-y-auto overscroll-contain">
            @for (aviso of avisosVisibles(); track aviso.id) {
              <li class="flex items-start gap-2">
                <pt-icon
                  name="alerta"
                  class="mt-0.5 h-5 w-5 shrink-0"
                  [class]="aviso.grave ? 'text-danger' : 'text-warn'" />
                <span class="min-w-0">
                  <span class="tv-nombre line-clamp-2">{{ aviso.texto }}</span>
                  @if (aviso.detalle) {
                    <span class="tv-dato line-clamp-2">
                      {{ aviso.detalle }}
                    </span>
                  }
                </span>
              </li>
            }
          </ul>
          @if (avisosRestantes() > 0) {
            <p class="tv-row mt-1 shrink-0 text-center text-ink-muted">
              y {{ avisosRestantes() }} más
            </p>
          }
        } @else {
          <div
            class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <pt-icon name="ok" class="h-12 w-12 text-ok" />
            <p class="tv-title !text-ok">Todo en orden</p>
          </div>
        }
      </section>
    </div>
  `
})
export class ResumenSlideComponent {
  private readonly store = inject(PortalStore);
  readonly ia = inject(IaService);
  private readonly crm = inject(CrmService);
  readonly sinResponsable = computed(() => this.crm.sinResponsable().total);

  constructor() {
    this.ia.estado().subscribe({ error: () => undefined });
  }

  readonly abiertos = computed(() => openTasks(this.store.tasks()).length);
  readonly vencidos = computed(() => overdueTasks(this.store.tasks()).length);
  readonly paraHoy = computed(() => tasksDueToday(this.store.tasks()).length);

  readonly juntasHoy = computed(() =>
    meetingsOn(this.store.meetings(), new Date())
  );
  readonly siguientes = computed(() =>
    upcomingMeetings(this.store.meetings(), new Date(), SIGUIENTES)
  );
  readonly empalmes = computed(() => meetingConflicts(this.juntasHoy()));
  readonly empalmesTexto = computed(
    () => `${plural(this.empalmes().length, 'empalme')} por resolver`
  );

  readonly conProblema = computed(() =>
    targetsNeedingAttention(this.store.targets())
  );
  readonly vigiladas = computed(() =>
    plural(this.store.targets().length, 'plataforma')
  );

  readonly ponderado = computed(() =>
    weightedPipeline(this.store.opportunities())
  );
  readonly oportunidades = computed(() => {
    const abiertas = this.store
      .opportunities()
      .filter((o) => o.stage !== 'ganado' && o.stage !== 'perdido').length;
    return `${plural(abiertas, 'oportunidad', 'oportunidades')} abiertas`;
  });

  /**
   * Cuantas columnas ocupa "Requiere atencion": una si hay juntas; sin
   * juntas se queda con las que sobran (dos con IA, tres sin ella).
   */
  readonly claseAtencion = computed(() => {
    if (this.siguientes().length > 0) {
      return '';
    }
    return this.ia.activa() ? 'sm:col-span-2' : 'sm:col-span-3';
  });

  /** Los que caben; los demas se resumen en "y N mas". */
  readonly avisosVisibles = computed(() => this.avisos().slice(0, AVISOS));
  readonly avisosRestantes = computed(() =>
    Math.max(0, this.avisos().length - AVISOS)
  );

  /**
   * Lo que hay que atender hoy, de lo mas grave a lo menos: primero todo lo
   * grave (una plataforma caida, un vencido, produccion rota) y luego lo
   * leve, cada bloque en el orden en que se junto.
   */
  readonly avisos = computed<Aviso[]>(() => {
    const avisos: Aviso[] = this.conProblema().map((destino) => ({
      id: `destino-${destino.id}`,
      texto: destino.name,
      detalle: destino.incident,
      grave: destino.status === 'caido'
    }));

    if (this.vencidos() > 0) {
      avisos.push({
        id: 'vencidos',
        texto: `${plural(this.vencidos(), 'pendiente vencido', 'pendientes vencidos')}`,
        detalle: 'Ver la pantalla de pendientes críticos',
        grave: true
      });
    }

    if (this.sinResponsable() > 0) {
      avisos.push({
        id: 'sin-responsable',
        texto: `${plural(this.sinResponsable(), 'tarea sin responsable', 'tareas sin responsable')}`,
        detalle: 'Pendientes, funcionalidades, hitos o riesgos',
        grave: false
      });
    }

    for (const [a, b] of this.empalmes()) {
      avisos.push({
        id: `empalme-${a.id}-${b.id}`,
        texto: 'Juntas empalmadas',
        detalle: `${a.title} contra ${b.title}`,
        grave: false
      });
    }

    for (const { meeting, missingIn } of this.store
      .unmirroredMeetings()
      .slice(0, 3)) {
      avisos.push({
        id: `sin-homologar-${meeting.id}`,
        texto: `Junta sin homologar: ${meeting.title}`,
        detalle: `Falta en ${missingIn
          .map((id) => this.store.accountOf(id)?.label ?? id)
          .join(', ')}`,
        grave: false
      });
    }

    for (const despliegue of failedDeployments(this.store.deployments())) {
      avisos.push({
        id: `despliegue-${despliegue.id}`,
        texto: `Falló el despliegue de ${despliegue.project}`,
        detalle: `${despliegue.branch} · ${despliegue.commitMessage}`,
        grave: despliegue.environment === 'produccion'
      });
    }

    for (const licencia of licensesNeedingAttention(this.store.licenses())) {
      avisos.push({
        id: `licencia-${licencia.id}`,
        texto: licencia.product,
        detalle: this.motivoLicencia(licencia),
        // Quedarse sin cupo tumba el trabajo; una renovación cercana solo avisa.
        grave: isNearLimit(licencia)
      });
    }

    for (const fuente of this.store.failedSources()) {
      avisos.push({
        id: `fuente-${fuente.sourceId}`,
        texto: `Sin datos de ${fuente.label}`,
        detalle: fuente.error,
        grave: true
      });
    }

    // sort es estable: dentro de graves y leves se respeta el orden de arriba.
    return avisos.sort((a, b) => Number(b.grave) - Number(a.grave));
  });

  /** Por qué la licencia entró a la lista: el tope, la renovación, o ambos. */
  private motivoLicencia(licencia: LicenseUsage): string {
    const motivos: string[] = [];
    if (isNearLimit(licencia)) {
      motivos.push(`${usagePercent(licencia)}% del tope consumido`);
    }
    const dias = daysToRenewal(licencia);
    if (dias !== undefined && dias <= RENEWAL_WARN_DAYS) {
      // Igual que el chip de Licencias: vencida solo si ya pasó; hoy es "hoy".
      motivos.push(
        dias < 0
          ? 'renovación vencida'
          : dias === 0
            ? 'renueva hoy'
            : `renueva en ${plural(dias, 'día')}`
      );
    }
    return motivos.join(' · ');
  }

  cuenta(junta: Meeting): string {
    return accountsOf(junta)
      .map((id) => this.store.accountOf(id)?.label ?? id)
      .join(' · ');
  }
}
