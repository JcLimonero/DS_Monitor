import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
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
  type CrmFuncionalidad,
  type CrmFuncionalidadEstado,
  type CrmFuncionalidadPrioridad,
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

const ESTADOS_KANBAN: CrmFuncionalidadEstado[] = [
  'por_hacer',
  'en_progreso',
  'en_revision',
  'bloqueado',
  'hecho'
];

const PRIORIDAD_CLASE: Record<CrmFuncionalidadPrioridad, string> = {
  baja: 'bg-surface-muted text-ink-muted',
  media: 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200',
  alta: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
  urgente: 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200'
};

function estadoVecino(
  actual: CrmFuncionalidadEstado,
  direccion: -1 | 1
): CrmFuncionalidadEstado | undefined {
  const i = ESTADOS_KANBAN.indexOf(actual);
  if (i < 0) return undefined;
  return ESTADOS_KANBAN[i + direccion];
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
    <pt-page-header
      title="Desarrollo"
      subtitle="Funcionalidades por estado. Arrastra o usa los botones.">
      @if (crm.puedeEditarDesarrollo()) {
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn btn-primary" (click)="abrirAlta()">
            <pt-icon name="mas" class="h-4 w-4" />
            Funcionalidad
          </button>
          <button
            type="button"
            class="btn"
            [disabled]="sinResponsable().length === 0"
            (click)="abrirLote()">
            Asignar en lote
            @if (sinResponsable().length > 0) {
              <span class="chip bg-amber-100 text-amber-900">{{
                sinResponsable().length
              }}</span>
            }
          </button>
        </div>
      }
    </pt-page-header>

    @if (crm.cargando()) {
      <p class="py-8 text-center text-ink-muted">Cargando…</p>
    } @else if (!crm.puedeVerDesarrollo()) {
      <pt-empty-state
        icon="usuario"
        title="Sin acceso"
        hint="No tienes permiso para ver desarrollo." />
    } @else if (error()) {
      <pt-empty-state icon="alerta" title="Error" [hint]="error()!" />
    } @else {
      <div class="mb-4 flex flex-wrap gap-3">
        <select
          class="field max-w-xs"
          [value]="filtroProyecto()"
          (change)="filtrarProyecto($event)">
          <option value="">Todos los proyectos</option>
          @for (p of proyectos(); track p.id) {
            <option [value]="p.id">{{ p.nombre }}</option>
          }
        </select>
        <select
          class="field max-w-xs"
          [value]="filtroResponsable()"
          (change)="filtrarResponsable($event)">
          <option value="">Todos los responsables</option>
          <option value="__nadie__">Sin responsable</option>
          @for (p of equipo(); track p.id) {
            <option [value]="p.id">{{ p.name }}</option>
          }
        </select>
      </div>

      @if (sinResponsable().length > 0) {
        <p class="banner banner-warn mb-4">
          <pt-icon name="alerta" class="h-4 w-4" />
          {{ sinResponsable().length }}
          {{
            sinResponsable().length === 1
              ? 'funcionalidad sin responsable'
              : 'funcionalidades sin responsable'
          }}.
        </p>
      }

      @if (filtroProyecto()) {
        <div class="mb-4 grid gap-3 sm:grid-cols-3">
          <div class="card card-pad">
            <p class="text-2xl font-semibold tabular-nums text-accent">
              {{ avanceProyecto() }}%
            </p>
            <p class="text-xs font-medium text-ink-muted">Avance</p>
          </div>
          <div class="card card-pad">
            <p class="text-2xl font-semibold tabular-nums text-ink">
              {{ totalFuncionalidades() }}
            </p>
            <p class="text-xs font-medium text-ink-muted">Funcionalidades</p>
          </div>
          <div class="card card-pad">
            <p class="text-2xl font-semibold tabular-nums text-ok">
              {{ funcionalidesHechas() }}
            </p>
            <p class="text-xs font-medium text-ink-muted">Completadas</p>
          </div>
        </div>
      }

      <div class="flex gap-3 overflow-x-auto pb-4">
        @for (col of columnas(); track col.estado) {
          <section
            class="flex w-[280px] shrink-0 flex-col rounded-xl bg-surface-muted"
            (dragover)="permitirSoltar($event)"
            (drop)="soltar(col.estado, $event)">
            <header
              class="flex items-center justify-between gap-2 border-b border-line px-3 py-3">
              <h2 class="text-sm font-semibold text-ink">{{ col.etiqueta }}</h2>
              <span class="chip bg-surface text-ink-muted">{{
                col.items.length
              }}</span>
            </header>
            <div class="flex min-h-[120px] flex-1 flex-col gap-2 p-2">
              @if (col.items.length === 0) {
                <p class="px-2 py-6 text-center text-xs text-ink-subtle">
                  Sin ítems
                </p>
              }
              @for (func of col.items; track func.id) {
                <article
                  class="card card-pad flex flex-col gap-2"
                  [class.ring-2]="
                    func.prioridad === 'alta' || func.prioridad === 'urgente'
                  "
                  [class.ring-amber-400]="func.prioridad === 'alta'"
                  [class.ring-rose-400]="func.prioridad === 'urgente'"
                  draggable="true"
                  (dragstart)="empezarArrastre(func, $event)">
                  <div class="flex items-start justify-between gap-2">
                    <span class="text-sm font-semibold text-ink">{{
                      func.titulo
                    }}</span>
                    <span
                      class="chip shrink-0"
                      [class]="prioridadClase[func.prioridad]">
                      {{ prioridadLabel[func.prioridad] }}
                    </span>
                  </div>
                  @if (func.descripcion) {
                    <p class="line-clamp-2 text-xs text-ink-muted">
                      {{ func.descripcion }}
                    </p>
                  }
                  <div class="flex flex-wrap gap-2 text-xs text-ink-muted">
                    @if (func.responsable) {
                      <span class="inline-flex items-center gap-1">
                        <pt-icon name="usuario" class="h-3 w-3" />
                        {{ func.responsable.name }}
                      </span>
                    } @else {
                      <span class="chip bg-amber-100 text-amber-900"
                        >Sin responsable</span
                      >
                    }
                    @if (func.fechaCompromiso) {
                      <span
                        class="inline-flex items-center gap-1"
                        [class.text-danger]="estaVencida(func.fechaCompromiso)">
                        <pt-icon name="agenda" class="h-3 w-3" />
                        {{ func.fechaCompromiso | relativo }}
                      </span>
                    }
                  </div>
                  @if (!filtroProyecto() && func.proyecto) {
                    <a
                      class="text-xs text-info hover:underline"
                      [routerLink]="['/proyectos', func.proyectoId]">
                      {{ func.proyecto.nombre }}
                    </a>
                  }
                  @if (func.enlace) {
                    <a
                      class="inline-flex items-center gap-1 text-xs text-info hover:underline"
                      [href]="func.enlace"
                      target="_blank"
                      rel="noopener">
                      <pt-icon name="externo" class="h-3 w-3" />
                      Ver
                    </a>
                  }
                  @if (crm.puedeEditarDesarrollo()) {
                    <div class="flex gap-2">
                      <button
                        type="button"
                        class="btn min-h-11 min-w-11 px-2"
                        [disabled]="!col.anterior || moviendo()"
                        [attr.aria-label]="
                          'Mover a ' + (col.anteriorLabel ?? '')
                        "
                        (click)="mover(func, col.anterior)">
                        <pt-icon name="anterior" class="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        class="btn min-h-11 min-w-11 px-2"
                        [disabled]="!col.siguiente || moviendo()"
                        [attr.aria-label]="
                          'Mover a ' + (col.siguienteLabel ?? '')
                        "
                        (click)="mover(func, col.siguiente)">
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
  `
})
export class DesarrolloComponent {
  readonly crm = inject(CrmService);
  private readonly admin = inject(PuenteAdminService);
  private readonly ruta = inject(ActivatedRoute);

  readonly estadoLabel = CRM_FUNCIONALIDAD_ESTADO_LABEL;
  readonly prioridadLabel = CRM_FUNCIONALIDAD_PRIORIDAD_LABEL;
  readonly prioridadClase = PRIORIDAD_CLASE;

  readonly filtroProyecto = signal(
    this.ruta.snapshot.queryParamMap.get('proyecto') ?? ''
  );
  readonly filtroResponsable = signal('');
  readonly error = signal<string | null>(null);
  readonly moviendo = signal(false);
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
    const funcionalidades = this.funcionalidadesFiltradas();

    return ESTADOS_KANBAN.map((estado) => {
      const anterior = estadoVecino(estado, -1);
      const siguiente = estadoVecino(estado, 1);
      return {
        estado,
        etiqueta: this.estadoLabel[estado],
        items: funcionalidades.filter((f) => f.estado === estado),
        anterior,
        siguiente,
        anteriorLabel: anterior ? this.estadoLabel[anterior] : undefined,
        siguienteLabel: siguiente ? this.estadoLabel[siguiente] : undefined
      };
    });
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

  readonly sinResponsable = computed(() =>
    this.funcionalidadesFiltradas().filter((f) => !f.responsableId)
  );

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

  empezarArrastre(func: CrmFuncionalidad, evento: DragEvent): void {
    evento.dataTransfer?.setData('text/plain', func.id);
    evento.dataTransfer?.setDragImage(
      (evento.currentTarget as HTMLElement) ?? new Image(),
      20,
      20
    );
  }

  permitirSoltar(evento: DragEvent): void {
    evento.preventDefault();
  }

  soltar(estado: CrmFuncionalidadEstado, evento: DragEvent): void {
    evento.preventDefault();
    const id = evento.dataTransfer?.getData('text/plain');
    if (!id) return;
    const func = this.funcionalidadesFiltradas().find((f) => f.id === id);
    if (!func) return;
    this.mover(func, estado);
  }

  mover(func: CrmFuncionalidad, estado?: CrmFuncionalidadEstado): void {
    if (!estado || func.estado === estado || this.moviendo()) return;
    if (!func.responsableId) {
      this.error.set('Asigna un responsable antes de mover la funcionalidad.');
      return;
    }
    this.moviendo.set(true);
    this.crm
      .guardarFuncionalidad({
        id: func.id,
        proyectoId: func.proyectoId,
        titulo: func.titulo,
        descripcion: func.descripcion,
        estado,
        prioridad: func.prioridad,
        responsableId: func.responsableId,
        fechaCompromiso: func.fechaCompromiso,
        enlace: func.enlace,
        pendienteId: func.pendienteId,
        orden: func.orden
      })
      .subscribe({
        next: () => {
          this.moviendo.set(false);
          this.recarga.next();
        },
        error: (err) => {
          this.moviendo.set(false);
          this.error.set(
            err.error?.error ?? err.message ?? 'No se pudo mover.'
          );
        }
      });
  }

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
