import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { EjecucionesService } from '../../core/ejecuciones/ejecuciones.service';
import { Ejecucion } from '../../core/sources/gateway/puente-admin.service';
import { plural } from '../../core/util/text.util';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { IconComponent } from '../../ui/icon.component';
import { PageHeaderComponent } from '../../ui/page-header.component';
import { RelativePipe } from '../../ui/portal.pipes';

type Estado = Ejecucion['estado'];

export const ESTADO_EJECUCION_LABEL: Record<Estado, string> = {
  ok: 'Bien',
  aviso: 'Con aviso',
  error: 'Falló',
  atrasada: 'Atrasada'
};

const CLASE_ESTADO: Record<Estado, string> = {
  ok: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  aviso: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
  error: 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200',
  atrasada: 'bg-surface-muted text-ink-muted'
};

/** Cuanto dura la pregunta "¿Olvidar?" antes de volver al boton normal. */
const CONFIRMACION_MS = 5_000;

/**
 * La última corrida de cada servicio: qué corrió, cuándo, cómo le fue y
 * cuánto tardó. Lo manda cada aplicación con su token (Integraciones → API
 * de ingesta). Los que están mal van primero; el detalle se abre por renglón.
 */
@Component({
  selector: 'pt-ejecuciones',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    EmptyStateComponent,
    IconComponent,
    PageHeaderComponent,
    RelativePipe,
    RouterLink
  ],
  templateUrl: './ejecuciones.component.html'
})
export class EjecucionesComponent {
  private readonly servicio = inject(EjecucionesService);

  readonly disponible = this.servicio.disponible;
  readonly ejecuciones = this.servicio.lista;
  readonly error = this.servicio.error;
  readonly filtro = signal<Estado | 'todas'>('todas');
  readonly abierta = signal<string | undefined>(undefined);
  /** Clave del servicio que espera el "Sí / No" de Olvidar. */
  readonly confirmando = signal<string | undefined>(undefined);
  private temporizador: ReturnType<typeof setTimeout> | undefined;
  readonly etiqueta = ESTADO_EJECUCION_LABEL;
  readonly estados: Estado[] = ['error', 'atrasada', 'aviso', 'ok'];

  readonly conteo = computed(() => {
    const c: Record<Estado, number> = {
      ok: 0,
      aviso: 0,
      error: 0,
      atrasada: 0
    };
    for (const e of this.ejecuciones() ?? []) {
      c[e.estado]++;
    }
    return c;
  });

  readonly visibles = computed(() => {
    const filtro = this.filtro();
    return (this.ejecuciones() ?? []).filter(
      (e) => filtro === 'todas' || e.estado === filtro
    );
  });

  /** La columna Duración solo se enseña si algun servicio la reporta. */
  readonly conDuracion = computed(() =>
    this.visibles().some((e) => e.duracionMs !== undefined)
  );

  readonly subtitulo = computed(() => {
    const lista = this.ejecuciones();
    if (!lista) {
      return 'Cargando…';
    }
    const c = this.conteo();
    const partes = [plural(lista.length, 'servicio')];
    if (c.error > 0) {
      partes.push(`${c.error} con error`);
    }
    if (c.atrasada > 0) {
      partes.push(
        `${c.atrasada} ${c.atrasada === 1 ? 'atrasada' : 'atrasadas'}`
      );
    }
    if (c.aviso > 0) {
      partes.push(`${c.aviso} con aviso`);
    }
    return partes.join(' · ');
  });

  cargar(): void {
    this.servicio.cargar();
  }

  alternar(clave: string): void {
    this.abierta.set(this.abierta() === clave ? undefined : clave);
  }

  /** Primer clic en Olvidar: pregunta en linea y se arrepiente sola a los 5 s. */
  pedirOlvidar(e: Ejecucion): void {
    clearTimeout(this.temporizador);
    this.confirmando.set(e.clave);
    this.temporizador = setTimeout(
      () => this.confirmando.set(undefined),
      CONFIRMACION_MS
    );
  }

  cancelarOlvidar(): void {
    clearTimeout(this.temporizador);
    this.confirmando.set(undefined);
  }

  /** Borra el registro; si el servicio vuelve a correr, reaparece. */
  olvidar(e: Ejecucion): void {
    this.cancelarOlvidar();
    this.servicio.borrar(e.clave);
  }

  claseEstado(e: Ejecucion): string {
    return CLASE_ESTADO[e.estado];
  }

  /** "Falló · 3" cuando lleva varios errores seguidos; si no, solo el estado. */
  textoEstado(e: Ejecucion): string {
    const base = ESTADO_EJECUCION_LABEL[e.estado];
    return e.erroresSeguidos > 1 ? `${base} · ${e.erroresSeguidos}` : base;
  }

  duracion(e: Ejecucion): string {
    const ms = e.duracionMs;
    if (ms === undefined) {
      return '';
    }
    if (ms < 1000) {
      return `${ms} ms`;
    }
    if (ms < 60_000) {
      return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
    }
    const min = Math.round(ms / 60_000);
    return min < 60 ? `${min} min` : `${(min / 60).toFixed(1)} h`;
  }

  frecuencia(e: Ejecucion): string {
    const m = e.cadaMinutos;
    if (!m) {
      return '';
    }
    if (m % 1440 === 0) {
      return `cada ${plural(m / 1440, 'día')}`;
    }
    if (m % 60 === 0) {
      return `cada ${plural(m / 60, 'hora')}`;
    }
    return `cada ${m} min`;
  }
}
