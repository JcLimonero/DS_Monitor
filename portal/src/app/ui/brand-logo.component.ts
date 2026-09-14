import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input
} from '@angular/core';
import { ThemeService } from '../core/theme/theme.service';

/**
 * Logo de Dealer Solutions.
 *
 * Hay dos archivos porque el logo original es para fondo claro: sobre navy sus
 * grises casi desaparecen. La variante oscura es el mismo trazo con las dos
 * tintas aclaradas.
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
    this.theme.theme() === 'oscuro'
      ? 'dealer-solutions-oscuro.png'
      : 'dealer-solutions.png'
  );
}
