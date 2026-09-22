import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal
} from '@angular/core';
import { PORTAL_CONFIG } from '../../core/config/portal-config.token';
import { DecimalPipe } from '@angular/common';
import { RelativePipe } from '../../ui/portal.pipes';

interface Entrada {
  en: string;
  uso: string;
  modelo: string;
  ms: number;
  entrada: number;
  salida: number;
  costo?: number;
  pregunta: string;
  respuesta: string;
  error?: string;
}

interface Resumen {
  llamadas: number;
  costo: number;
  entrada: number;
  salida: number;
}

const POR_PAGINA = 20;

/** Qué se le pidió al modelo, qué costó y qué contestó: con páginas de 20. */
@Component({
  selector: 'pt-ia-bitacora',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, RelativePipe],
  template: `
    <section class="card card-pad mt-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-sm font-semibold text-ink">Bitácora de la IA</h2>
        <button type="button" class="btn" (click)="cargar()">Actualizar</button>
      </div>
      @if (resumen().length > 0) {
        <div class="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
          @for (r of resumen(); track r.uso) {
            <div class="rounded-lg bg-surface-muted px-3 py-2">
              <p class="font-medium text-ink">{{ r.uso }}</p>
              <p class="text-ink-muted">
                {{ r.llamadas }} llamadas ·
                {{ r.entrada + r.salida | number }} tokens ·
                {{ r.costo | number: '1.4-4' }} USD
              </p>
            </div>
          }
        </div>
      }
      @if (entradas().length === 0) {
        <p class="mt-3 text-sm text-ink-muted">
          Todavía no hay llamadas registradas.
        </p>
      } @else {
        <ul class="mt-3 divide-y divide-line">
          @for (e of pagina(); track e.en + e.uso) {
            <li class="py-2 text-xs">
              <details>
                <summary
                  class="flex cursor-pointer flex-wrap items-center gap-2 text-ink">
                  <span class="chip bg-surface-muted text-ink-muted">{{
                    e.uso
                  }}</span>
                  <span class="text-ink-subtle">{{ e.en | relativo }}</span>
                  <span class="text-ink-muted">{{ e.modelo }}</span>
                  <span class="ml-auto tabular-nums text-ink-muted">
                    {{ e.entrada }} → {{ e.salida }} tok · {{ e.ms }} ms
                    @if (e.costo !== undefined) {
                      · {{ e.costo | number: '1.5-5' }} USD
                    }
                  </span>
                  @if (e.error) {
                    <span class="chip bg-rose-100 text-rose-700">error</span>
                  }
                </summary>
                <div class="mt-2 grid gap-2 lg:grid-cols-2">
                  <pre
                    class="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-surface-muted p-2 font-mono text-[11px] text-ink-muted"
                    >{{ e.pregunta }}</pre>
                  <pre
                    class="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-surface-muted p-2 font-mono text-[11px] text-ink-muted"
                    >{{ e.error ?? e.respuesta }}</pre>
                </div>
              </details>
            </li>
          }
        </ul>
        @if (totalPaginas() > 1) {
          <div
            class="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
            <p>
              {{ desde() }}–{{ hasta() }} de {{ entradas().length }} · página
              {{ hoja() }} de {{ totalPaginas() }}
            </p>
            <div class="flex gap-2">
              <button
                type="button"
                class="btn h-10 px-3 lg:h-8"
                [disabled]="hoja() <= 1"
                (click)="ir(hoja() - 1)">
                Anterior
              </button>
              <button
                type="button"
                class="btn h-10 px-3 lg:h-8"
                [disabled]="hoja() >= totalPaginas()"
                (click)="ir(hoja() + 1)">
                Siguiente
              </button>
            </div>
          </div>
        }
      }
    </section>
  `
})
export class IaBitacoraComponent {
  private readonly http = inject(HttpClient);
  private readonly config = inject(PORTAL_CONFIG);

  readonly entradas = signal<Entrada[]>([]);
  readonly porUso = signal<Record<string, Resumen>>({});
  readonly hoja = signal(1);
  readonly porPagina = POR_PAGINA;

  readonly resumen = computed(() =>
    Object.entries(this.porUso())
      .map(([uso, r]) => ({ uso, ...r }))
      .sort((a, b) => b.costo - a.costo || b.llamadas - a.llamadas)
  );

  readonly totalPaginas = computed(() =>
    Math.max(1, Math.ceil(this.entradas().length / this.porPagina))
  );

  readonly pagina = computed(() => {
    const i = (this.hoja() - 1) * this.porPagina;
    return this.entradas().slice(i, i + this.porPagina);
  });

  readonly desde = computed(() =>
    this.entradas().length === 0 ? 0 : (this.hoja() - 1) * this.porPagina + 1
  );

  readonly hasta = computed(() =>
    Math.min(this.hoja() * this.porPagina, this.entradas().length)
  );

  constructor() {
    this.cargar();
  }

  ir(n: number): void {
    const tope = this.totalPaginas();
    this.hoja.set(Math.min(tope, Math.max(1, n)));
  }

  cargar(): void {
    if (!this.config.gatewayUrl) {
      return;
    }
    this.http
      .get<{ entradas: Entrada[]; porUso: Record<string, Resumen> }>(
        `${this.config.gatewayUrl}/ia/bitacora`
      )
      .subscribe({
        next: (r) => {
          this.entradas.set(r.entradas);
          this.porUso.set(r.porUso);
          this.hoja.set(1);
        },
        error: () => undefined
      });
  }
}
