import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterOutlet } from '@angular/router';
import { interval } from 'rxjs';
import { PORTAL_CONFIG } from './core/config/portal-config.token';
import { PortalStore } from './core/state/portal.store';
import { IconSpriteComponent } from './ui/icon-sprite.component';

/**
 * Raiz de la aplicacion.
 *
 * Solo pinta el catalogo de iconos y deja pasar la ruta: el armazon con barra
 * lateral vive en `ShellComponent`, y el carrusel del monitor corre sin el.
 * Lo que si vive aqui es el ciclo de refresco, que debe correr en los dos.
 */
@Component({
  selector: 'pt-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconSpriteComponent, RouterOutlet],
  template: `
    <pt-icon-sprite />
    <router-outlet />
  `
})
export class AppComponent {
  private readonly config = inject(PORTAL_CONFIG);
  private readonly destroyRef = inject(DestroyRef);
  private readonly store = inject(PortalStore);

  constructor() {
    this.store.refreshAll();

    if (this.config.autoRefreshSeconds > 0) {
      interval(this.config.autoRefreshSeconds * 1000)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.store.refreshAll());
    }
  }
}
