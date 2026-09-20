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
  HostedApp,
  PLATFORM_INDICATOR_LABEL,
  PlatformStatus
} from '../../../core/models';
import {
  failedDeployments,
  platformIncidents,
  runningDeployments
} from '../../../core/state/portal.selectors';
import { PortalesService } from '../../../core/portales/portales.service';
import { PortalStore } from '../../../core/state/portal.store';
import { PortalChipComponent } from '../../../ui/portal-chip.component';
import { plural } from '../../../core/util/text.util';
import { IconComponent } from '../../../ui/icon.component';
import { RelativePipe } from '../../../ui/portal.pipes';
import { DiapositivaConContenido } from '../carrusel.model';

const CLASE_ESTADO: Record<DeploymentState, string> = {
  listo: 'text-ok',
  construyendo: 'text-info',
  en_cola: 'text-ink-muted',
  error: 'text-danger',
  cancelado: 'text-ink-subtle'
};

const BORDE_ESTADO: Record<DeploymentState, string> = {
  listo: 'border-line',
  construyendo: 'border-sky-400 dark:border-stone-400/60',
  en_cola: 'border-line',
  error:
    'border-rose-400 bg-rose-50 dark:border-rose-500/50 dark:bg-rose-500/10',
  cancelado: 'border-line'
};

