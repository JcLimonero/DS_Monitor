import { IaService } from '../core/ia/ia.service';
import { EmpresasService } from '../core/empresas/empresas.service';
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
  inject,
  signal
} from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SesionService } from '../core/acceso/sesion.service';
import { PortalStore } from '../core/state/portal.store';
import { ThemeService } from '../core/theme/theme.service';
import { BrandLogoComponent } from '../ui/brand-logo.component';
import { IconComponent, IconName } from '../ui/icon.component';
import { RelativePipe } from '../ui/portal.pipes';

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
    RouterOutlet
  ],
  templateUrl: './shell.component.html',
  host: { '(document:keydown.escape)': 'cerrarMenus()' }
})
export class ShellComponent {
  private readonly theme = inject(ThemeService);

  readonly store = inject(PortalStore);
  readonly sesion = inject(SesionService);
  readonly avisos = inject(AvisosService);
  private readonly router = inject(Router);
  readonly nav = NAV;
  readonly avisosAbiertos = signal(false);
  /** Menu de tema y salir en pantallas chicas; en escritorio van sueltos. */
  readonly menuUsuarioAbierto = signal(false);

  constructor() {
    // Una sola vez: si el puente tiene IA, para que las pantallas enseñen o
    // escondan sus botones.
    inject(IaService)
      .estado()
      .subscribe({ error: () => undefined });
    // El catálogo de empresas, para los selectores y filtros de todas las
    // pantallas. Se vuelve a pedir al entrar al shell por si la primera vez
    // (antes de la sesión) el puente no contestó.
    const empresas = inject(EmpresasService);
    if (empresas.error()) {
      empresas.cargar();
    }
    // Con un token guardado, el correo de quien entró se pide al puente: el
    // portal lo usa para "Míos" y para el botón "Mío" de las tarjetas, y al
    // recargar solo se tenía el token.
    if (this.sesion.token() && this.sesion.disponible) {
      this.sesion.estado().subscribe({ error: () => undefined });
    }
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

  /** Marca el aviso leído y lleva al pendiente, abierto en su detalle. */
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
    this.avisos.abrir.set(a.tareaId);
    void this.router.navigate(['/pendientes'], {
      queryParams: { abrir: a.tareaId }
    });
  }

  toggleTheme(): void {
    this.theme.toggle();
  }

  /** Escape cierra lo que este desplegado en la cabecera. */
  cerrarMenus(): void {
    this.avisosAbiertos.set(false);
    this.menuUsuarioAbierto.set(false);
  }

  salir(): void {
    this.sesion.salir();
    location.assign('/acceso');
  }

  refresh(): void {
    this.store.refreshAll();
  }
}
