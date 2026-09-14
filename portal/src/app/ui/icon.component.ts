import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Nombres validos del catalogo de `pt-icon-sprite`. */
export type IconName =
  | 'panel'
  | 'tareas'
  | 'agenda'
  | 'monitoreo'
  | 'crm'
  | 'equipo'
  | 'ajustes'
  | 'refrescar'
  | 'sol'
  | 'luna'
  | 'externo'
  | 'alerta'
  | 'ok'
  | 'reloj'
  | 'mas'
  | 'basura'
  | 'buscar'
  | 'video'
  | 'lugar'
  | 'bandeja'
  | 'menu'
  | 'cerrar';

@Component({
  selector: 'pt-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false">
      <use [attr.href]="'#i-' + name()" />
    </svg>
  `,
  host: { class: 'inline-flex shrink-0' },
  styles: `
    :host {
      width: 1.25rem;
      height: 1.25rem;
    }

    svg {
      width: 100%;
      height: 100%;
    }
  `
})
export class IconComponent {
  readonly name = input.required<IconName>();
}
