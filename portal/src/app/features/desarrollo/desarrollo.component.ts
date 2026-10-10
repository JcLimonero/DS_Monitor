import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
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
  CRM_FUNCIONALIDAD_ESTADO_LABEL,
  CRM_FUNCIONALIDAD_PRIORIDAD_LABEL,
  CrmFuncionalidadEstado,
  type CrmFuncionalidad,
  type CrmProyecto
} from '../../core/models/crm-nativo.model';
import type { Person } from '../../core/models';
import { CrmService } from '../../core/sources/gateway/crm.service';
import { PuenteAdminService } from '../../core/sources/gateway/puente-admin.service';
import { DialogoComponent } from '../../ui/dialogo.component';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { IconComponent } from '../../ui/icon.component';
import { PageHeaderComponent } from '../../ui/page-header.component';
import { RelativePipe } from '../../ui/portal.pipes';

interface FuncionalidadConContexto extends CrmFuncionalidad {
  proyecto?: CrmProyecto;
  responsable?: Person;
}

interface ColumnaKanban {
  estado: CrmFuncionalidadEstado;
  etiqueta: string;
  items: FuncionalidadConContexto[];
}

@Component({
  selector: 'pt-desarrollo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    FormsModule,
    DialogoComponent,
    EmptyStateComponent,
    IconComponent,
    PageHeaderComponent,
    RelativePipe
  ],
  template: `
    <pt-page-header title="Desarrollo" />

    @if (crm.cargando()) {
      <div class="loading-message">Cargando...</div>
    } @else if (!crm.puedeVerDesarrollo()) {
      <pt-empty-state
        icon="usuario"
        title="Sin acceso"
        hint="No tienes permiso para ver desarrollo." />
    } @else if (error()) {
      <pt-empty-state icon="alerta" title="Error" [hint]="error()!" />
    } @else {
      <!-- Filtros -->
      <div class="filtros">
        <select
          class="field"
          [value]="filtroProyecto()"
          (change)="filtrarProyecto($event)">
          <option value="">Todos los proyectos</option>
          @for (p of proyectos(); track p.id) {
            <option [value]="p.id">{{ p.nombre }}</option>
          }
        </select>
        <select
          class="field"
          [value]="filtroResponsable()"
          (change)="filtrarResponsable($event)">
          <option value="">Todos los responsables</option>
          <option value="__nadie__">Sin responsable</option>
          @for (p of equipo(); track p.id) {
            <option [value]="p.id">{{ p.name }}</option>
          }
        </select>
        @if (crm.puedeEditarDesarrollo()) {
          <button type="button" class="btn" (click)="abrirAlta()">
            <pt-icon name="mas" class="h-4 w-4" />
            Funcionalidad
          </button>
          <button
            type="button"
            class="btn"
            [disabled]="sinResponsable().length === 0"
            (click)="abrirLote()">
            Asignar en lote
          </button>
        }
      </div>

      <!-- Resumen de avance -->
      @if (filtroProyecto()) {
        <div class="resumen">
          <div class="resumen-item">
            <span class="resumen-valor">{{ avanceProyecto() }}%</span>
            <span class="resumen-label">Avance</span>
          </div>
          <div class="resumen-item">
            <span class="resumen-valor">{{ totalFuncionalidades() }}</span>
            <span class="resumen-label">Funcionalidades</span>
          </div>
          <div class="resumen-item">
            <span class="resumen-valor">{{ funcionalidesHechas() }}</span>
            <span class="resumen-label">Completadas</span>
          </div>
        </div>
      }

      <!-- Tablero Kanban -->
      @if (columnas().length === 0) {
        <pt-empty-state
          icon="tareas"
          title="Sin funcionalidades"
          [hint]="
            filtroProyecto() || filtroResponsable()
              ? 'No hay funcionalidades que coincidan con los filtros.'
              : 'Aún no hay funcionalidades registradas.'
          " />
      } @else {
        <div class="kanban">
          @for (col of columnas(); track col.estado) {
            <div class="kanban-columna">
              <div class="kanban-header">
                <span class="kanban-titulo">{{ col.etiqueta }}</span>
                <span class="kanban-count">{{ col.items.length }}</span>
              </div>
              <div class="kanban-items">
                @for (func of col.items; track func.id) {
                  <div
                    class="kanban-card"
                    [class.prioridad-alta]="
                      func.prioridad === 'alta' || func.prioridad === 'urgente'
                    ">
                    <div class="func-header">
                      <span class="func-titulo">{{ func.titulo }}</span>
                      <span class="chip chip--{{ func.prioridad }}">
                        {{ prioridadLabel[func.prioridad] }}
                      </span>
                    </div>
                    @if (func.descripcion) {
                      <p class="func-desc">{{ func.descripcion }}</p>
                    }
                    <div class="func-meta">
                      @if (func.responsable) {
                        <span class="func-responsable">
                          <pt-icon name="usuario" class="h-3 w-3" />
                          {{ func.responsable.name }}
                        </span>
                      }
                      @if (func.fechaCompromiso) {
                        <span
                          class="func-fecha"
                          [class.vencida]="estaVencida(func.fechaCompromiso)">
                          <pt-icon name="agenda" class="h-3 w-3" />
                          {{ func.fechaCompromiso | relativo }}
                        </span>
                      }
                    </div>
                    @if (!filtroProyecto() && func.proyecto) {
                      <a
                        class="func-proyecto"
                        [routerLink]="['/proyectos', func.proyectoId]">
                        {{ func.proyecto.nombre }}
                      </a>
                    }
                    @if (func.enlace) {
                      <a
                        class="func-enlace"
                        [href]="func.enlace"
                        target="_blank">
                        <pt-icon name="externo" class="h-3 w-3" />
                        Ver
                      </a>
                    }
                  </div>
                }
              </div>
            </div>
          }
        </div>
      }

      @if (dialogo() === 'alta') {
        <pt-dialogo titulo="Nueva funcionalidad" (cerrar)="dialogo.set(null)">
          <form class="grid gap-3" (ngSubmit)="guardarAlta()">
            <label>
              <span class="mb-1 block text-xs font-medium text-ink-muted"
                >Proyecto</span
              >
              <select class="field" [(ngModel)]="altaProyecto" name="proy">
                <option value="">Elige un proyecto</option>
                @for (p of proyectos(); track p.id) {
                  <option [value]="p.id">{{ p.nombre }}</option>
                }
              </select>
            </label>
            <label>
              <span class="mb-1 block text-xs font-medium text-ink-muted"
                >Título</span
              >
              <input class="field" [(ngModel)]="altaTitulo" name="titulo" />
            </label>
            <label>
              <span class="mb-1 block text-xs font-medium text-ink-muted"
                >Responsable</span
              >
              <select class="field" [(ngModel)]="altaResponsable" name="resp">
                <option value="">Elige a alguien</option>
                @for (p of equipo(); track p.id) {
                  <option [value]="p.id">{{ p.name }}</option>
                }
              </select>
            </label>
          </form>
          <div class="dialogo-pie flex gap-2">
            <button
              type="button"
              class="btn btn-primary"
              [disabled]="
                !altaTitulo.trim() || !altaProyecto || !altaResponsable
              "
              (click)="guardarAlta()">
              Guardar
            </button>
            <button type="button" class="btn" (click)="dialogo.set(null)">
              Cancelar
            </button>
          </div>
        </pt-dialogo>
      }

      @if (dialogo() === 'lote') {
        <pt-dialogo titulo="Asignar en lote" (cerrar)="dialogo.set(null)">
          <p class="mb-3 text-sm text-ink-muted">
            {{ sinResponsable().length }} sin responsable. Elige a quién se las
            asignas.
          </p>
          <label>
            <span class="mb-1 block text-xs font-medium text-ink-muted"
              >Responsable</span
            >
            <select class="field" [(ngModel)]="loteResponsable" name="lote">
              <option value="">Elige a alguien</option>
              @for (p of equipo(); track p.id) {
                <option [value]="p.id">{{ p.name }}</option>
              }
            </select>
          </label>
          <div class="dialogo-pie flex gap-2">
            <button
              type="button"
              class="btn btn-primary"
              [disabled]="!loteResponsable"
              (click)="guardarLote()">
              Asignar
            </button>
            <button type="button" class="btn" (click)="dialogo.set(null)">
              Cancelar
            </button>
          </div>
        </pt-dialogo>
      }
    }
  `,
  styles: `
    :host {
      display: block;
      padding: var(--space-4);
    }

    .loading-message {
      text-align: center;
      color: var(--text-secondary);
      padding: var(--space-8);
    }

    .filtros {
      display: flex;
      gap: var(--space-3);
      margin-bottom: var(--space-4);
      flex-wrap: wrap;
    }

    .filtros select {
      min-width: 200px;
    }

    .resumen {
      display: flex;
      gap: var(--space-4);
      margin-bottom: var(--space-4);
      padding: var(--space-3);
      background: var(--surface-secondary);
      border-radius: var(--radius);
    }

    .resumen-item {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
    }

    .resumen-valor {
      font-size: 1.5rem;
      font-weight: 600;
      color: var(--accent);
    }

    .resumen-label {
      font-size: 0.75rem;
      color: var(--text-secondary);
      text-transform: uppercase;
    }

    .kanban {
      display: flex;
      gap: var(--space-3);
      overflow-x: auto;
      padding-bottom: var(--space-4);
    }

    .kanban-columna {
      flex: 0 0 280px;
      min-width: 280px;
      background: var(--surface-secondary);
      border-radius: var(--radius);
      display: flex;
      flex-direction: column;
      max-height: calc(100vh - 250px);
    }

    .kanban-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--space-3);
      border-bottom: 1px solid var(--border);
    }

    .kanban-titulo {
      font-weight: 600;
      font-size: 0.875rem;
    }

    .kanban-count {
      background: var(--surface-primary);
      color: var(--text-secondary);
      font-size: 0.75rem;
      font-weight: 500;
      padding: 2px 8px;
      border-radius: 10px;
    }

    .kanban-items {
      flex: 1;
      overflow-y: auto;
      padding: var(--space-2);
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }

    .kanban-card {
      background: var(--surface-primary);
      border-radius: var(--radius);
      padding: var(--space-3);
      box-shadow: var(--shadow-sm);
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }

    .kanban-card.prioridad-alta {
      border-left: 3px solid var(--accent-orange);
    }

    .func-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: var(--space-2);
    }

    .func-titulo {
      font-weight: 500;
      font-size: 0.875rem;
      line-height: 1.3;
    }

    .func-desc {
      font-size: 0.75rem;
      color: var(--text-secondary);
      margin: 0;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .func-meta {
      display: flex;
      gap: var(--space-3);
      font-size: 0.75rem;
      color: var(--text-secondary);
    }

    .func-responsable,
    .func-fecha {
      display: flex;
      align-items: center;
      gap: var(--space-1);
    }

    .func-fecha.vencida {
      color: var(--accent-red);
    }

    .func-proyecto {
      font-size: 0.75rem;
      color: var(--accent);
      text-decoration: none;
    }

    .func-proyecto:hover {
      text-decoration: underline;
    }

    .func-enlace {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      font-size: 0.75rem;
      color: var(--accent);
      text-decoration: none;
    }

    .chip--baja {
      --chip-bg: var(--surface-secondary);
      --chip-text: var(--text-secondary);
    }
    .chip--media {
      --chip-bg: var(--accent-blue-bg);
      --chip-text: var(--accent-blue);
    }
    .chip--alta {
      --chip-bg: var(--accent-orange-bg);
      --chip-text: var(--accent-orange);
    }
    .chip--urgente {
      --chip-bg: var(--accent-red-bg);
      --chip-text: var(--accent-red);
    }
  `
})
export class DesarrolloComponent {
  readonly crm = inject(CrmService);
  private readonly admin = inject(PuenteAdminService);

