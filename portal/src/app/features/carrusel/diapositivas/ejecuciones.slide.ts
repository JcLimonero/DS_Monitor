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
      <!--
        Todas las tarjetas, en una rejilla por ancho (.tv-rejilla). Cada una:
        el nombre, el estado (con hace cuanto y cuanto tardo en la misma
        linea), de quien viene y cada cuanto corre, y el ultimo mensaje.
      -->
      <div class="tv-rejilla" style="--tv-min: 11rem">
        @for (e of visibles(); track e.clave) {
          <article
            class="tv-card flex min-w-0 flex-col gap-0.5 px-3 py-2"
            [class]="claseTarjeta(e)">
            <p class="tv-nombre line-clamp-2">{{ e.nombre }}</p>

            <p
              class="tv-estado flex items-center gap-1.5"
              [class]="claseEstado(e)">
              @if (e.estado === 'error') {
                <pt-icon name="alerta" class="h-5 w-5 shrink-0" />
              } @else if (e.estado === 'ok') {
                <pt-icon name="ok" class="h-5 w-5 shrink-0" />
              } @else if (e.estado === 'atrasada') {
                <pt-icon name="reloj" class="h-5 w-5 shrink-0" />
              }
              <span class="min-w-0">{{ etiqueta(e) }}</span>
              @if (e.erroresSeguidos > 1) {
                <span class="shrink-0 text-sm">×{{ e.erroresSeguidos }}</span>
              }
              @if (duracion(e)) {
                <span class="tv-dato ml-auto shrink-0 font-normal tabular-nums">
                  {{ duracion(e) }}
                </span>
              }
            </p>

            <p
              class="tv-dato line-clamp-1 [@media(min-height:901px)]:line-clamp-2">
              {{ e.terminoEn | relativo }}
              @if (frecuencia(e)) {
                · {{ frecuencia(e) }}
              }
              · {{ e.emisores }}
            </p>

            @if (e.mensaje) {
              <p class="tv-dato line-clamp-2">{{ e.mensaje }}</p>
            }
          </article>
        }
      </div>
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
  /** Vacia solo cuando ya respondio y no hay nada; cargando no cuenta. */
  readonly vacia = computed(() => this.lista()?.length === 0);
  /** Una tarjeta por integracion, lo malo primero. */
  readonly grupos = computed(() => agrupar(this.lista() ?? []));
  /** Todas, con lo malo primero; la cuadricula hace scroll. */
  readonly visibles = computed(() => this.grupos());

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
