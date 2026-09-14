import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal
} from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
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
  { path: '/panel', label: 'Panel', icon: 'panel' },
  { path: '/pendientes', label: 'Pendientes', icon: 'tareas' },
  { path: '/agenda', label: 'Agenda', icon: 'agenda' },
  { path: '/monitoreo', label: 'Monitoreo', icon: 'monitoreo' },
  { path: '/crm', label: 'CRM Odoo', icon: 'crm' },
  { path: '/despliegues', label: 'Despliegues', icon: 'despliegue' },
  { path: '/licencias', label: 'Licencias', icon: 'licencia' },
  { path: '/equipo', label: 'Equipo', icon: 'equipo' },
  { path: '/ajustes', label: 'Ajustes', icon: 'ajustes' }
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
  readonly nav = NAV;

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

  refresh(): void {
    this.store.refreshAll();
  }
}
