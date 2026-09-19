import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input
} from '@angular/core';
import { VpsPoint } from '../core/models';

const ANCHO = 100;
const ALTO = 32;

/**
 * Una curva de porcentaje (0–100) de las últimas horas: CPU o memoria de un
 * servidor. Área rellena para que se lea a distancia; sin ejes, el número
 * grande de al lado ya dice el valor actual.
 */
@Component({
  selector: 'pt-serie',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.viewBox]="'0 0 ' + ancho + ' ' + alto"
      preserveAspectRatio="none"
      class="h-8 w-full"
      role="img"
      [attr.aria-label]="etiqueta()">
      <line
        x1="0"
        [attr.y1]="alto * 0.15"
        [attr.x2]="ancho"
        [attr.y2]="alto * 0.15"
        class="stroke-current opacity-15"
        stroke-width="0.5"
        stroke-dasharray="2 2" />
      @if (area(); as a) {
        <path [attr.d]="a" class="fill-current opacity-15" />
        <path
          [attr.d]="linea()"
          fill="none"
          class="stroke-current"
          stroke-width="1.5"
          vector-effect="non-scaling-stroke" />
      }
    </svg>
  `,
  host: { class: 'block' }
})
export class SerieComponent {
  readonly puntos = input.required<VpsPoint[]>();
  readonly nombre = input('serie');
  readonly ancho = ANCHO;
  readonly alto = ALTO;

  private readonly coords = computed(() => {
    const p = this.puntos();
    if (p.length < 2) {
      return [];
    }
    return p.map((punto, i) => ({
      x: (i / (p.length - 1)) * ANCHO,
      y: ALTO - (Math.max(0, Math.min(100, punto.value)) / 100) * ALTO
    }));
  });

  readonly linea = computed(() =>
    this.coords()
      .map(
        (c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)} ${c.y.toFixed(1)}`
      )
      .join(' ')
  );

  readonly area = computed(() => {
    const c = this.coords();
    if (c.length === 0) {
      return '';
    }
    return `${this.linea()} L${ANCHO} ${ALTO} L0 ${ALTO} Z`;
  });

  readonly etiqueta = computed(() => {
    const p = this.puntos();
    const ultimo = p[p.length - 1];
    return ultimo
      ? `${this.nombre()}: ${ultimo.value} % ahora, ${p.length} puntos`
      : `${this.nombre()}: sin datos`;
  });
}
