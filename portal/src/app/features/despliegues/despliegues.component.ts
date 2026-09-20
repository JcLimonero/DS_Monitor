import { IaDiagnosticosComponent } from '../ia/ia-diagnosticos.component';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  DEPLOYMENT_ENVIRONMENT_LABEL,
  DEPLOYMENT_STATE_LABEL,
  Deployment,
  DeploymentState,
  PLATFORM_INDICATOR_LABEL,
  PlatformIndicator,
  PlatformStatus
} from '../../core/models';
import {
  deploymentsToday,
  failedDeployments,
  platformIncidents,
  runningDeployments
} from '../../core/state/portal.selectors';
import { PortalesService } from '../../core/portales/portales.service';
import { PortalStore } from '../../core/state/portal.store';
import { PortalChipComponent } from '../../ui/portal-chip.component';
import { RouterLink } from '@angular/router';
import { plural } from '../../core/util/text.util';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { IconComponent } from '../../ui/icon.component';
import { PageHeaderComponent } from '../../ui/page-header.component';
import { formatDay, formatTime } from '../../core/util/date.util';
import { RelativePipe } from '../../ui/portal.pipes';

const CLASE_ESTADO: Record<DeploymentState, string> = {
  listo:
    'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200',
  construyendo:
    'bg-sky-100 text-sky-800 dark:bg-stone-500/20 dark:text-stone-200',
  en_cola:
    'bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300',
  error: 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-200',
  cancelado:
    'bg-slate-200 text-slate-600 dark:bg-slate-500/20 dark:text-slate-400'
};

/** A partir de cuantos despliegues vale la pena enseñar los filtros. */
const MINIMO_PARA_FILTRAR = 5;

/**
 * Trailers que agregan las herramientas al final del commit. Solo estos se
 * descartan: una primera linea como "fix: corrige X" es el titulo, no un trailer.
 */
const TRAILER = /^(Co-Authored-By|Signed-off-by|Reviewed-by):\s/i;

/** La primera linea de un mensaje de commit: lo que cabe en un renglon. */
export function primeraLinea(mensaje: string): string {
  const linea = mensaje
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !TRAILER.test(l));
  return linea ?? mensaje.trim();
}

/** El mensaje completo, sin trailers, para cuando se abre el renglon. */
export function mensajeCompleto(mensaje: string): string {
  return mensaje
    .split('\n')
    .filter((l) => !TRAILER.test(l))
    .join('\n')
    .trim();
}

const CLASE_PLATAFORMA: Record<PlatformIndicator, string> = {
  operativo: 'text-ok',
  menor: 'text-warn',
  mayor: 'text-danger',
  critico: 'text-danger',
  mantenimiento: 'text-info',
  desconocido: 'text-ink-subtle'
};

@Component({
  selector: 'pt-despliegues',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IaDiagnosticosComponent,
    EmptyStateComponent,
    FormsModule,
    IconComponent,
    PageHeaderComponent,
    PortalChipComponent,
    RelativePipe,
    RouterLink
  ],
  templateUrl: './despliegues.component.html'
})
export class DesplieguesComponent {
  readonly store = inject(PortalStore);
  /** Lo montado en Coolify: se muestra debajo de los despliegues de Vercel. */
  readonly portales = inject(PortalesService);
  readonly disponible = this.portales.disponible;

  readonly estadoLabel = DEPLOYMENT_STATE_LABEL;
  readonly entornoLabel = DEPLOYMENT_ENVIRONMENT_LABEL;
  readonly plataformaLabel = PLATFORM_INDICATOR_LABEL;

  /** Filtros de la lista. Vacio quiere decir "todos". */
  readonly proyecto = signal<'todos' | string>('todos');
  readonly soloProblemas = signal(false);
  /** Renglon con el mensaje de commit abierto completo. */
  readonly abierto = signal<string | undefined>(undefined);

  /** Con pocos despliegues los filtros estorban mas de lo que ayudan. */
  readonly conFiltros = computed(
    () => this.store.deployments().length > MINIMO_PARA_FILTRAR
  );

  readonly hayVercel = computed(() => this.store.deployments().length > 0);
  readonly hayCoolify = computed(
    () => (this.portales.lista() ?? []).length > 0
  );
  /** Coolify ya contesto (con datos, vacio o sin configurar) o no hay puente. */
  readonly coolifyResuelto = computed(
    () =>
      !this.disponible ||
      this.portales.sinConfigurar() ||
      this.portales.lista() !== undefined
  );
  /** Ni Vercel ni Coolify tienen nada: un solo estado vacio para las dos. */
  readonly sinFuentes = computed(
    () => !this.hayVercel() && !this.hayCoolify() && this.coolifyResuelto()
  );

  readonly proyectos = computed(() =>
    [...new Set(this.store.deployments().map((d) => d.project))].sort()
  );

  readonly despliegues = computed<Deployment[]>(() => {
    const proyecto = this.proyecto();
    return this.store
      .deployments()
      .filter((d) => proyecto === 'todos' || d.project === proyecto)
      .filter(
        (d) =>
          !this.soloProblemas() ||
          d.state === 'error' ||
          d.state === 'cancelado'
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });

  readonly fallidos = computed(() =>
    failedDeployments(this.store.deployments())
  );
  readonly enCurso = computed(() =>
    runningDeployments(this.store.deployments())
  );
  readonly deHoy = computed(() => deploymentsToday(this.store.deployments()));
  readonly incidentes = computed(() =>
    platformIncidents(this.store.platformStatus())
  );

  readonly subtitle = computed(() =>
    [
      `${plural(this.deHoy().length, 'despliegue')} hoy`,
      `${this.enCurso().length} en curso`,
      `${this.fallidos().length} con error`
    ].join(' · ')
  );

  claseEstado(despliegue: Deployment): string {
    return CLASE_ESTADO[despliegue.state];
  }

  clasePlataforma(estado: PlatformStatus): string {
    return CLASE_PLATAFORMA[estado.indicator];
  }

  /** "1 min 36 s". Sin duración devuelve cadena vacia. */
  duracion(despliegue: Deployment): string {
    const segundos = despliegue.durationSeconds;
    if (segundos === undefined) {
      return '';
    }
    if (segundos < 60) {
      return `${segundos} s`;
    }
    const minutos = Math.floor(segundos / 60);
    const resto = segundos % 60;
    return resto === 0 ? `${minutos} min` : `${minutos} min ${resto} s`;
  }

  limpiarFiltros(): void {
    this.proyecto.set('todos');
    this.soloProblemas.set(false);
  }

  /** Fecha y hora completas para el `title` de la fecha relativa. */
  fechaCompleta(despliegue: Deployment): string {
    return `${formatDay(despliegue.createdAt)} ${formatTime(despliegue.createdAt)}`;
  }

  resumen(despliegue: Deployment): string {
    return primeraLinea(despliegue.commitMessage ?? '');
  }

  completo(despliegue: Deployment): string {
    return mensajeCompleto(despliegue.commitMessage ?? '');
  }

  /** Si el mensaje tiene mas que la primera linea, el renglon se puede abrir. */
  tieneMas(despliegue: Deployment): boolean {
    return this.completo(despliegue) !== this.resumen(despliegue);
  }

  alternar(despliegue: Deployment): void {
    if (!this.tieneMas(despliegue)) {
      return;
    }
    this.abierto.set(
      this.abierto() === despliegue.id ? undefined : despliegue.id
    );
  }
}
