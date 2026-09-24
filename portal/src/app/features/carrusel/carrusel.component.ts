import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  viewChild
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { interval } from 'rxjs';
import { PortalStore } from '../../core/state/portal.store';
import { ThemeService } from '../../core/theme/theme.service';
import { formatLongDay } from '../../core/util/date.util';
import { AvisosCampanaComponent } from '../../ui/avisos-campana.component';
import { BrandLogoComponent } from '../../ui/brand-logo.component';
import { IconComponent, IconName } from '../../ui/icon.component';
import {
  DIAPOSITIVAS,
  Diapositiva,
  DiapositivaConContenido,
  SEGUNDOS_MAXIMO,
  SEGUNDOS_MINIMO,
  SEGUNDOS_POR_DEFECTO,
  SEGUNDOS_VACIA
} from './carrusel.model';
import { PantallaEncendida } from './pantalla-encendida';
import { AgendaSlideComponent } from './diapositivas/agenda.slide';
import { DesplieguesSlideComponent } from './diapositivas/despliegues.slide';
import { EjecucionesSlideComponent } from './diapositivas/ejecuciones.slide';
import { VpsSlideComponent } from './diapositivas/vps.slide';
import { EmbudoSlideComponent } from './diapositivas/embudo.slide';
import { EquipoSlideComponent } from './diapositivas/equipo.slide';
import { LicenciasSlideComponent } from './diapositivas/licencias.slide';
import { PendientesSlideComponent } from './diapositivas/pendientes.slide';
import { PlataformasSlideComponent } from './diapositivas/plataformas.slide';
import { ResumenSlideComponent } from './diapositivas/resumen.slide';

/** Cada cuanto avanza el reloj interno. Marca el paso de la barra de avance. */
const TIC_MS = 100;

/** Cuanto tardan en esconderse los controles despues del ultimo movimiento. */
const CONTROLES_MS = 5000;

/** Pantalla y pausa del kiosco, para recuperarlas al recargar. */
const CLAVE_CARRUSEL = 'ds-monitor-carrusel';

/**
 * Resumen y equipo no dicen si estan vacias: no se saltan. El resto sí,
 * en cuanto el componente está montado.
 */
