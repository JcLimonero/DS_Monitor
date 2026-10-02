import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  DominiosService,
  mensajeDeError
} from '../../core/dominios/dominios.service';
import {
  DominioUnificado,
  claseVencimiento,
  destinoLegible,
  estadoDeZona,
  etiquetaTtl,
  filtrarSubdominios,
  textoVencimiento,
  urlParaAbrir,
  zonasPorImportar
} from '../../core/dominios/dominios.util';
import {
  RegistroDns,
  RespuestaSubdominios,
  ResultadoImportacion
} from '../../core/sources/gateway/puente-admin.service';
import { plural } from '../../core/util/text.util';
import { DialogoComponent } from '../../ui/dialogo.component';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { IconComponent } from '../../ui/icon.component';
import { PageHeaderComponent } from '../../ui/page-header.component';
import { DayPipe } from '../../ui/portal.pipes';

/** Desde este ancho (lg) los subdominios se abren en la misma lista. */
const CONSULTA_ANCHA = '(min-width: 1024px)';

/** Cuántos hosts se pintan de una vez (y cuántos suma "Mostrar más"). */
export const HOSTS_POR_PAGINA = 200;
/** Lo que se espera tras la última tecla antes de filtrar. */
const ESPERA_BUSQUEDA_MS = 200;

/** Los tonos de la zona, con los tokens del tema. */
const CLASE_TONO = {
  ok: 'bg-ok/5 text-ok',
  warn: 'bg-warn/5 text-warn',
  danger: 'bg-danger/5 text-danger',
  neutro: 'bg-surface-muted text-ink-muted'
} as const;

type EstadoSubdominios =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'listo'; datos: RespuestaSubdominios };

/**
 * Los dominios en un solo lugar: los capturados a mano y los de Cloudflare.
 * Al tocar uno se ven sus subdominios (el DNS agrupado por host): en la misma
 * lista cuando hay ancho y en una hoja completa en el celular y la tableta
 * vertical.
 */
@Component({
  selector: 'pt-dominios',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DayPipe,
    DecimalPipe,
    DialogoComponent,
    EmptyStateComponent,
    FormsModule,
    IconComponent,
    NgTemplateOutlet,
    PageHeaderComponent,
    RouterLink
  ],
  templateUrl: './dominios.component.html'
})
export class DominiosComponent {
  readonly svc = inject(DominiosService);

  /** Hay ancho para abrir los subdominios dentro de la lista. */
  readonly ancho = signal(true);

  /** El dominio abierto (su nombre). */
  readonly abierto = signal<string | undefined>(undefined);
  /** Lo que hay escrito en el buscador (se filtra tras una pausa). */
  readonly entrada = signal('');
  /** El texto que ya se aplicó al filtro. */
  readonly busqueda = signal('');
  /** Cuántos hosts se pintan. */
  readonly limite = signal(HOSTS_POR_PAGINA);
  /** Destinos abiertos completos (por id de registro). */
  readonly expandidos = signal<ReadonlySet<string>>(new Set());
  readonly subs = signal<EstadoSubdominios | undefined>(undefined);
  /** El registro cuyo destino se acaba de copiar. */
  readonly copiado = signal<string | undefined>(undefined);

  readonly importando = signal(false);
  readonly seleccion = signal<ReadonlySet<string>>(new Set());
  readonly importandoOcupado = signal(false);
  readonly errorImportar = signal<string | undefined>(undefined);
  /** Lo que pasó en la última importación, para mostrarlo en la página. */
  readonly resultado = signal<ResultadoImportacion | undefined>(undefined);

  private readonly listaSubs = viewChild<ElementRef<HTMLElement>>('listaSubs');

