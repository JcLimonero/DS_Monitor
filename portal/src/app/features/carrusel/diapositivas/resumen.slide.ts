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
import { plural } from '../../../core/util/text.util';
import { IconComponent } from '../../../ui/icon.component';
import { MoneyPipe, TimePipe } from '../../../ui/portal.pipes';

/** Un aviso de la columna de atención: qué pasa y qué tan grave es. */
interface Aviso {
  id: string;
  texto: string;
  detalle?: string;
  grave: boolean;
}

/** Cuantas juntas se listan en "lo que sigue". */
const SIGUIENTES = 4;

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
  imports: [IconComponent, MoneyPipe, TimePipe],
  host: { class: 'flex h-full flex-col gap-5' },
  template: `
    <div class="grid shrink-0 grid-cols-2 gap-5 xl:grid-cols-4">
      <div class="tv-card px-6 py-5">
        <p class="tv-label">Pendientes abiertos</p>
        <p class="tv-numero mt-2" [class.text-danger]="vencidos() > 0">
          {{ abiertos() }}
        </p>
        <p class="mt-2 tv-row text-ink-muted">
          <span
            [class.text-danger]="vencidos() > 0"
            [class.font-bold]="vencidos() > 0">
            {{ vencidos() }} vencidos
          </span>
          · {{ paraHoy() }} para hoy
        </p>
      </div>

      <div class="tv-card px-6 py-5">
        <p class="tv-label">Juntas hoy</p>
        <p class="tv-numero mt-2">{{ juntasHoy().length }}</p>
        <p class="mt-2 truncate tv-row text-ink-muted">
          {{ empalmes().length > 0 ? empalmesTexto() : 'Sin empalmes' }}
        </p>
      </div>

      <div class="tv-card px-6 py-5">
        <p class="tv-label">Plataformas con problema</p>
        <p
          class="tv-numero mt-2"
          [class]="conProblema().length > 0 ? 'text-danger' : 'text-ok'">
          {{ conProblema().length }}
        </p>
        <p class="mt-2 tv-row text-ink-muted">{{ vigiladas() }} vigiladas</p>
      </div>

      <div class="tv-card px-6 py-5">
        <p class="tv-label">Embudo ponderado</p>
        <p class="tv-numero mt-2 text-info">{{ ponderado() | moneda }}</p>
        <p class="mt-2 tv-row text-ink-muted">{{ oportunidades() }}</p>
      </div>
    </div>

    <div class="grid min-h-0 flex-1 grid-cols-1 gap-5 lg:grid-cols-3">
      <section class="tv-card flex min-h-0 flex-col px-6 py-5 lg:col-span-2">
        <h2 class="tv-label shrink-0">Lo que sigue</h2>
        @if (siguientes().length > 0) {
          <ul
            class="mt-3 flex min-h-0 flex-1 flex-col justify-around overflow-hidden">
            @for (junta of siguientes(); track junta.id) {
              <li class="flex items-baseline gap-5">
                <span
                  class="w-24 shrink-0 text-2xl font-bold tabular-nums text-ink 2xl:text-3xl">
                  {{ junta.start | hora }}
                </span>
                <span class="min-w-0 flex-1">
                  <span
                    class="block truncate text-xl font-bold text-ink 2xl:text-2xl">
                    {{ junta.title }}
                  </span>
                  <span
                    class="block truncate text-base text-ink-muted 2xl:text-lg">
                    {{ cuenta(junta) }}
                    @if (junta.location) {
                      · {{ junta.location }}
                    }
                  </span>
                </span>
              </li>
            }
          </ul>
        } @else {
          <p class="mt-4 flex-1 text-2xl text-ink-subtle">
            Ya no quedan juntas por delante
          </p>
        }
      </section>

      <section class="tv-card flex min-h-0 flex-col px-6 py-5">
        <h2 class="tv-label shrink-0">Requiere atención</h2>
        @if (avisos().length > 0) {
          <ul
            class="mt-3 flex min-h-0 flex-1 flex-col justify-around overflow-hidden">
            @for (aviso of avisos(); track aviso.id) {
              <li class="flex items-start gap-3">
                <pt-icon
                  name="alerta"
                  class="mt-1 h-6 w-6 shrink-0"
                  [class]="aviso.grave ? 'text-danger' : 'text-warn'" />
                <span class="min-w-0">
                  <span class="block text-xl font-bold text-ink 2xl:text-2xl">{{
                    aviso.texto
                  }}</span>
                  @if (aviso.detalle) {
                    <span
                      class="block truncate text-base text-ink-muted 2xl:text-lg">
                      {{ aviso.detalle }}
                    </span>
                  }
                </span>
              </li>
            }
          </ul>
        } @else {
          <div
            class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <pt-icon name="ok" class="h-16 w-16 text-ok" />
            <p class="text-2xl font-bold text-ok">Todo en orden</p>
          </div>
        }
      </section>
    </div>
  `
})
export class ResumenSlideComponent {
  private readonly store = inject(PortalStore);

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
   * Lo que hay que atender hoy, de lo mas grave a lo menos: una plataforma
   * caída manda mas que un pendiente vencido, y ese manda mas que un empalme.
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

    for (const [a, b] of this.empalmes()) {
      avisos.push({
        id: `empalme-${a.id}-${b.id}`,
        texto: 'Juntas empalmadas',
        detalle: `${a.title} contra ${b.title}`,
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

    return avisos;
  });

  /** Por qué la licencia entró a la lista: el tope, la renovación, o ambos. */
  private motivoLicencia(licencia: LicenseUsage): string {
    const motivos: string[] = [];
    if (isNearLimit(licencia)) {
      motivos.push(`${usagePercent(licencia)}% del tope consumido`);
    }
    const dias = daysToRenewal(licencia);
    if (dias !== undefined && dias <= RENEWAL_WARN_DAYS) {
      motivos.push(
        dias <= 0 ? 'renovación vencida' : `renueva en ${plural(dias, 'día')}`
      );
    }
    return motivos.join(' · ');
  }

  cuenta(junta: Meeting): string {
    return this.store.accountOf(junta.accountId)?.label ?? junta.accountId;
  }
}
