import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { VpsHealth, VpsStatus } from '../../core/models';
import { plural } from '../../core/util/text.util';
import { PortalesService } from '../../core/portales/portales.service';
import { VpsService } from '../../core/vps/vps.service';
import { PortalChipComponent } from '../../ui/portal-chip.component';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { IconComponent } from '../../ui/icon.component';
import { PageHeaderComponent } from '../../ui/page-header.component';
import { RelativePipe } from '../../ui/portal.pipes';
import { SerieComponent } from '../../ui/serie.component';

export const VPS_HEALTH_LABEL: Record<VpsHealth, string> = {
  bien: 'Bien',
  aviso: 'Aviso',
  critico: 'Crítico',
  sin_senal: 'Sin señal'
};

export const CLASE_SALUD: Record<VpsHealth, string> = {
  bien: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  aviso: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
  critico: 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200',
  sin_senal: 'bg-surface-muted text-ink-muted'
};

/** Color de una barra de uso según el porcentaje. */
export function claseUso(pct: number | undefined): string {
  if (pct === undefined) {
    return 'bg-ink-subtle';
  }
  return pct >= 90 ? 'bg-danger' : pct >= 75 ? 'bg-warn' : 'bg-ok';
}

export function bytesPorSegundo(bps: number | undefined): string {
  if (bps === undefined) {
    return '—';
  }
  if (bps < 1024) {
    return `${Math.round(bps)} B/s`;
  }
  if (bps < 1024 * 1024) {
    return `${(bps / 1024).toFixed(0)} KB/s`;
  }
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
}

export function tiempoArriba(segundos: number | undefined): string {
  if (segundos === undefined) {
    return '—';
  }
  const d = Math.floor(segundos / 86_400);
  const h = Math.floor((segundos % 86_400) / 3600);
  return d > 0
    ? `${d} d ${h} h`
    : `${h} h ${Math.floor((segundos % 3600) / 60)} min`;
}

/**
 * Servidores: una tarjeta por VPS con CPU, memoria, disco, red, carga y
 * tiempo arriba, las curvas de las últimas 6 horas y sus contenedores. Lo
 * que está mal va primero. Los datos los lee el puente de Prometheus.
 */
@Component({
  selector: 'pt-vps',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    EmptyStateComponent,
    IconComponent,
    PageHeaderComponent,
    PortalChipComponent,
    RelativePipe,
    RouterLink,
    SerieComponent
  ],
  templateUrl: './vps.component.html'
})
export class VpsComponent {
  private readonly servicio = inject(VpsService);
  readonly portales = inject(PortalesService);

  readonly disponible = this.servicio.disponible;
  readonly lista = this.servicio.lista;
  readonly error = this.servicio.error;
  readonly sinConfigurar = this.servicio.sinConfigurar;
  readonly abierto = signal<string | undefined>(undefined);
  readonly etiqueta = VPS_HEALTH_LABEL;

  readonly ordenados = computed(() => {
    const peso: Record<VpsHealth, number> = {
      sin_senal: 0,
      critico: 1,
      aviso: 2,
      bien: 3
    };
    return [...(this.lista() ?? [])].sort(
      (a, b) => peso[a.health] - peso[b.health] || a.name.localeCompare(b.name)
    );
  });

  readonly subtitulo = computed(() => {
    const lista = this.lista();
    if (!lista) {
      return 'Cargando…';
    }
    const portales = this.portales.lista() ?? [];
    const portalesMal = this.portales.mal().length;
    const mal = lista.filter((v) => v.health !== 'bien').length;
    const cont = lista.reduce(
      (n, v) => n + v.containers.filter((c) => c.running).length,
      0
    );
    return [
      plural(lista.length, 'servidor', 'servidores'),
      mal > 0 ? `${mal} con atención` : 'todos bien',
      `${plural(cont, 'contenedor', 'contenedores')} corriendo`,
      ...(portales.length > 0
        ? [
            `${plural(portales.length, 'portal', 'portales')} en Coolify${portalesMal > 0 ? `, ${portalesMal} con atención` : ''}`
          ]
        : [])
    ].join(' · ');
  });

  cargar(): void {
    this.servicio.cargar();
  }

  alternar(id: string): void {
    this.abierto.set(this.abierto() === id ? undefined : id);
  }

  claseSalud(v: VpsStatus): string {
    return CLASE_SALUD[v.health];
  }

  claseUso = claseUso;
  red = bytesPorSegundo;
  arriba = tiempoArriba;
}
