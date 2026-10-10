import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  catchError,
  combineLatest,
  map,
  of,
  startWith,
  Subject,
  switchMap
} from 'rxjs';
import {
  agruparPorEjecucion,
  calcularSemaforo,
  ESTADO_LABEL,
  ESTADOS_EJECUCION,
  estadoEjecucion,
  estadoVecino,
  filtrarProyectos
} from '../../core/crm/crm-tablero';
import { EmpresasService } from '../../core/empresas/empresas.service';
import {
  CRM_SEMAFORO_LABEL,
  type CrmCliente,
  type CrmHito,
  type CrmProyecto,
  type CrmProyectoEstado,
  type CrmSemaforoProyecto
} from '../../core/models/crm-nativo.model';
import type { Person } from '../../core/models';
import { CrmService } from '../../core/sources/gateway/crm.service';
import { PuenteAdminService } from '../../core/sources/gateway/puente-admin.service';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { IconComponent } from '../../ui/icon.component';
import { PageHeaderComponent } from '../../ui/page-header.component';

const SEMAFORO_CLASE: Record<CrmSemaforoProyecto, string> = {
  en_tiempo:
    'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200',
  en_riesgo:
    'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
  atrasado: 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200'
};

@Component({
  selector: 'pt-ejecucion',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    EmptyStateComponent,
    IconComponent,
    PageHeaderComponent
  ],
  template: `
    <pt-page-header
      title="Ejecución"
      subtitle="Proyectos ganados en desarrollo, pruebas, entrega y soporte." />

    @if (crm.cargando()) {
      <p class="py-8 text-center text-ink-muted">Cargando…</p>
    } @else if (!crm.puedeVerProyectos()) {
      <pt-empty-state
        icon="usuario"
        title="Sin acceso"
        hint="No tienes permiso para ver el tablero de ejecución." />
    } @else if (error()) {
      <pt-empty-state icon="alerta" title="Error" [hint]="error()!" />
    } @else {
      <div class="mb-4 flex flex-wrap gap-3">
        <select
          class="field max-w-xs"
          [value]="filtroEmpresa()"
          (change)="filtroEmpresa.set($any($event.target).value)">
          <option value="">Todas las empresas</option>
          @for (e of empresas(); track e.id) {
            <option [value]="e.id">{{ e.nombre }}</option>
          }
        </select>
        <select
          class="field max-w-xs"
          [value]="filtroCliente()"
          (change)="filtroCliente.set($any($event.target).value)">
          <option value="">Todos los clientes</option>
          @for (c of clientes(); track c.id) {
            <option [value]="c.id">{{ c.nombre }}</option>
          }
        </select>
        <select
          class="field max-w-xs"
          [value]="filtroResponsable()"
          (change)="filtroResponsable.set($any($event.target).value)">
          <option value="">Todos los responsables</option>
          <option value="__nadie__">Sin responsable</option>
          @for (p of equipo(); track p.id) {
            <option [value]="p.id">{{ p.name }}</option>
          }
        </select>
      </div>

      @if (tarjetas().length === 0) {
        <pt-empty-state
          icon="crm"
          title="Sin proyectos en ejecución"
          hint="Los proyectos ganados aparecen aquí." />
      } @else {
        <div class="flex gap-3 overflow-x-auto pb-4">
          @for (col of columnas(); track col.estado) {
            <section
              class="flex w-[280px] shrink-0 flex-col rounded-xl bg-surface-muted"
              (dragover)="$event.preventDefault()"
              (drop)="soltar(col.estado, $event)">
              <header
                class="flex items-center justify-between gap-2 border-b border-line px-3 py-3">
                <h2 class="text-sm font-semibold text-ink">
                  {{ col.etiqueta }}
                </h2>
                <span class="chip bg-surface text-ink-muted">{{
                  col.items.length
                }}</span>
              </header>
              <div class="flex min-h-[120px] flex-1 flex-col gap-2 p-2">
                @for (t of col.items; track t.proyecto.id) {
                  <article
                    class="card card-pad flex flex-col gap-2"
                    draggable="true"
                    (dragstart)="empezarArrastre(t.proyecto, $event)">
                    <a
                      class="text-sm font-semibold text-ink hover:underline"
                      [routerLink]="['/proyectos', t.proyecto.id]">
                      {{ t.proyecto.nombre }}
                    </a>
                    <p class="text-xs text-ink-muted">
                      {{ t.cliente?.nombre ?? 'Sin cliente' }}
                    </p>
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="chip" [class]="semaforoClase[t.semaforo]">
                        {{ semaforoLabel[t.semaforo] }}
                      </span>
                      <span class="text-xs tabular-nums text-ink-muted">
                        {{ t.proyecto.avancePct ?? 0 }}%
                      </span>
                    </div>
                    @if (crm.puedeEditarProyectos()) {
                      <div class="flex gap-2">
                        <button
                          type="button"
                          class="btn min-h-11 min-w-11 px-2"
                          [disabled]="!col.anterior || moviendo()"
                          [attr.aria-label]="
                            'Mover a ' + (col.anteriorLabel ?? '')
                          "
                          (click)="mover(t.proyecto, col.anterior)">
                          <pt-icon name="anterior" class="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          class="btn min-h-11 min-w-11 px-2"
                          [disabled]="!col.siguiente || moviendo()"
                          [attr.aria-label]="
                            'Mover a ' + (col.siguienteLabel ?? '')
                          "
                          (click)="mover(t.proyecto, col.siguiente)">
                          <pt-icon name="siguiente" class="h-4 w-4" />
                        </button>
                      </div>
                    }
                  </article>
                }
              </div>
            </section>
          }
        </div>
      }
    }
  `
})
export class EjecucionComponent {
  readonly crm = inject(CrmService);
  private readonly empresasSvc = inject(EmpresasService);
  private readonly admin = inject(PuenteAdminService);

