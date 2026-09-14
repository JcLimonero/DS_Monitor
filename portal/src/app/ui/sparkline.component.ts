import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input
} from '@angular/core';
import { MonitorCheck } from '../core/models';

const VIEW_WIDTH = 100;
const VIEW_HEIGHT = 32;

interface FailureMark {
  x: number;
  width: number;
}

/**
 * Curva de latencia de las últimas revisiones.
 *
 * Las revisiones fallidas no se dibujan en la línea (una latencia de cero
 * bajaria la curva y parecería una mejora); se marcan como franjas rojas de
 * fondo, que es lo que de verdad pasó.
 */
@Component({
  selector: 'pt-sparkline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.viewBox]="'0 0 ' + viewWidth + ' ' + viewHeight"
      preserveAspectRatio="none"
      class="h-8 w-full"
      role="img"
      [attr.aria-label]="ariaLabel()">
      @for (mark of failures(); track mark.x) {
        <rect
          [attr.x]="mark.x"
          y="0"
          [attr.width]="mark.width"
          [attr.height]="viewHeight"
          class="fill-rose-500/25" />
      }
      @if (points()) {
        <polyline
          [attr.points]="points()"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linejoin="round"
          stroke-linecap="round"
          vector-effect="non-scaling-stroke" />
      }
    </svg>
  `
})
export class SparklineComponent {
  readonly checks = input.required<readonly MonitorCheck[]>();

  readonly viewWidth = VIEW_WIDTH;
  readonly viewHeight = VIEW_HEIGHT;

  private readonly step = computed(() => {
    const count = this.checks().length;
    return count > 1 ? VIEW_WIDTH / (count - 1) : VIEW_WIDTH;
  });

  readonly points = computed(() => {
    const checks = this.checks();
    const ok = checks.filter((check) => check.ok);
    if (ok.length < 2) {
      return '';
    }
    const max = Math.max(...ok.map((check) => check.latencyMs));
    const min = Math.min(...ok.map((check) => check.latencyMs));
    // Rango mínimo para que una serie casi plana no se vea como sierra.
    const span = Math.max(max - min, 1);
    return checks
      .map((check, index) => {
        if (!check.ok) {
          return null;
        }
        const x = index * this.step();
        const y =
          VIEW_HEIGHT -
          ((check.latencyMs - min) / span) * (VIEW_HEIGHT - 4) -
          2;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .filter((point): point is string => point !== null)
      .join(' ');
  });

  readonly failures = computed<FailureMark[]>(() =>
    this.checks()
      .map((check, index) => ({ check, index }))
      .filter(({ check }) => !check.ok)
      .map(({ index }) => ({
        x: Math.max(0, index * this.step() - this.step() / 2),
        width: Math.max(this.step(), 1.5)
      }))
  );

  readonly ariaLabel = computed(() => {
    const checks = this.checks();
    const failed = checks.filter((check) => !check.ok).length;
    return `${checks.length} revisiones recientes, ${failed} con falla`;
  });
}
