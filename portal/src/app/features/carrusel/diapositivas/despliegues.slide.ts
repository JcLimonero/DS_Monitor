import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject
} from '@angular/core';
import {
  DEPLOYMENT_ENVIRONMENT_LABEL,
  DEPLOYMENT_STATE_LABEL,
  Deployment,
  DeploymentState,
  PLATFORM_INDICATOR_LABEL,
  PlatformStatus
} from '../../../core/models';
import {
  failedDeployments,
  platformIncidents,
  runningDeployments
} from '../../../core/state/portal.selectors';
import { PortalStore } from '../../../core/state/portal.store';
import { plural } from '../../../core/util/text.util';
import { IconComponent } from '../../../ui/icon.component';
import { RelativePipe } from '../../../ui/portal.pipes';

/** Cuantos despliegues caben sin apretar los renglones. */
const RENGLONES = 6;

const CLASE_ESTADO: Record<DeploymentState, string> = {
  listo: 'text-ok',
  construyendo: 'text-info',
  en_cola: 'text-ink-muted',
  error: 'text-danger',
  cancelado: 'text-ink-subtle'
};

const BORDE_ESTADO: Record<DeploymentState, string> = {
  listo: 'border-line',
  construyendo: 'border-sky-400 dark:border-sky-500/50',
  en_cola: 'border-line',
  error:
    'border-rose-400 bg-rose-50 dark:border-rose-500/50 dark:bg-rose-500/10',
  cancelado: 'border-line'
};

/** Los últimos despliegues y el estado de la plataforma que los corre. */
@Component({
  selector: 'pt-slide-despliegues',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, RelativePipe],
  host: { class: 'flex h-full flex-col gap-4' },
  template: `
    @if (incidentes().length > 0) {
      <div
        class="shrink-0 rounded-2xl border border-amber-400 bg-amber-50 px-6 py-4 dark:border-amber-500/40 dark:bg-amber-500/10">
        @for (incidente of incidentes(); track incidente.id) {
          <p
            class="flex items-center gap-3 tv-title text-amber-900 dark:text-amber-200">
            <pt-icon name="alerta" class="h-7 w-7" />
            {{ incidente.label }}: {{ etiquetaPlataforma(incidente) }} ·
            {{ incidente.description }}
          </p>
        }
      </div>
    }

    @if (despliegues().length > 0) {
      <ul
        class="flex min-h-0 flex-1 flex-col justify-center gap-3 overflow-hidden">
        @for (despliegue of despliegues(); track despliegue.id) {
          <li
            class="tv-card flex shrink-0 items-center gap-5 px-6 py-4"
            [class]="borde(despliegue)">
            <span class="w-44 shrink-0">
              <span
                class="block text-xl font-bold 2xl:text-2xl"
                [class]="claseEstado(despliegue)">
                {{ estado(despliegue) }}
              </span>
              <span class="block text-base text-ink-muted">{{
                entorno(despliegue)
              }}</span>
            </span>

            <span class="min-w-0 flex-1">
              <span class="block truncate tv-title">{{
                despliegue.project
              }}</span>
              <span
                class="mt-0.5 block truncate text-lg text-ink-muted 2xl:text-xl">
                {{ despliegue.commitMessage }}
              </span>
            </span>

            <span class="shrink-0 text-right">
              <span class="flex items-center justify-end gap-2 tv-row text-ink">
                <pt-icon name="rama" class="h-5 w-5 text-ink-subtle" />
                {{ despliegue.branch }}
              </span>
              <span class="block text-base text-ink-muted">
                {{ despliegue.author?.name }} ·
                {{ despliegue.createdAt | relativo }}
              </span>
            </span>
          </li>
        }
      </ul>
    } @else {
      <div class="flex flex-1 items-center justify-center">
        <p class="text-3xl text-ink-subtle">Sin despliegues recientes</p>
      </div>
    }

    <div
      class="flex shrink-0 flex-wrap items-center gap-x-8 gap-y-2 rounded-2xl border border-line bg-surface px-6 py-3 tv-row">
      <p
        class="flex items-center gap-3"
        [class.text-danger]="fallidos().length > 0">
        @if (fallidos().length > 0) {
          <pt-icon name="alerta" class="h-7 w-7" />
        } @else {
          <pt-icon name="ok" class="h-7 w-7 text-ok" />
        }
        {{ textoFallidos() }}
      </p>
      <p class="ml-auto text-ink-muted">{{ textoEnCurso() }}</p>
    </div>
  `
})
export class DesplieguesSlideComponent {
  private readonly store = inject(PortalStore);

  readonly despliegues = computed(() =>
    [...this.store.deployments()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, RENGLONES)
  );

  readonly fallidos = computed(() =>
    failedDeployments(this.store.deployments())
  );
  readonly enCurso = computed(() =>
    runningDeployments(this.store.deployments())
  );
  readonly incidentes = computed(() =>
    platformIncidents(this.store.platformStatus())
  );

  readonly textoFallidos = computed(() =>
    this.fallidos().length === 0
      ? 'Ningún despliegue con error'
      : `${plural(this.fallidos().length, 'despliegue')} con error`
  );

  readonly textoEnCurso = computed(() =>
    this.enCurso().length === 0
      ? 'Nada construyéndose'
      : `${plural(this.enCurso().length, 'despliegue')} en curso`
  );

  estado(despliegue: Deployment): string {
    return DEPLOYMENT_STATE_LABEL[despliegue.state];
  }

  entorno(despliegue: Deployment): string {
    return DEPLOYMENT_ENVIRONMENT_LABEL[despliegue.environment];
  }

  claseEstado(despliegue: Deployment): string {
    return CLASE_ESTADO[despliegue.state];
  }

  borde(despliegue: Deployment): string {
    return BORDE_ESTADO[despliegue.state];
  }

  etiquetaPlataforma(estado: PlatformStatus): string {
    return PLATFORM_INDICATOR_LABEL[estado.indicator];
  }
}
