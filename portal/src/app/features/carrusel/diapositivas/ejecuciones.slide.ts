import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject
} from '@angular/core';
import { EjecucionesService } from '../../../core/ejecuciones/ejecuciones.service';
import { Ejecucion } from '../../../core/sources/gateway/puente-admin.service';
import { IconComponent } from '../../../ui/icon.component';
import { RelativePipe } from '../../../ui/portal.pipes';
import { DiapositivaConContenido } from '../carrusel.model';

type Estado = Ejecucion['estado'];

/**
 * Un producto en la pantalla: la misma integracion puede llegar de varios
 * emisores (el cron y la API de PilloFon, por ejemplo) y aqui se ve una vez,
 * con el peor estado del grupo y la corrida mas reciente.
 */
interface Grupo {
  clave: string;
  nombre: string;
  emisores: string;
  estado: Estado;
  erroresSeguidos: number;
  mensaje?: string;
  terminoEn: string;
  duracionMs?: number;
  cadaMinutos?: number;
}

/** Que tan mal esta cada estado; manda el mayor dentro del grupo. */
const PESO: Record<Estado, number> = {
  ok: 0,
  aviso: 1,
  atrasada: 2,
  error: 3
};

/** Cuantas tarjetas caben sin scroll en una pantalla de televisión. */
const MAXIMO = 12;

const ETIQUETA: Record<Estado, string> = {
  ok: 'Bien',
  aviso: 'Con aviso',
  error: 'Falló',
  atrasada: 'Sin señal'
};

/**
 * Colores de estado a tamaño de pantalla: a varios metros el color se lee
 * antes que el texto, asi que cada estado pinta la tarjeta entera.
 */
const CLASE_TARJETA: Record<Estado, string> = {
  ok: 'border-line',
  aviso:
    'border-amber-400 bg-amber-50 dark:border-amber-500/50 dark:bg-amber-500/10',
  error:
    'border-rose-400 bg-rose-50 dark:border-rose-500/50 dark:bg-rose-500/10',
  atrasada:
    'border-stone-400 bg-stone-100 dark:border-stone-400/50 dark:bg-stone-500/10'
};

const CLASE_ESTADO: Record<Estado, string> = {
  ok: 'text-ok',
  aviso: 'text-warn',
  error: 'text-danger',
  atrasada: 'text-ink-muted'
};

/**
 * La ultima corrida de cada servicio declarado, lo que esta mal primero.
 * Cada tarjeta: el nombre, el estado en grande, hace cuanto corrio y el
 * ultimo mensaje.
 */
@Component({
  selector: 'pt-slide-ejecuciones',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, RelativePipe],
  host: { class: 'flex h-full flex-col' },
  template: `
    @if (visibles().length > 0) {
      <div
        class="grid min-h-0 flex-1 grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
        @for (e of visibles(); track e.clave) {
          <article
            class="tv-card flex min-h-0 flex-col justify-between gap-2 px-5 py-4"
            [class]="claseTarjeta(e)">
            <div class="min-w-0">
              <p class="truncate text-xl font-bold text-ink 2xl:text-2xl">
                {{ e.nombre }}
              </p>
              <p class="truncate text-base text-ink-muted">
                {{ e.emisores }}
                @if (frecuencia(e)) {
                  · {{ frecuencia(e) }}
                }
              </p>
            </div>

            <p
              class="flex items-center gap-2 text-2xl font-bold 2xl:text-3xl"
              [class]="claseEstado(e)">
              @if (e.estado === 'error') {
                <pt-icon name="alerta" class="h-7 w-7" />
              } @else if (e.estado === 'ok') {
                <pt-icon name="ok" class="h-7 w-7" />
              } @else if (e.estado === 'atrasada') {
                <pt-icon name="reloj" class="h-7 w-7" />
              }
              {{ etiqueta(e) }}
              @if (e.erroresSeguidos > 1) {
                <span class="text-lg">×{{ e.erroresSeguidos }}</span>
              }
            </p>

            @if (e.mensaje) {
              <p class="line-clamp-2 text-base leading-snug text-ink-muted">
                {{ e.mensaje }}
              </p>
            }

            <p
              class="flex items-baseline justify-between gap-2 text-lg text-ink-muted 2xl:text-xl">
              <span>{{ e.terminoEn | relativo }}</span>
              @if (duracion(e)) {
                <span class="tabular-nums">{{ duracion(e) }}</span>
              }
            </p>
          </article>
        }
      </div>
      @if (restantes() > 0) {
        <p class="mt-2 shrink-0 text-center text-base text-ink-muted">
          y {{ restantes() }} más{{ restoBien() ? ', todas bien' : '' }}
        </p>
      }
    } @else {
      <div
        class="flex flex-1 flex-col items-center justify-center gap-2 text-center text-ink-subtle">
        <pt-icon name="reloj" class="h-10 w-10" />
        <p class="text-lg">
          {{ lista() ? 'Ningún servicio ha reportado todavía' : 'Cargando…' }}
        </p>
      </div>
    }
  `
})
export class EjecucionesSlideComponent implements DiapositivaConContenido {
  private readonly servicio = inject(EjecucionesService);