  readonly semaforoLabel = CRM_SEMAFORO_LABEL;
  readonly semaforoClase = SEMAFORO_CLASE;
  readonly filtroEmpresa = signal('');
  readonly filtroCliente = signal('');
  readonly filtroResponsable = signal('');
  readonly error = signal<string | null>(null);
  readonly moviendo = signal(false);
  private readonly recarga = new Subject<void>();

  readonly empresas = computed(() => this.empresasSvc.lista());

  readonly equipo = toSignal(
    this.admin.disponible
      ? this.admin.equipo().pipe(catchError(() => of([] as Person[])))
      : of([] as Person[]),
    { initialValue: [] as Person[] }
  );

  private readonly datos = toSignal(
    this.recarga.pipe(
      startWith(undefined),
      switchMap(() =>
        combineLatest([
          this.crm.obtenerProyectos(),
          this.crm.obtenerClientes().pipe(catchError(() => of([]))),
          this.crm.obtenerHitos().pipe(catchError(() => of([])))
        ]).pipe(
          map(([proyectos, clientes, hitos]) => ({
            proyectos,
            clientes,
            hitos
          })),
          catchError((err) => {
            this.error.set(err.message || 'Error al cargar ejecución.');
            return of({
              proyectos: [] as CrmProyecto[],
              clientes: [] as CrmCliente[],
              hitos: [] as CrmHito[]
            });
          })
        )
      )
    ),
    {
      initialValue: {
        proyectos: [] as CrmProyecto[],
        clientes: [] as CrmCliente[],
        hitos: [] as CrmHito[]
      }
    }
  );

  readonly clientes = computed(() => this.datos().clientes);

  readonly tarjetas = computed(() => {
    const d = this.datos();
    const filtrados = filtrarProyectos(d.proyectos, {
      empresaId: this.filtroEmpresa() || undefined,
      clienteId: this.filtroCliente() || undefined,
      responsableId: this.filtroResponsable() || undefined
    }).filter((p) => estadoEjecucion(p));
    return filtrados.map((proyecto) => ({
      proyecto,
      cliente: d.clientes.find((c) => c.id === proyecto.clienteId),
      semaforo: calcularSemaforo(proyecto, d.hitos)
    }));
  });

  readonly columnas = computed(() => {
    void agruparPorEjecucion(this.tarjetas().map((t) => t.proyecto));
    return ESTADOS_EJECUCION.map((estado) => {
      const items = this.tarjetas().filter(
        (t) => estadoEjecucion(t.proyecto) === estado
      );
      const anterior = estadoVecino(estado, -1);
      const siguiente = estadoVecino(estado, 1);
      return {
        estado,
        etiqueta: ESTADO_LABEL[estado],
        items,
        anterior,
        siguiente,
        anteriorLabel: anterior ? ESTADO_LABEL[anterior] : undefined,
        siguienteLabel: siguiente ? ESTADO_LABEL[siguiente] : undefined
      };
    });
  });

  empezarArrastre(proyecto: CrmProyecto, evento: DragEvent): void {
    evento.dataTransfer?.setData('text/plain', proyecto.id);
  }

  soltar(estado: CrmProyectoEstado, evento: DragEvent): void {
    evento.preventDefault();
    const id = evento.dataTransfer?.getData('text/plain');
    const proyecto = this.tarjetas().find(
      (t) => t.proyecto.id === id
    )?.proyecto;
    if (!proyecto) return;
    this.mover(proyecto, estado);
  }

  mover(proyecto: CrmProyecto, estado?: CrmProyectoEstado): void {
    if (!estado || estadoEjecucion(proyecto) === estado || this.moviendo()) {
      return;
    }
    this.moviendo.set(true);
    this.crm.moverEstadoEjecucion(proyecto.id, estado).subscribe({
      next: () => {
        this.moviendo.set(false);
        this.recarga.next();
      },
      error: (err) => {
        this.moviendo.set(false);
        this.error.set(err.error?.error ?? err.message ?? 'No se pudo mover.');
      }
    });
  }
}