  readonly lista = this.svc.unificados;
  readonly dominioAbierto = computed(() =>
    this.lista().find((d) => d.nombre === this.abierto())
  );
  readonly candidatos = computed(() =>
    zonasPorImportar(this.svc.manuales(), this.svc.zonas())
  );
  readonly subdominios = computed(() => {
    const estado = this.subs();
    return estado?.tipo === 'listo'
      ? filtrarSubdominios(estado.datos.subdominios, this.busqueda())
      : [];
  });
  /** Los primeros hosts de los que coinciden; el filtro ve todos. */
  readonly visibles = computed(() =>
    this.subdominios().slice(0, this.limite())
  );
  readonly restantes = computed(
    () => this.subdominios().length - this.visibles().length
  );
  readonly subtitulo = computed(() => {
    const total = this.lista().length;
    const enCloudflare = this.svc.zonas().length;
    if (total === 0) {
      return 'Registro, vencimiento y subdominios';
    }
    return enCloudflare > 0
      ? `${plural(total, 'dominio')} · ${enCloudflare} en Cloudflare`
      : plural(total, 'dominio');
  });
  readonly resumenImportacion = computed(() => {
    const r = this.resultado();
    if (!r) {
      return '';
    }
    const partes = [
      plural(r.importados.length, 'importado'),
      `${r.existentes.length} ya ${r.existentes.length === 1 ? 'existía' : 'existían'}`
    ];
    if (r.sinFecha.length > 0) {
      partes.push(
        `${r.sinFecha.length} sin fecha de vencimiento (captúrala en Dominios)`
      );
    }
    return partes.join(' · ');
  });

  private pausaBusqueda: ReturnType<typeof setTimeout> | undefined;

  readonly urlParaAbrir = urlParaAbrir;
  readonly textoVencimiento = textoVencimiento;
  readonly claseVencimiento = claseVencimiento;
  readonly destinoLegible = destinoLegible;
  readonly etiquetaTtl = etiquetaTtl;
  readonly plural = plural;

  constructor() {
    const consulta =
      typeof matchMedia === 'function' ? matchMedia(CONSULTA_ANCHA) : undefined;
    if (consulta) {
      this.ancho.set(consulta.matches);
      const alCambiar = () => this.ancho.set(consulta.matches);
      consulta.addEventListener('change', alCambiar);
      // Algunos navegadores tardan en avisar el cambio (o no lo hacen si la
      // ventana no se está pintando): el redimensionado también lo revisa.
      window.addEventListener('resize', alCambiar);
      inject(DestroyRef).onDestroy(() => {
        consulta.removeEventListener('change', alCambiar);
        window.removeEventListener('resize', alCambiar);
      });
    }
    inject(DestroyRef).onDestroy(() => clearTimeout(this.pausaBusqueda));
    void this.svc.cargar();
  }

  claseTono(tono: keyof typeof CLASE_TONO): string {
    return CLASE_TONO[tono];
  }

  estadoZona(d: DominioUnificado) {
    return d.zona ? estadoDeZona(d.zona) : undefined;
  }

  /** Costo, registrador y renovación automática del dominio capturado. */
  detalle(d: DominioUnificado): string {
    const partes: string[] = [];
    const m = d.manual;
    const registrador =
      m?.registrador ?? (d.zona?.registro ? 'Cloudflare' : undefined);
    if (registrador) {
      partes.push(registrador);
    }
    if (m && m.sinFecha !== true && m.costo !== undefined) {
      partes.push(`${m.costo} ${m.moneda ?? 'MXN'}`);
    }
    const auto = m ? m.automatico : d.zona?.registro?.autoRenovar;
    if (auto) {
      partes.push('renovación automática');
    }
    if (d.zona?.plan) {
      partes.push(`plan ${d.zona.plan}`);
    }
    return partes.join(' · ');
  }

  alternar(d: DominioUnificado): void {
    if (this.abierto() === d.nombre) {
      this.cerrar();
      return;
    }
    this.abierto.set(d.nombre);
    this.reiniciarBusqueda();
    this.subs.set(undefined);
    if (d.zona) {
      void this.cargarSubdominios(d.zona.id, false);
    }
  }

  cerrar(): void {
    this.abierto.set(undefined);
    this.subs.set(undefined);
    this.reiniciarBusqueda();
  }

  private reiniciarBusqueda(): void {
    clearTimeout(this.pausaBusqueda);
    this.entrada.set('');
    this.busqueda.set('');
    this.limite.set(HOSTS_POR_PAGINA);
    this.expandidos.set(new Set());
  }

