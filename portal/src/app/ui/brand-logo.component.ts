import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input
} from '@angular/core';
import { ThemeService } from '../core/theme/theme.service';

/**
 * Logo de Dealer Solutions: el toro solo, como isotipo (el logotipo completo
 * con el nombre sigue en `dealer-solutions*.png` por si hace falta en un
 * correo). Hay dos archivos porque el original es para fondo claro; la
 * variante oscura lleva la tinta aclarada.
 */
@Component({
  selector: 'pt-brand-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <img
      [src]="src()"
      alt="Dealer Solutions"
      [style.height.rem]="heightRem()"
      class="w-auto" />
  `,
  host: { class: 'inline-flex' }
})
export class BrandLogoComponent {
  private readonly theme = inject(ThemeService);

  /** Alto del logo en rem. El ancho sale solo de la proporcion. */
  readonly heightRem = input(2);

  readonly src = computed(() =>
    this.theme.theme() === 'oscuro' ? 'toro-oscuro.png' : 'toro.png'
  );
}