/** Los últimos despliegues y el estado de la plataforma que los corre. */
@Component({
  selector: 'pt-slide-despliegues',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, RelativePipe, PortalChipComponent],
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

    <div class="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
      <!-- Vercel: un renglon por proyecto con su ultimo estado -->
      <section class="tv-card flex min-h-0 flex-col px-5 py-4">
        <h2 class="flex shrink-0 items-baseline gap-3">
          <span class="tv-label">Vercel</span>
          <span
            class="text-lg font-bold"
            [class]="fallidos().length > 0 ? 'text-danger' : 'text-ink-muted'">
            {{
              fallidos().length > 0
                ? fallidos().length + ' con error'
                : despliegues().length + ' proyectos'
            }}
          </span>
        </h2>
        @if (despliegues().length > 0) {
          <ul class="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
            @for (despliegue of despliegues(); track despliegue.id) {
              <li
                class="flex shrink-0 items-center gap-4 rounded-lg border px-4 py-3"
                [class]="borde(despliegue)">
                <span class="w-32 shrink-0">
                  <span
                    class="block text-lg font-bold 2xl:text-xl"
                    [class]="claseEstado(despliegue)">
                    {{ estado(despliegue) }}
                  </span>
                  <span class="block text-sm text-ink-muted">{{
                    entorno(despliegue)
                  }}</span>
                </span>
                <span class="min-w-0 flex-1">
                  <span
                    class="block truncate text-lg font-bold leading-tight text-ink 2xl:text-xl"
                    >{{ despliegue.project }}</span
                  >
                  <span class="block truncate text-base text-ink-muted">
                    {{ mensaje(despliegue) }}
                  </span>
                </span>
                <span class="shrink-0 text-right text-sm text-ink-muted">
                  <span
                    class="flex items-center justify-end gap-1 text-base text-ink">
                    <pt-icon name="rama" class="h-4 w-4 text-ink-subtle" />
                    {{ despliegue.branch }}
                  </span>
                  {{ despliegue.createdAt | relativo }}
                </span>
              </li>
            }
          </ul>
        } @else {
          <p
            class="flex flex-1 items-center justify-center text-xl text-ink-subtle">
            Sin despliegues en Vercel
          </p>
        }
      </section>

      <!-- Coolify: cada portal con su estado actual -->
      <section class="tv-card flex min-h-0 flex-col px-5 py-4">
        <h2 class="flex shrink-0 items-baseline gap-3">
          <span class="tv-label">Coolify</span>
          <span
            class="text-lg font-bold"
            [class]="portalesMal() > 0 ? 'text-danger' : 'text-ink-muted'">
            {{
              portalesMal() > 0
                ? portalesMal() + ' con atención'
                : portales().length + ' portales'
            }}
          </span>
        </h2>
        @if (portales().length > 0) {
          <ul class="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
            @for (p of portales(); track p.id) {
              <li
                class="flex shrink-0 items-center gap-4 rounded-lg border px-4 py-3"
                [class]="claseFila(p)">
                <span
                  class="h-2.5 w-2.5 shrink-0 rounded-full"
                  [class]="punto(p)"></span>
                <span class="min-w-0 flex-1">
                  <span
                    class="block truncate text-lg font-bold leading-tight text-ink 2xl:text-xl"
                    >{{ p.name }}</span
                  >
                  <span class="block truncate text-base text-ink-muted">
                    {{ p.server ? p.server + ' · ' : ''
                    }}{{
                      p.url || (p.kind === 'app' ? 'aplicación' : 'servicio')
                    }}
                  </span>
                </span>
                <span class="shrink-0 text-right">
                  <pt-portal-chip [portal]="p" />
                  @if (p.lastDeployAt) {
                    <span class="mt-1 block text-sm text-ink-muted">{{
                      p.lastDeployAt | relativo
                    }}</span>
                  }
                </span>
              </li>
            }
          </ul>
        } @else {
          <p
            class="flex flex-1 items-center justify-center text-xl text-ink-subtle">
            {{
              coolify.sinConfigurar()
                ? 'Coolify sin conectar'
                : 'Sin portales en Coolify'
            }}
          </p>
        }
      </section>
    </div>

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
export class DesplieguesSlideComponent implements DiapositivaConContenido {
  private readonly store = inject(PortalStore);
  readonly coolify = inject(PortalesService);

  /** Ni despliegues en Vercel ni portales en Coolify. */
  readonly vacia = computed(
    () =>
      this.store.deployments().length === 0 &&
      (this.coolify.lista() ?? []).length === 0
  );

  /** Los portales de Coolify, lo que no corre primero. */
  readonly portales = computed(() =>
    [...(this.coolify.lista() ?? [])].sort(
      (a, b) => pesoPortal(a) - pesoPortal(b) || a.name.localeCompare(b.name)
    )
  );
  readonly portalesMal = computed(() => this.coolify.mal().length);

  punto(p: HostedApp): string {
    if (p.status === 'running' && p.healthy !== false) {
      return 'bg-ok';
    }
    return p.status === 'unknown'
      ? 'bg-ink-subtle'
      : p.status === 'running'
        ? 'bg-warn'
        : 'bg-danger';
  }

  claseFila(p: HostedApp): string {
    if (p.status === 'stopped' || p.status === 'error') {
      return 'border-rose-400 bg-rose-50 dark:border-rose-500/50 dark:bg-rose-500/10';
    }
    if (p.status === 'running' && p.healthy === false) {
      return 'border-amber-400 bg-amber-50 dark:border-amber-500/50 dark:bg-amber-500/10';
    }
    return 'border-line';
  }

  /**
   * Un renglon por proyecto con su ultimo despliegue: lo que importa en la
   * pantalla es el estado actual de cada cosa, no el historial. Produccion
   * manda sobre vista previa cuando hay de las dos; lo roto va arriba.
   */
  readonly despliegues = computed(() => {
    const ultimoPorProyecto = new Map<string, Deployment>();
    for (const d of [...this.store.deployments()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    )) {
      const clave = `${d.project}|${d.environment}`;
      if (!ultimoPorProyecto.has(clave)) {
        ultimoPorProyecto.set(clave, d);
      }
    }
    // Si el proyecto tiene produccion, se enseña esa; si no, su vista previa.
    const porProyecto = new Map<string, Deployment>();
    for (const d of ultimoPorProyecto.values()) {
      const actual = porProyecto.get(d.project);
      if (
        !actual ||
        (actual.environment !== 'produccion' && d.environment === 'produccion')
      ) {
        porProyecto.set(d.project, d);
      }
    }
    const peso = (d: Deployment) =>
      d.state === 'error'
        ? 0
        : d.state === 'construyendo' || d.state === 'en_cola'
          ? 1
          : 2;
    // Lo que esta mal arriba; el resto por abecedario (la columna hace scroll).
    return [...porProyecto.values()].sort(
      (a, b) =>
        peso(a) - peso(b) ||
        a.project.localeCompare(b.project, 'es', { sensitivity: 'base' })
    );
  });

  /** Solo la primera linea del mensaje del commit, sin los trailers. */
  mensaje(d: Deployment): string {
    return (d.commitMessage ?? '').split(/\n|Co-Authored-By/i)[0]?.trim() ?? '';
  }

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

function pesoPortal(p: HostedApp): number {
  if (p.status === 'error') {
    return 0;
  }
  if (p.status === 'stopped') {
    return 1;
  }
  if (p.status === 'running' && p.healthy === false) {
    return 2;
  }
  return p.status === 'unknown' ? 3 : 4;
}
