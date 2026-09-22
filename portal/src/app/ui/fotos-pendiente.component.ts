import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  input,
  output,
  signal,
  viewChild
} from '@angular/core';
import {
  archivoAFoto,
  fotosVisibles,
  MAX_FOTOS
} from '../core/util/fotos.util';
import { IconComponent } from './icon.component';

/**
 * Fotos de referencia de un pendiente: miniaturas, ampliar, y (si se
 * puede editar) pegar o adjuntar sin abrir el formulario completo.
 */
@Component({
  selector: 'pt-fotos-pendiente',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'block' },
  template: `
    @if (visibles().length || editable()) {
      <div
        class="mt-2"
        tabindex="0"
        (dragover)="alArrastrar($event)"
        (drop)="alSoltar($event)"
        (paste)="alPegar($event)">
        @if (visibles().length) {
          <ul class="flex flex-wrap gap-2">
            @for (src of visibles(); track $index; let i = $index) {
              <li class="relative">
                <button
                  type="button"
                  class="block overflow-hidden rounded-lg border border-line bg-surface-muted"
                  [attr.aria-label]="'Ver foto ' + (i + 1)"
                  (click)="ampliada.set(src)">
                  <img
                    [src]="src"
                    alt=""
                    [class]="
                      compact()
                        ? 'h-14 w-14 object-cover'
                        : 'h-24 w-24 object-cover lg:h-28 lg:w-28'
                    " />
                </button>
                @if (editable() && !disabled()) {
                  <button
                    type="button"
                    class="absolute -right-1 -top-1 inline-flex h-6 w-6 items-center justify-center rounded-full border border-line bg-surface text-xs text-ink-muted hover:text-danger"
                    [attr.aria-label]="'Quitar foto ' + (i + 1)"
                    (click)="quitar(i)">
                    ×
                  </button>
                }
              </li>
            }
          </ul>
        }
        @if (editable()) {
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
              {{ visibles().length ? 'Otra foto' : 'Foto de referencia' }}
            </button>
            <span class="text-xs text-ink-subtle"
              >pantallazo, croquis o foto; también se pega (Ctrl+V)</span
            >
            @if (aviso()) {
              <span class="text-xs text-danger">{{ aviso() }}</span>
            }
          </div>
        }
      </div>
    }
    @if (ampliada(); as src) {
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Foto de referencia"
        (click)="ampliada.set(undefined)"
        (keydown.escape)="ampliada.set(undefined)">
        <img
          [src]="src"
          alt=""
          class="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-lg" />
      </div>
    }
  `
})
export class FotosPendienteComponent {
  readonly urls = input<string[] | undefined>(undefined);
  readonly compact = input(false);
  readonly editable = input(false);
  readonly disabled = input(false);
  readonly imagenesChange = output<string[]>();

  readonly aviso = signal<string | undefined>(undefined);
  readonly ampliada = signal<string | undefined>(undefined);
  readonly visibles = computed(() => fotosVisibles(this.urls()));
  private readonly archivo = viewChild<ElementRef<HTMLInputElement>>('archivo');

  abrirSelector(): void {
    this.archivo()?.nativeElement.click();
  }

  lleno(): boolean {
    return this.visibles().length >= MAX_FOTOS;
  }

  quitar(i: number): void {
    const siguientes = this.visibles().filter((_, j) => j !== i);
    this.imagenesChange.emit(siguientes);
  }

  alArrastrar(evento: DragEvent): void {
    if (!this.editable() || this.disabled()) {
      return;
    }
    evento.preventDefault();
  }

  alSoltar(evento: DragEvent): void {
    if (!this.editable() || this.disabled()) {
      return;
    }
    evento.preventDefault();
    const lista = evento.dataTransfer?.files
      ? Array.from(evento.dataTransfer.files)
      : [];
    void this.agregar(lista);
  }

  alPegar(evento: ClipboardEvent): void {
    if (!this.editable() || this.disabled()) {
      return;
    }
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
    const fotos = archivos.filter((f) => f.type.startsWith('image/'));
    if (fotos.length === 0) {
      if (archivos.length) {
        this.aviso.set('Solo se aceptan fotos.');
      }
      return;
    }
    const cupo = MAX_FOTOS - this.visibles().length;
    if (cupo <= 0) {
      this.aviso.set(`Hasta ${MAX_FOTOS} fotos.`);
      return;
    }
    const nuevas: string[] = [];
    for (const archivo of fotos.slice(0, cupo)) {
      try {
        nuevas.push(await archivoAFoto(archivo));
      } catch {
        this.aviso.set('No se pudo leer una de las fotos.');
      }
    }
    if (nuevas.length) {
      this.imagenesChange.emit([...this.visibles(), ...nuevas]);
    }
  }
}
