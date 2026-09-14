import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { interval } from 'rxjs';
import { PortalStore } from '../../core/state/portal.store';
import { ThemeService } from '../../core/theme/theme.service';
import { formatLongDay } from '../../core/util/date.util';
import { BrandLogoComponent } from '../../ui/brand-logo.component';
import { IconComponent, IconName } from '../../ui/icon.component';
import {
  DIAPOSITIVAS,
  SEGUNDOS_MAXIMO,
  SEGUNDOS_MINIMO,
  SEGUNDOS_POR_DEFECTO
} from './carrusel.model';
import { PantallaEncendida } from './pantalla-encendida';
import { AgendaSlideComponent } from './diapositivas/agenda.slide';
import { DesplieguesSlideComponent } from './diapositivas/despliegues.slide';
import { EmbudoSlideComponent } from './diapositivas/embudo.slide';
import { EquipoSlideComponent } from './diapositivas/equipo.slide';
import { LicenciasSlideComponent } from './diapositivas/licencias.slide';
import { PendientesSlideComponent } from './diapositivas/pendientes.slide';
import { PlataformasSlideComponent } from './diapositivas/plataformas.slide';
import { ResumenSlideComponent } from './diapositivas/resumen.slide';

/** Cada cuanto avanza el reloj interno. Marca el paso de la barra de avance. */
const TIC_MS = 100;

/** Cuanto tardan en esconderse los controles despues del ultimo movimiento. */
const CONTROLES_MS = 3000;

/**
 * Carrusel para el monitor de la oficina.
 *
 * Corre sin barra lateral y va cambiando solo de pantalla. Nadie lo opera: los
 * controles aparecen si alguien mueve el ratón y se esconden solos.
 *
 * Se puede ajustar el ritmo por la URL: `/carrusel?segundos=30`.
 */
@Component({
  selector: 'pt-carrusel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AgendaSlideComponent,
    BrandLogoComponent,
    DesplieguesSlideComponent,
    EmbudoSlideComponent,
    EquipoSlideComponent,
    LicenciasSlideComponent,
    IconComponent,
    PendientesSlideComponent,
    PlataformasSlideComponent,
    ResumenSlideComponent,
    RouterLink
  ],
  templateUrl: './carrusel.component.html',
  host: {
    class: 'block h-dvh overflow-hidden bg-app',
    '(document:keydown)': 'alTeclear($event)',
    '(document:mousemove)': 'despertarControles()'
  }
})
export class CarruselComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly theme = inject(ThemeService);
  private readonly pantalla = new PantallaEncendida();

  readonly store = inject(PortalStore);
  readonly diapositivas = DIAPOSITIVAS;

  readonly indice = signal(0);
  readonly pausado = signal(false);
  readonly segundos = signal(SEGUNDOS_POR_DEFECTO);

  /** Milisegundos que lleva la pantalla actual. Mueve la barra de avance. */
  private readonly transcurrido = signal(0);

  private readonly ultimoMovimiento = signal(Date.now());
  readonly ahora = signal(new Date());

  readonly actual = computed(() => this.diapositivas[this.indice()]);
  readonly avance = computed(() =>
    Math.min(100, (this.transcurrido() / (this.segundos() * 1000)) * 100)
  );
  readonly controlesVisibles = computed(
    () =>
      this.pausado() ||
      this.ahora().getTime() - this.ultimoMovimiento() < CONTROLES_MS
  );

  readonly reloj = computed(() =>
    this.ahora().toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    })
  );
  readonly fecha = computed(() => formatLongDay(this.ahora()));

  readonly themeIcon = computed<IconName>(() =>
    this.theme.theme() === 'oscuro' ? 'sol' : 'luna'
  );

  constructor() {
    const segundos = Number(this.route.snapshot.queryParamMap.get('segundos'));
    if (Number.isFinite(segundos) && segundos > 0) {
      this.segundos.set(
        Math.min(
          SEGUNDOS_MAXIMO,
          Math.max(SEGUNDOS_MINIMO, Math.round(segundos))
        )
      );
    }

    void this.pantalla.iniciar();
    this.destroyRef.onDestroy(() => void this.pantalla.detener());

    interval(TIC_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.ahora.set(new Date());
        if (this.pausado()) {
          return;
        }
        const siguiente = this.transcurrido() + TIC_MS;
        if (siguiente >= this.segundos() * 1000) {
          this.avanzar(1);
        } else {
          this.transcurrido.set(siguiente);
        }
      });
  }

  /**
   * Cambia de pantalla. Al completar una vuelta vuelve a pedir los datos, para
   * que un monitor que lleva horas prendido no muestre la foto de la mañana.
   */
  avanzar(pasos: number): void {
    const total = this.diapositivas.length;
    const siguiente = (this.indice() + pasos + total) % total;
    if (siguiente === 0 && pasos > 0) {
      this.store.refreshAll();
    }
    this.indice.set(siguiente);
    this.transcurrido.set(0);
  }

  irA(indice: number): void {
    this.indice.set(indice);
    this.transcurrido.set(0);
  }

  alternarPausa(): void {
    this.pausado.update((valor) => !valor);
  }

  alternarTema(): void {
    this.theme.toggle();
  }

  despertarControles(): void {
    this.ultimoMovimiento.set(Date.now());
  }

  async pantallaCompleta(): Promise<void> {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // El navegador la niega si no viene de un gesto del usuario.
    }
  }

  alTeclear(event: KeyboardEvent): void {
    this.despertarControles();
    switch (event.key) {
      case ' ':
        event.preventDefault();
        this.alternarPausa();
        break;
      case 'ArrowRight':
        this.avanzar(1);
        break;
      case 'ArrowLeft':
        this.avanzar(-1);
        break;
      case 'f':
      case 'F':
        void this.pantallaCompleta();
        break;
      default:
        break;
    }
  }
}