const SIN_VACIA = new Set<Diapositiva['id']>(['resumen', 'equipo']);

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
    AvisosCampanaComponent,
    BrandLogoComponent,
    DesplieguesSlideComponent,
    EjecucionesSlideComponent,
    VpsSlideComponent,
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

  private readonly recuerdo = leerCarrusel();
  readonly indice = signal(this.recuerdo.indice);
  readonly pausado = signal(this.recuerdo.pausado);
  readonly segundos = signal(SEGUNDOS_POR_DEFECTO);

  /**
   * La pantalla la eligieron con los puntos del pie. Aunque esté vacía se
   * queda el tiempo corto; el avance automático (flechas, esquinas, fin de
   * tiempo) limpia la marca y sí puede saltarla.
   */
  private readonly elegida = signal(false);

  /** Vacías saltadas seguidas. Si ya son todas menos una, no se cicla. */
  private saltosSeguidos = 0;

  /** Milisegundos que lleva la pantalla actual. Mueve la barra de avance. */
  private readonly transcurrido = signal(0);

  private readonly ultimoMovimiento = signal(Date.now());
  readonly ahora = signal(new Date());

  readonly actual = computed(() => this.diapositivas[this.indice()]);

  /**
   * La diapositiva que esta en pantalla (solo una vive a la vez por el
   * @switch). Las que saben decir si estan vacias se saltan solas.
   */
  private readonly enPantalla =
    viewChild<DiapositivaConContenido>('diapositiva');
  private readonly campana = viewChild('campana', {
    read: AvisosCampanaComponent
  });
  readonly vacia = computed(() => this.enPantalla()?.vacia() ?? false);
  /** Alguien edita algo en un dialogo o tiene la campana abierta: no se avanza. */
  readonly enDialogo = computed(
    () =>
      (this.enPantalla()?.enDialogo?.() ?? false) ||
      (this.campana()?.ocupado() ?? false)
  );
  /** Segundos que dura la diapositiva actual: menos si no tiene contenido. */
  readonly duracion = computed(() =>
    this.vacia() ? Math.min(SEGUNDOS_VACIA, this.segundos()) : this.segundos()
  );
  readonly avance = computed(() =>
    Math.min(100, (this.transcurrido() / (this.duracion() * 1000)) * 100)
  );
  readonly controlesVisibles = computed(
    () =>
      this.pausado() ||
      this.ahora().getTime() - this.ultimoMovimiento() < CONTROLES_MS
  );

  /**
   * Dos relojes: Guadalajara y Monterrey (misma zona, sin horario de verano)
   * y Laredo, que sigue el horario de verano de Estados Unidos y por eso
   * parte del año va una hora adelante.
   */
  readonly reloj = computed(() => horaEn(this.ahora(), 'America/Mexico_City'));
  readonly relojLaredo = computed(() =>
    horaEn(this.ahora(), 'America/Chicago')
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

    effect(() => {
      const id = this.diapositivas[this.indice()].id;
      const pausado = this.pausado();
      try {
        localStorage.setItem(CLAVE_CARRUSEL, JSON.stringify({ id, pausado }));
      } catch {
        // Sin almacenamiento el recorrido no se recuerda al recargar.
      }
    });

    void this.pantalla.iniciar();
    this.destroyRef.onDestroy(() => void this.pantalla.detener());

    // En el celular el carrusel se ve a 3/4: las medidas de television no
    // caben en 430 px. La clase en <html> escala todo lo que va en rem.
    document.documentElement.classList.add('kiosco');
    this.destroyRef.onDestroy(() =>
      document.documentElement.classList.remove('kiosco')
    );

    // Modo kiosco: el Pi no recarga solo. Cada diez minutos se mira si hay
    // una version nueva publicada (cambia el nombre del bundle principal) y,
    // si la hay, se recarga la pagina entre una diapositiva y la siguiente.
    interval(10 * 60_000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.recargarSiHayVersionNueva());

    interval(TIC_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.ahora.set(new Date());
        if (this.pausado() || this.enDialogo()) {
          return;
        }
        if (this.saltarSiVacia()) {
          return;
        }
        const siguiente = this.transcurrido() + TIC_MS;
        if (siguiente >= this.duracion() * 1000) {
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
    this.elegida.set(false);
    this.indice.set(siguiente);
    this.transcurrido.set(0);
  }

  /**
   * Avanza ya si la pantalla actual está vacía y nadie la eligió. Si ya se
   * saltaron todas las demás, o si la eligieron con los puntos, se queda
   * el tiempo corto (`duracion`). Devuelve true cuando ya cambió de pantalla.
   */
  private saltarSiVacia(): boolean {
    const esperaMontaje =
      !SIN_VACIA.has(this.actual().id) && !this.enPantalla();
    if (esperaMontaje) {
      return false;
    }
    if (!this.vacia()) {
      this.saltosSeguidos = 0;
      return false;
    }
    if (this.elegida() || this.saltosSeguidos >= this.diapositivas.length - 1) {
      return false;
    }
    this.saltosSeguidos += 1;
    this.avanzar(1);
    return true;
  }

  irA(indice: number): void {
    this.elegida.set(true);
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

  /**
   * Clic en el encabezado: pausa o continúa. La campana y los enlaces
   * no cuentan: siguen abriendo lo suyo.
   */
  alClicEncabezado(event: MouseEvent): void {
    const objetivo = event.target;
    if (
      objetivo instanceof Element &&
      objetivo.closest('button, a, pt-avisos-campana')
    ) {
      return;
    }
    this.despertarControles();
    this.alternarPausa();
  }

  /**
   * Clic en una esquina del kiosco. Izquierda atras, derecha adelante.
   * Con un dialogo abierto no se cambia de pantalla.
   */
  alClicEsquina(pasos: number): void {
    this.despertarControles();
    if (this.enDialogo()) {
      return;
    }
    this.avanzar(pasos);
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
    if (event.key === 'Escape') {
      const c = this.campana();
      if (c?.panelAbierto()) {
        c.cerrarPanel();
        return;
      }
      if (c?.ocupado()) {
        c.cerrarDialogo();
        return;
      }
    }
    // Con un dialogo abierto las teclas son suyas: la barra espaciadora va
    // al comentario, no a la pausa.
    if (this.enDialogo()) {
      return;
    }
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
  private async recargarSiHayVersionNueva(): Promise<void> {
    try {
      const actual = [...document.scripts]
        .map((sc) => /main-[A-Z0-9]+\.js/i.exec(sc.src)?.[0])
        .find((x) => x);
      if (!actual) {
        return;
      }
      const r = await fetch('/index.html', { cache: 'no-store' });
      const publicado = /main-[A-Z0-9]+\.js/i.exec(await r.text())?.[0];
      // Con un dialogo abierto (alguien escribiendo) no se recarga: se
      // intenta en la siguiente revision.
      if (publicado && publicado !== actual && !this.enDialogo()) {
        location.reload();
      }
    } catch {
      // Sin red no hay version nueva que cargar.
    }
  }
}

function leerCarrusel(): { indice: number; pausado: boolean } {
  const vacio = { indice: 0, pausado: false };
  try {
    const crudo = localStorage.getItem(CLAVE_CARRUSEL);
    if (!crudo) {
      return vacio;
    }
    const dato: unknown = JSON.parse(crudo);
    if (!dato || typeof dato !== 'object') {
      return vacio;
    }
    const id = 'id' in dato ? dato.id : undefined;
    const pausado = 'pausado' in dato ? dato.pausado : undefined;
    if (typeof id !== 'string' || typeof pausado !== 'boolean') {
      return vacio;
    }
    const indice = DIAPOSITIVAS.findIndex(
      (diapositiva) => diapositiva.id === id
    );
    if (indice < 0) {
      return vacio;
    }
    return { indice, pausado };
  } catch {
    return vacio;
  }
}

function horaEn(fecha: Date, zona: string): string {
  return fecha.toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: zona
  });
}
