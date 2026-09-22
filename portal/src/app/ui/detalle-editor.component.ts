import {
  ChangeDetectionStrategy,
  Component,
  input,
  model,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { archivoAFoto, MAX_FOTOS } from '../core/util/fotos.util';
import { IconComponent } from './icon.component';

/**
 * Detalle del alta (y de la edición): área de texto que conserva saltos de
 * línea, más pegar o adjuntar fotos.
 */
@Component({
  selector: 'pt-detalle-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent],
  host: { class: 'block' },
  template: `
    <label class="block">
      <span class="mb-1 block text-xs font-medium text-ink-muted">{{
        etiqueta()
      }}</span>
      <textarea
        class="field min-h-28"
        [name]="name()"
        [placeholder]="placeholder()"
        [disabled]="disabled()"
        [ngModel]="texto()"
        (ngModelChange)="texto.set($event)"
        (paste)="alPegar($event)"></textarea>
    </label>
    <div class="mt-2 flex flex-wrap items-center gap-2">
      <input
        #archivo
        class="sr-only"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        [disabled]="disabled() || lleno()"
        (change)="alElegir($event)" />
      <button
        type="button"
        class="btn h-10 gap-1.5 px-3 text-xs lg:h-8"
        [disabled]="disabled() || lleno()"
        (click)="archivo.click()">
        <pt-icon name="foto" class="h-3.5 w-3.5" />
        Adjuntar foto
      </button>
      <span class="text-xs text-ink-subtle"
        >de referencia: pégala aquí (Ctrl+V)</span
      >
      @if (aviso()) {
        <span class="text-xs text-danger">{{ aviso() }}</span>
      }
    </div>
    @if (imagenes().length) {
      <ul class="mt-2 flex flex-wrap gap-2">
        @for (src of imagenes(); track $index; let i = $index) {
          <li class="relative">
            <img
              [src]="src"
              alt=""
              class="h-16 w-16 rounded-lg border border-line object-cover" />
            <button
              type="button"
              class="absolute -right-1 -top-1 inline-flex h-6 w-6 items-center justify-center rounded-full border border-line bg-surface text-xs text-ink-muted hover:text-danger"
              [disabled]="disabled()"
              [attr.aria-label]="'Quitar foto ' + (i + 1)"
              (click)="quitar(i)">
              ×
            </button>
          </li>
        }
      </ul>
    }
  `
})
export class DetalleEditorComponent {
  readonly texto = model('');
  readonly imagenes = model<string[]>([]);
  readonly name = input('detalle');
  readonly etiqueta = input('Detalle');
  readonly placeholder = input(
    'Contexto, pasos, lo que no cabe en el título. Los renglones se conservan.'
  );
  readonly disabled = input(false);

  readonly aviso = signal<string | undefined>(undefined);

  lleno(): boolean {
    return this.imagenes().length >= MAX_FOTOS;
  }

  quitar(i: number): void {
    this.imagenes.update((fotos) => fotos.filter((_, j) => j !== i));
  }

  alPegar(evento: ClipboardEvent): void {
    const items = evento.clipboardData?.items;
    if (!items) {
      return;
    }
    const archivos: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) {
          archivos.push(f);
        }
      }
    }
    if (archivos.length === 0) {
      return;
    }
    evento.preventDefault();
    void this.agregar(archivos);
  }

  alElegir(evento: Event): void {
    const input = evento.target as HTMLInputElement;
    const lista = input.files ? Array.from(input.files) : [];
    input.value = '';
    void this.agregar(lista);
  }

  private async agregar(archivos: File[]): Promise<void> {
    this.aviso.set(undefined);
    const cupo = MAX_FOTOS - this.imagenes().length;
    if (cupo <= 0) {
      this.aviso.set(`Hasta ${MAX_FOTOS} fotos.`);
      return;
    }
    const nuevas: string[] = [];
    for (const archivo of archivos.slice(0, cupo)) {
      try {
        nuevas.push(await archivoAFoto(archivo));
      } catch {
        this.aviso.set('No se pudo leer una de las fotos.');
      }
    }
    if (nuevas.length) {
      this.imagenes.update((fotos) => [...fotos, ...nuevas]);
    }
  }
}
