import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal
} from '@angular/core';
import { VistaSemana } from '../../core/ia/ia.models';
import { IaService, describirError } from '../../core/ia/ia.service';
import { RelativePipe } from '../../ui/portal.pipes';

/**
 * El correo del lunes: a cada persona del equipo le llega su semana
 * (pendientes, vencidos, juntas) con un párrafo de apertura de la IA. El
 * puente lo manda solo los lunes a las 8; desde aquí se ve la vista previa
 * y se puede mandar ahora, a todos o a uno.
 */
@Component({
  selector: 'pt-semana-config',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RelativePipe],
  template: `
    <section class="card card-pad mt-4">
      <h2 class="text-sm font-semibold text-ink">Resumen semanal del equipo</h2>
      <p class="mt-0.5 text-xs text-ink-muted">
        Cada lunes a las 8:00 (hora del centro) cada persona con correo recibe
        sus pendientes, lo vencido y sus juntas de la semana, con una apertura
        redactada por la IA. Necesita el acceso (EmailJS) configurado.
        @if (vista()?.ultimoEnvio?.enviadoEn; as en) {
          Último envío {{ en | relativo }} a
          {{ vista()?.ultimoEnvio?.enviados?.length ?? 0 }} personas.
        }
      </p>
      <div class="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          class="btn"
          [disabled]="cargando()"
          (click)="previsualizar()">
          {{ cargando() ? 'Armando…' : 'Vista previa' }}
        </button>
        <button
          type="button"
          class="btn btn-primary"
          [disabled]="cargando()"
          (click)="enviar()">
          Mandar ahora a todos
        </button>
      </div>
      @if (mensaje(); as m) {
        <p class="mt-2 text-xs text-ink-muted">{{ m }}</p>
      }
      @if (vista(); as v) {
        @if (v.personas.length === 0) {
          <p class="mt-3 text-sm text-ink-muted">
            Nadie tiene pendientes asignados ni juntas esta semana; no se
            mandaría nada.
          </p>
        }
        <ul class="mt-3 space-y-2">
          @for (p of v.personas; track p.persona.id) {
            <li class="rounded-lg border border-line p-3 text-sm">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <p class="font-medium text-ink">
                  {{ p.persona.name }}
                  <span class="text-xs text-ink-subtle">{{
                    p.persona.email
                  }}</span>
                </p>
                <div class="flex items-center gap-2">
                  <span class="text-xs text-ink-muted">
                    {{ p.pendientes }} pendientes · {{ p.vencidos }} vencidos ·
                    {{ p.juntas }} juntas
                  </span>
                  <button
                    type="button"
                    class="btn"
                    [disabled]="cargando()"
                    (click)="enviar(p.persona.email)">
                    Mandar solo a esta persona
                  </button>
                </div>
              </div>
              <details class="mt-2">
                <summary class="cursor-pointer text-xs text-ink-subtle">
                  Ver correo
                </summary>
                <div
                  class="prose prose-sm mt-2 max-w-none text-ink"
                  [innerHTML]="p.html"></div>
              </details>
            </li>
          }
        </ul>
      }
    </section>
  `
})
export class SemanaConfigComponent {
  private readonly ia = inject(IaService);

  readonly vista = signal<VistaSemana | undefined>(undefined);
  readonly cargando = signal(false);
  readonly mensaje = signal<string | undefined>(undefined);

  previsualizar(): void {
    this.cargando.set(true);
    this.mensaje.set(undefined);
    this.ia.semana(true).subscribe({
      next: (v) => {
        this.vista.set(v);
        this.cargando.set(false);
      },
      error: (e: unknown) => {
        this.mensaje.set(describirError(e));
        this.cargando.set(false);
      }
    });
  }

  enviar(solo?: string): void {
    if (
      !solo &&
      !confirm('¿Mandar el resumen semanal a todo el equipo ahora?')
    ) {
      return;
    }
    this.cargando.set(true);
    this.mensaje.set(undefined);
    this.ia.enviarSemana(solo).subscribe({
      next: (r) => {
        this.cargando.set(false);
        this.mensaje.set(
          `Enviado a ${r.enviados.length}: ${r.enviados.join(', ') || 'nadie'}.${r.errores.length ? ` Errores: ${r.errores.join('; ')}` : ''}`
        );
      },
      error: (e: unknown) => {
        this.mensaje.set(describirError(e));
        this.cargando.set(false);
      }
    });
  }
}
