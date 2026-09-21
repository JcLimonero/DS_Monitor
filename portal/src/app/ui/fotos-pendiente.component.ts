import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input
} from '@angular/core';
import { fotosVisibles } from '../core/util/fotos.util';

/** Miniaturas o fotos grandes del detalle de un pendiente. */
@Component({
  selector: 'pt-fotos-pendiente',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visibles().length) {
      <div class="mt-2 flex flex-wrap gap-2">
        @for (src of visibles(); track $index) {
          <img
            [src]="src"
            alt=""
            class="rounded-lg border border-line bg-surface-muted"
            [class]="
              compact()
                ? 'h-14 w-14 object-cover'
                : 'max-h-48 max-w-[12rem] object-contain'
            " />
        }
      </div>
    }
  `
})
export class FotosPendienteComponent {
  readonly urls = input<string[] | undefined>(undefined);
  readonly compact = input(false);
  readonly visibles = computed(() => fotosVisibles(this.urls()));
}
