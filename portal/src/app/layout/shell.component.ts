import { IaService } from '../core/ia/ia.service';
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
}

const NAV: NavItem[] = [
  { path: '/hoy', label: 'Hoy', icon: 'reloj' },
  { path: '/panel', label: 'Panel', icon: 'panel' },
  { path: '/pendientes', label: 'Pendientes', icon: 'tareas' },
  { path: '/personales', label: 'Personales', icon: 'ok' },
  { path: '/dictado', label: 'Dictar', icon: 'microfono' },
  { path: '/agenda', label: 'Agenda', icon: 'agenda' },
  { path: '/monitoreo', label: 'Monitoreo', icon: 'monitoreo' },
  { path: '/crm', label: 'CRM Odoo', icon: 'crm' },
  { path: '/despliegues', label: 'Despliegues', icon: 'despliegue' },
  { path: '/repos', label: 'Repositorios', icon: 'rama' },
  { path: '/licencias', label: 'Licencias', icon: 'licencia' },
  { path: '/equipo', label: 'Equipo', icon: 'equipo' },
  { path: '/correo', label: 'Correo', icon: 'bandeja' },
  { path: '/dominios', label: 'Dominios', icon: 'lugar' }
];

/** Armazon de la aplicacion: barra lateral, encabezado y el area de trabajo. */
@Component({
  selector: 'pt-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BrandLogoComponent,
    IconComponent,
    RelativePipe,
    RouterLink,
    RouterLinkActive,
    RouterOutlet
  ],
  templateUrl: './shell.component.html'
})
export class ShellComponent {
  private readonly theme = inject(ThemeService);

  readonly store = inject(PortalStore);
  readonly sesion = inject(SesionService);
  readonly nav = NAV;

  constructor() {
    // Una sola vez: si el puente tiene IA, para que las pantallas enseñen o
    // escondan sus botones.
    inject(IaService).estado().subscribe({ error: () => undefined });
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

  toggleTheme(): void {
    this.theme.toggle();
  }

  salir(): void {
    this.sesion.salir();
    location.assign('/acceso');
  }

  refresh(): void {
    this.store.refreshAll();
  }
}
