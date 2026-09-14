import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { interval } from 'rxjs';
import { PORTAL_CONFIG } from './core/config/portal-config.token';
import { PortalStore } from './core/state/portal.store';
import { ThemeService } from './core/theme/theme.service';
import { IconComponent, IconName } from './ui/icon.component';
import { IconSpriteComponent } from './ui/icon-sprite.component';
import { RelativePipe } from './ui/portal.pipes';

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
  { path: '/equipo', label: 'Equipo', icon: 'equipo' },
  { path: '/ajustes', label: 'Ajustes', icon: 'ajustes' }
];

@Component({
  selector: 'pt-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IconComponent,
    IconSpriteComponent,
    RelativePipe,
    RouterLink,
    RouterLinkActive,
    RouterOutlet
  ],
  templateUrl: './app.component.html'
})
export class AppComponent {
  private readonly config = inject(PORTAL_CONFIG);
  private readonly destroyRef = inject(DestroyRef);
  private readonly theme = inject(ThemeService);

  readonly store = inject(PortalStore);
  readonly nav = NAV;

  /** Menu lateral en pantallas chicas. En escritorio siempre está visible. */
  readonly menuOpen = signal(false);

  readonly themeIcon = computed<IconName>(() =>
    this.theme.theme() === 'oscuro' ? 'sol' : 'luna'
  );
  readonly themeLabel = computed(() =>
    this.theme.theme() === 'oscuro'
      ? 'Cambiar a tema claro'
      : 'Cambiar a tema oscuro'
  );

  constructor() {
    this.store.refreshAll();

    if (this.config.autoRefreshSeconds > 0) {
      interval(this.config.autoRefreshSeconds * 1000)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.store.refreshAll());
    }
  }

  toggleTheme(): void {
    this.theme.toggle();
  }

  refresh(): void {
    this.store.refreshAll();
  }
}
