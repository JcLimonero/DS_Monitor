import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Acuerdo, JuntaParaAcuerdos } from '../../core/ia/ia.models';
import { IaService, describirError } from '../../core/ia/ia.service';
import { Meeting, TASK_PRIORITY_LABEL } from '../../core/models';
import { PortalStore } from '../../core/state/portal.store';
import { IconComponent } from '../../ui/icon.component';
import { DayPipe } from '../../ui/portal.pipes';

/**
 * Acuerdos de una junta: la IA lee las notas del evento y propone pendientes
 * con responsable y fecha. Se marcan los que sí y entran a los pendientes
 * propios, asignados (con aviso por correo) a quien corresponda.
 */
@Component({
  selector: 'pt-ia-acuerdos',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, DayPipe],
  template: `
    @if (ia.disponible && ia.activa() !== false) {
      @if (!propuestas()) {
        <button
          type="button"
          class="btn"
          [disabled]="cargando()"
          (click)="pedir()">
          <pt-icon name="tareas" class="h-4 w-4" />
          {{ cargando() ? 'Leyendo notas…' : 'Acuerdos (IA)' }}
        </button>
      } @else {
        <div class="mt-2 rounded-lg border border-line bg-surface-muted p-3">
          @if (propuestas()!.length === 0) {
            <p class="text-sm text-ink-muted">
              {{
                sinNotas()
                  ? 'La junta no trae notas ni descripción; no hay de dónde sacar acuerdos.'
                  : 'La IA no encontró acuerdos accionables en las notas.'
              }}
            </p>
          } @else {
            <p
              class="text-xs font-bold uppercase tracking-wide text-ink-subtle">
              Acuerdos propuestos
            </p>
            <ul class="mt-2 space-y-2">
              @for (a of propuestas()!; track $index) {
                <li class="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    class="mt-1 h-4 w-4 rounded border-line text-brand"
                    [ngModel]="elegidos()[$index]"
                    (ngModelChange)="elegir($index, $event)"
                    name="acuerdo-{{ junta().id }}-{{ $index }}" />
                  <div class="min-w-0">
                    <p class="font-medium text-ink">{{ a.titulo }}</p>
                    <p class="text-xs text-ink-muted">
                      {{ priorityLabel[a.prioridad] }}
                      @if (a.persona) {
                        · {{ a.persona.name }}
                      } @else if (a.responsable) {
                        · {{ a.responsable }} (no está en el equipo)
                      }
                      @if (a.venceEn) {
                        · vence {{ a.venceEn | dia }}
                      }
                      @if (a.empresa) {
                        · {{ a.empresa }}
                      }
                    </p>
                    @if (a.descripcion) {
                      <p class="text-xs text-ink-muted">{{ a.descripcion }}</p>
                    }
                  </div>
                </li>
              }
            </ul>
            <div class="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                class="btn btn-primary"
                [disabled]="cargando() || !hayElegidos()"
                (click)="aceptar()">
                Agregar a pendientes
              </button>
              <button
                type="button"
                class="btn"
                (click)="propuestas.set(undefined)">
                Cerrar
              </button>
            </div>
          }
          @if (mensaje(); as m) {
            <p class="mt-2 text-xs text-ink-muted">{{ m }}</p>
          }
        </div>
      }
    }
  `
})
export class IaAcuerdosComponent {
  readonly ia = inject(IaService);
  private readonly store = inject(PortalStore);

  readonly junta = input.required<Meeting>();
  readonly priorityLabel = TASK_PRIORITY_LABEL;
  readonly propuestas = signal<Acuerdo[] | undefined>(undefined);
  readonly elegidos = signal<boolean[]>([]);
  readonly sinNotas = signal(false);
  readonly fuente = signal<string | undefined>(undefined);
  readonly urlNotas = signal<string | undefined>(undefined);
  readonly cargando = signal(false);
  readonly mensaje = signal<string | undefined>(undefined);

  hayElegidos(): boolean {
    return this.elegidos().some((x) => x);
  }

  elegir(i: number, valor: boolean): void {
    this.elegidos.update((lista) => lista.map((x, j) => (j === i ? valor : x)));
  }

  pedir(): void {
    const j = this.junta();
    const junta: JuntaParaAcuerdos = {
      id: j.id,
      title: j.title,
      start: j.start,
      end: j.end,
      organizer: j.organizer,
      attendees: j.attendees,
      notes: j.notes
    };
    this.cargando.set(true);
    this.mensaje.set(undefined);
    this.ia.acuerdos(junta).subscribe({
      next: (r) => {
        this.propuestas.set(r.acuerdos);
        this.elegidos.set(r.acuerdos.map(() => true));
        this.sinNotas.set(!r.notas);
        this.fuente.set(r.fuente);
        this.urlNotas.set(r.urlNotas);
        this.cargando.set(false);
      },
      error: (e: unknown) => {
        this.mensaje.set(describirError(e));
        this.propuestas.set([]);
        this.cargando.set(false);
      }
    });
  }

  aceptar(): void {
    const elegidos = (this.propuestas() ?? []).filter(
      (_, i) => this.elegidos()[i]
    );
    this.cargando.set(true);
    this.ia.aceptarAcuerdos(elegidos, this.junta().title).subscribe({
      next: (r) => {
        this.cargando.set(false);
        this.mensaje.set(
          `${r.agregados} agregados a Míos.${r.avisos.length ? ` ${r.avisos.join(' ')}` : ''}`
        );
        this.propuestas.set([]);
        this.store.refreshTasks();
      },
      error: (e: unknown) => {
        this.cargando.set(false);
        this.mensaje.set(describirError(e));
      }
    });
  }
}