  actualizarSubdominios(d: DominioUnificado): void {
    if (d.zona) {
      void this.cargarSubdominios(d.zona.id, true);
    }
  }

  private async cargarSubdominios(
    zonaId: string,
    refrescar: boolean
  ): Promise<void> {
    const nombre = this.abierto();
    this.subs.set({ tipo: 'cargando' });
    try {
      const datos = await this.svc.subdominios(zonaId, refrescar);
      // Si mientras tanto se abrió otro dominio, esto ya no aplica.
      if (this.abierto() === nombre) {
        this.subs.set({ tipo: 'listo', datos });
      }
    } catch (error) {
      if (this.abierto() === nombre) {
        this.subs.set({ tipo: 'error', mensaje: mensajeDeError(error) });
      }
    }
  }

  /**
   * Al escribir se espera una pausa antes de filtrar (con miles de hosts cada
   * tecla costaba cientos de milisegundos); la lista vuelve arriba y a la
   * primera página.
   */
  buscar(texto: string): void {
    this.entrada.set(texto);
    clearTimeout(this.pausaBusqueda);
    this.pausaBusqueda = setTimeout(() => {
      this.busqueda.set(texto);
      this.limite.set(HOSTS_POR_PAGINA);
      const lista = this.listaSubs()?.nativeElement;
      if (lista) {
        lista.scrollTop = 0;
      }
    }, ESPERA_BUSQUEDA_MS);
  }

  mostrarMas(): void {
    this.limite.update((n) => n + HOSTS_POR_PAGINA);
  }

  mostrarTodos(): void {
    this.limite.set(Number.MAX_SAFE_INTEGER);
  }

  expandido(id: string): boolean {
    return this.expandidos().has(id);
  }

  /** Un toque abre o cierra el destino completo (el `title` no sirve en iPad). */
  alternarDestino(id: string): void {
    this.expandidos.update((actual) => {
      const nueva = new Set(actual);
      if (!nueva.delete(id)) {
        nueva.add(id);
      }
      return nueva;
    });
  }

  async copiar(registro: RegistroDns): Promise<void> {
    try {
      await navigator.clipboard.writeText(registro.contenido);
    } catch {
      copiarConSeleccion(registro.contenido);
    }
    this.copiado.set(registro.id);
    setTimeout(() => {
      if (this.copiado() === registro.id) {
        this.copiado.set(undefined);
      }
    }, 1500);
  }

  // --- Importar de Cloudflare ---

  abrirImportar(): void {
    this.errorImportar.set(undefined);
    this.seleccion.set(new Set());
    this.importando.set(true);
  }

  cerrarImportar(): void {
    this.importando.set(false);
  }

  marcar(nombre: string, evento: Event): void {
    const marcado = (evento.target as HTMLInputElement).checked;
    this.seleccion.update((actual) => {
      const nueva = new Set(actual);
      if (marcado) {
        nueva.add(nombre);
      } else {
        nueva.delete(nombre);
      }
      return nueva;
    });
  }

  todasMarcadas(): boolean {
    const candidatos = this.candidatos();
    return (
      candidatos.length > 0 &&
      candidatos.every((z) => this.seleccion().has(z.nombre))
    );
  }

  marcarTodas(evento: Event): void {
    const marcado = (evento.target as HTMLInputElement).checked;
    this.seleccion.set(
      marcado ? new Set(this.candidatos().map((z) => z.nombre)) : new Set()
    );
  }

  async importar(): Promise<void> {
    const nombres = [...this.seleccion()];
    if (nombres.length === 0 || this.importandoOcupado()) {
      return;
    }
    this.importandoOcupado.set(true);
    this.errorImportar.set(undefined);
    try {
      this.resultado.set(await this.svc.importar(nombres));
      this.importando.set(false);
    } catch (error) {
      this.errorImportar.set(mensajeDeError(error));
    } finally {
      this.importandoOcupado.set(false);
    }
  }
}

/** Respaldo para copiar cuando el navegador no da el portapapeles. */
function copiarConSeleccion(texto: string): void {
  const area = document.createElement('textarea');
  area.value = texto;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    document.execCommand('copy');
  } catch {
    // Sin portapapeles no hay más que hacer.
  }
  area.remove();
}