  readonly estadoLabel = CRM_FUNCIONALIDAD_ESTADO_LABEL;
  readonly prioridadLabel = CRM_FUNCIONALIDAD_PRIORIDAD_LABEL;

  readonly filtroProyecto = signal('');
  readonly filtroResponsable = signal('');
  readonly error = signal<string | null>(null);
  readonly dialogo = signal<'alta' | 'lote' | null>(null);
  altaTitulo = '';
  altaProyecto = '';
  altaResponsable = '';
  loteResponsable = '';
  private readonly recarga = new Subject<void>();

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
          this.crm.obtenerFuncionalidades(),
          this.crm.obtenerProyectos()
        ]).pipe(
          map(([funcionalidades, proyectos]) => ({
            funcionalidades,
            proyectos
          })),
          catchError((err) => {
            this.error.set(err.message || 'Error al cargar funcionalidades');
            return of({ funcionalidades: [], proyectos: [] });
          })
        )
      )
    ),
    { initialValue: { funcionalidades: [], proyectos: [] } }
  );

  readonly proyectos = computed(() => this.datos().proyectos);

  readonly funcionalidadesConContexto = computed(() => {
    const { funcionalidades, proyectos } = this.datos();
    const equipo = this.equipo();

    return funcionalidades.map((f) => ({
      ...f,
      proyecto: proyectos.find((p) => p.id === f.proyectoId),
      responsable: f.responsableId
        ? equipo.find((p) => p.id === f.responsableId)
        : undefined
    }));
  });

  readonly funcionalidadesFiltradas = computed(() => {
    let resultado = this.funcionalidadesConContexto();
    const proyectoId = this.filtroProyecto();
    const responsableId = this.filtroResponsable();

    if (proyectoId) {
      resultado = resultado.filter((f) => f.proyectoId === proyectoId);
    }

    if (responsableId === '__nadie__') {
      resultado = resultado.filter((f) => !f.responsableId);
    } else if (responsableId) {
      resultado = resultado.filter((f) => f.responsableId === responsableId);
    }

    return resultado;
  });

  readonly columnas = computed(() => {
    const estados: CrmFuncionalidadEstado[] = [
      'por_hacer',
      'en_progreso',
      'en_revision',
      'bloqueado',
      'hecho'
    ];

    const funcionalidades = this.funcionalidadesFiltradas();

    return estados
      .map((estado) => ({
        estado,
        etiqueta: this.estadoLabel[estado],
        items: funcionalidades.filter((f) => f.estado === estado)
      }))
      .filter((col) => col.items.length > 0 || col.estado !== 'bloqueado');
  });

  readonly totalFuncionalidades = computed(
    () => this.funcionalidadesFiltradas().length
  );

  readonly funcionalidesHechas = computed(
    () =>
      this.funcionalidadesFiltradas().filter((f) => f.estado === 'hecho').length
  );

  readonly avanceProyecto = computed(() => {
    const total = this.totalFuncionalidades();
    if (total === 0) return 0;
    return Math.round((this.funcionalidesHechas() / total) * 100);
  });

  filtrarProyecto(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.filtroProyecto.set(select.value);
  }

  filtrarResponsable(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.filtroResponsable.set(select.value);
  }

  estaVencida(fecha: string): boolean {
    return new Date(fecha) < new Date();
  }

  readonly sinResponsable = computed(() =>
    this.funcionalidadesFiltradas().filter((f) => !f.responsableId)
  );

  abrirAlta(): void {
    this.altaTitulo = '';
    this.altaProyecto = this.filtroProyecto();
    this.altaResponsable = '';
    this.dialogo.set('alta');
  }

  abrirLote(): void {
    this.loteResponsable = '';
    this.dialogo.set('lote');
  }

  guardarAlta(): void {
    if (
      !this.altaTitulo.trim() ||
      !this.altaProyecto ||
      !this.altaResponsable
    ) {
      return;
    }
    this.crm
      .guardarFuncionalidad({
        proyectoId: this.altaProyecto,
        titulo: this.altaTitulo.trim(),
        estado: 'por_hacer',
        prioridad: 'media',
        responsableId: this.altaResponsable
      })
      .subscribe({
        next: () => {
          this.dialogo.set(null);
          this.recarga.next();
        },
        error: (err) =>
          this.error.set(
            err.error?.error ?? err.message ?? 'No se pudo guardar.'
          )
      });
  }

  guardarLote(): void {
    if (!this.loteResponsable) return;
    this.crm
      .asignarResponsableLote({
        responsableId: this.loteResponsable,
        funcionalidades: this.sinResponsable().map((f) => f.id)
      })
      .subscribe({
        next: () => {
          this.dialogo.set(null);
          this.recarga.next();
        },
        error: (err) =>
          this.error.set(
            err.error?.error ?? err.message ?? 'No se pudo asignar.'
          )
      });
  }
}