  readonly lista = this.servicio.lista;
  /** Ya respondio el puente y no hay servicios que enseñar. */
  readonly vacia = computed(() => (this.lista() ?? []).length === 0);
  /** Una tarjeta por integracion, lo malo primero. */
  readonly grupos = computed(() => agrupar(this.lista() ?? []));
  readonly visibles = computed(() => this.grupos().slice(0, MAXIMO));
  readonly restantes = computed(() =>
    Math.max(0, this.grupos().length - MAXIMO)
  );
  /** Vienen ordenadas con lo malo primero: si la ultima visible esta bien, el resto tambien. */
  readonly restoBien = computed(
    () => this.visibles()[this.visibles().length - 1]?.estado === 'ok'
  );

  constructor() {
    this.servicio.cargar();
  }

  etiqueta(e: Grupo): string {
    return ETIQUETA[e.estado];
  }

  claseTarjeta(e: Grupo): string {
    return CLASE_TARJETA[e.estado];
  }

  claseEstado(e: Grupo): string {
    return CLASE_ESTADO[e.estado];
  }

  duracion(e: Grupo): string {
    const ms = e.duracionMs;
    if (ms === undefined) {
      return '';
    }
    if (ms < 1000) {
      return `${ms} ms`;
    }
    if (ms < 60_000) {
      return `${Math.round(ms / 1000)} s`;
    }
    return `${Math.round(ms / 60_000)} min`;
  }

  frecuencia(e: Grupo): string {
    const m = e.cadaMinutos;
    if (!m) {
      return '';
    }
    if (m % 1440 === 0) {
      return m === 1440 ? 'diario' : `cada ${m / 1440} días`;
    }
    if (m % 60 === 0) {
      return m === 60 ? 'cada hora' : `cada ${m / 60} h`;
    }
    return `cada ${m} min`;
  }
}

/**
 * Junta las corridas de la misma integracion. El grupo toma el estado mas
 * grave, el mensaje y la duracion de la corrida que lo tiene, y la fecha de
 * la mas reciente. Se ordena con lo malo primero, como manda el puente.
 */
function agrupar(lista: readonly Ejecucion[]): Grupo[] {
  const grupos = new Map<string, Grupo>();
  for (const e of lista) {
    const previo = grupos.get(e.integracion);
    if (!previo) {
      grupos.set(e.integracion, {
        clave: e.integracion,
        nombre: e.nombre,
        emisores: e.emisor,
        estado: e.estado,
        erroresSeguidos: e.erroresSeguidos,
        mensaje: e.mensaje,
        terminoEn: e.terminoEn,
        duracionMs: e.duracionMs,
        cadaMinutos: e.cadaMinutos
      });
      continue;
    }
    if (!previo.emisores.split(' · ').includes(e.emisor)) {
      previo.emisores = `${previo.emisores} · ${e.emisor}`;
    }
    if (PESO[e.estado] > PESO[previo.estado]) {
      previo.estado = e.estado;
      previo.erroresSeguidos = e.erroresSeguidos;
      previo.mensaje = e.mensaje;
      previo.duracionMs = e.duracionMs;
    }
    if (e.terminoEn > previo.terminoEn) {
      previo.terminoEn = e.terminoEn;
    }
  }
  return [...grupos.values()].sort(
    (a, b) =>
      PESO[b.estado] - PESO[a.estado] || a.nombre.localeCompare(b.nombre)
  );
}
