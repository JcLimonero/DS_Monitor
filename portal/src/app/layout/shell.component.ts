import { IaService } from '../core/ia/ia.service';
import { EmpresasService } from '../core/empresas/empresas.service';
import { ProveedoresService } from '../core/proveedores/proveedores.service';
import {
  VentanaIaBotonComponent,
  VentanaIaComponent
} from '../features/ia/ventana-ia.component';
import { Aviso, AvisosService } from '../core/avisos/avisos.service';
import { Router } from '@angular/router';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal
} from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SesionService } from '../core/acceso/sesion.service';
import { TaskItem } from '../core/models';
import { LocalTaskStore } from '../core/sources/local/local-task.store';
import { PortalStore } from '../core/state/portal.store';
import { ThemeService } from '../core/theme/theme.service';
import { BrandLogoComponent } from '../ui/brand-logo.component';
import { IconComponent, IconName } from '../ui/icon.component';
import { RelativePipe } from '../ui/portal.pipes';
import { TaskCardComponent } from '../ui/task-card.component';

interface NavItem {
  path: string;
  label: string;
  icon: IconName;
  /** Deja un espacio antes: empieza otro bloque del menú. */
  separador?: boolean;
}

const NAV: NavItem[] = [
  // Lo de todos los días.
  { path: '/hoy', label: 'Hoy', icon: 'sol' },
  { path: '/pendientes', label: 'Pendientes', icon: 'tareas' },
  { path: '/agenda', label: 'Agenda', icon: 'agenda' },
  { path: '/equipo', label: 'Equipo', icon: 'equipo' },
  // El negocio de un vistazo y sus fuentes.
  { path: '/panel', label: 'Panel', icon: 'panel', separador: true },
  { path: '/monitoreo', label: 'Monitoreo', icon: 'monitoreo' },
  { path: '/vps', label: 'Servidores', icon: 'monitor' },
  { path: '/ejecuciones', label: 'Ejecuciones', icon: 'reproducir' },
  { path: '/despliegues', label: 'Despliegues', icon: 'despliegue' },
  { path: '/repos', label: 'Repositorios', icon: 'rama' },
  { path: '/crm', label: 'CRM', icon: 'crm' },
  { path: '/licencias', label: 'Licencias', icon: 'licencia' },
  // Lo que se configura.
  {
    path: '/integraciones',
    label: 'Integraciones',
    icon: 'ajustes',
    separador: true
  }
];

/** Armazon de la aplicacion: barra lateral, encabezado y el area de trabajo. */
@Component({
  selector: 'pt-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    VentanaIaBotonComponent,
    VentanaIaComponent,
    BrandLogoComponent,
    IconComponent,
    RelativePipe,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    TaskCardComponent
  ],
  templateUrl: './shell.component.html',
  host: { '(document:keydown.escape)': 'cerrarMenus()' }
})
export class ShellComponent {
  private readonly theme = inject(ThemeService);

  readonly store = inject(PortalStore);
  private readonly locales = inject(LocalTaskStore);
  readonly sesion = inject(SesionService);
  readonly avisos = inject(AvisosService);
  private readonly router = inject(Router);
  readonly nav = NAV;
  readonly avisosAbiertos = signal(false);
  /** Menu de tema y salir en pantallas chicas; en escritorio van sueltos. */
  readonly menuUsuarioAbierto = signal(false);
  /**
   * Última copia vista del pendiente del diálogo: si el store refresca un
   * instante sin él, el diálogo no se cierra a medias.
   */
  private readonly dialogoRespaldo = signal<TaskItem | undefined>(undefined);

  private readonly tareaEnStore = computed(() => {
    const id = this.avisos.dialogoId();
    if (!id) {
      return undefined;
    }
    return (
      this.store.tasks().find((t) => t.id === id) ??
      this.locales.tasks().find((t) => t.id === id)
    );
  });

  /** Pendiente mostrado en el diálogo de la campana / liga `?abrir=`. */
  readonly pendienteDialogo = computed(() =>
    this.avisos.dialogoId()
      ? (this.tareaEnStore() ?? this.dialogoRespaldo())
      : undefined
  );

  constructor() {
    // Una sola vez: si el puente tiene IA, para que las pantallas enseñen o
    // escondan sus botones.
    inject(IaService)
      .estado()
      .subscribe({ error: () => undefined });
    // El catálogo de empresas, para los selectores y filtros de todas las
    // pantallas. Se vuelve a pedir al entrar al shell por si la primera vez
    // (antes de la sesión) el puente no contestó. Lo mismo con proveedores.
    const empresas = inject(EmpresasService);
    if (empresas.error()) {
      empresas.cargar();
    }
    const proveedores = inject(ProveedoresService);
    if (proveedores.error()) {
      proveedores.cargar();
    }
    // Con un token guardado, el correo de quien entró se pide al puente: el
    // portal lo usa para "Míos" y para el botón "Mío" de las tarjetas, y al
    // recargar solo se tenía el token.
    if (this.sesion.token() && this.sesion.disponible) {
      this.sesion.estado().subscribe({ error: () => undefined });
    }
    effect(() => {
      const tarea = this.tareaEnStore();
      if (tarea) {
        this.dialogoRespaldo.set(tarea);
      }
    });
    // Si se pidió el diálogo y aún no está en memoria, se vuelve a pedir.
    effect(() => {
      const id = this.avisos.dialogoId();
      if (id && !this.tareaEnStore() && !this.dialogoRespaldo()) {
        this.store.refreshTasks();
      }
    });
  }

  /** Menu lateral en pantallas chicas. En escritorio siempre esta visible. */
  readonly menuOpen = signal(false);

  readonly themeIcon = computed<IconName>(() =>
    this.theme.theme() === 'oscuro' ? 'sol' : 'luna'
  );
  readonly themeLabel = computed(() =>
    this.theme.theme() === 'oscuro'
      ? 'Cambiar a tema claro'
      : 'Cambiar a tema oscuro'
  );

  /** Marca el aviso leído y abre el pendiente en un diálogo (cualquier pantalla). */
  irAlAviso(a: Aviso): void {
    this.avisos.marcarLeidos([a.id]);
    this.avisosAbiertos.set(false);
    if (a.tipo === 'sistema' || !a.tareaId) {
      // Un aviso del monitor (el lunes de "sin asignar") lleva a la vista, no
      // a un pendiente.
      void this.router.navigate(['/pendientes'], {
        queryParams: { owner: 'nadie' }
      });
      return;
    }
    this.dialogoRespaldo.set(undefined);
    this.avisos.abrirEnDialogo(a.tareaId);
    // La URL apunta al pendiente por si se comparte o se recarga; el diálogo
    // ya está arriba aunque se venga de Hoy, Monitoreo, etc.
    void this.router.navigate(['/pendientes'], {
      queryParams: { abrir: a.tareaId }
    });
  }

  toggleTheme(): void {
    this.theme.toggle();
  }

  /** Cierra menús de cabecera y, si hay, el diálogo del pendiente. */
  cerrarMenus(): void {
    this.avisosAbiertos.set(false);
    this.menuUsuarioAbierto.set(false);
    if (this.avisos.dialogoId()) {
      this.cerrarDialogoPendiente();
    }
  }

  cerrarDialogoPendiente(): void {
    this.avisos.cerrarDialogo();
    this.dialogoRespaldo.set(undefined);
    // Quita ?abrir= sin salir de la pantalla actual.
    void this.router.navigate([], {
      queryParams: { abrir: null },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  salir(): void {
    this.sesion.salir();
    location.assign('/acceso');
  }

  refresh(): void {
    this.store.refreshAll();
  }
}
