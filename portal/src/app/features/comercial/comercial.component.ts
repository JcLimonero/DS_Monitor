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
  agruparPorEtapa,
  ALERTAS_ESTANCADOS_OMISION,
  diasEnEtapa,
  ETAPA_LABEL,
  ETAPAS_KANBAN,
  etapaEfectiva,
  etapaVecina,
  filtrarProyectos,
  montoVigenteDe,
  proyectoEstancado,
  proximoPasoDe
} from '../../core/crm/crm-tablero';
import { EmpresasService } from '../../core/empresas/empresas.service';
import type {
  CrmActividadCliente,
  CrmCliente,
  CrmCotizacion,
  CrmEtapaComercial,
  CrmProyecto
} from '../../core/models/crm-nativo.model';
import type { Person } from '../../core/models';
import { CrmService } from '../../core/sources/gateway/crm.service';
import { PuenteAdminService } from '../../core/sources/gateway/puente-admin.service';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { IconComponent } from '../../ui/icon.component';
import { PageHeaderComponent } from '../../ui/page-header.component';
import { MoneyPipe } from '../../ui/portal.pipes';

interface TarjetaLead {
  proyecto: CrmProyecto;
  cliente?: CrmCliente;
  clienteFinal?: CrmCliente;
  empresa?: string;
  monto: { total: number | null; moneda?: string };
  dias: number;
  estancado: boolean;
  proximoPaso?: string;
  responsable?: string;
}

@Component({
  selector: 'pt-comercial',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    EmptyStateComponent,
    IconComponent,
    PageHeaderComponent,
    MoneyPipe
  ],
  template: `
    <pt-page-header
      title="Comercial"
      subtitle="Proyectos como leads. Arrastra o usa los botones." />

    @if (crm.cargando()) {
      <p class="py-8 text-center text-ink-muted">Cargando…</p>
    } @else if (!crm.puedeVerProyectos()) {
      <pt-empty-state
        icon="usuario"
        title="Sin acceso"
        hint="No tienes permiso para ver el kanban comercial." />
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

      @if (estancados() > 0) {
        <p class="banner banner-warn mb-4">
          <pt-icon name="alerta" class="h-4 w-4" />
          {{ estancados() }}
          {{ estancados() === 1 ? 'lead estancado' : 'leads estancados' }}
          sin movimiento.
        </p>
      }

      <div class="flex gap-3 overflow-x-auto pb-4">
        @for (col of columnas(); track col.etapa) {
          <section
            class="flex w-[280px] shrink-0 flex-col rounded-xl bg-surface-muted"
            (dragover)="permitirSoltar($event)"
            (drop)="soltar(col.etapa, $event)">
            <header
              class="flex items-center justify-between gap-2 border-b border-line px-3 py-3">
              <h2 class="text-sm font-semibold text-ink">{{ col.etiqueta }}</h2>
              <span class="chip bg-surface text-ink-muted">{{
                col.items.length
              }}</span>
            </header>
            <div class="flex min-h-[120px] flex-1 flex-col gap-2 p-2">
              @for (t of col.items; track t.proyecto.id) {
                <article
                  class="card card-pad flex flex-col gap-2"
                  [class.ring-2]="t.estancado"
                  [class.ring-amber-400]="t.estancado"
                  draggable="true"
                  (dragstart)="empezarArrastre(t.proyecto, $event)">
                  <div class="flex items-start justify-between gap-2">
                    <a
                      class="text-sm font-semibold text-ink hover:underline"
                      [routerLink]="['/proyectos', t.proyecto.id]">
                      {{ t.proyecto.nombre }}
                    </a>
                    @if (t.estancado) {
                      <span class="chip bg-amber-100 text-amber-900"
                        >Estancado</span
                      >
                    }
                  </div>
                  <p class="text-xs text-ink-muted">
                    {{ t.cliente?.nombre ?? 'Sin cliente' }}
                    @if (t.clienteFinal) {
                      <span> → {{ t.clienteFinal.nombre }}</span>
                    }
                  </p>
                  @if (t.empresa) {
                    <p class="text-xs text-ink-subtle">{{ t.empresa }}</p>
                  }
                  <p class="text-sm font-semibold tabular-nums">
                    {{ t.monto.total | moneda: t.monto.moneda }}
                  </p>
                  <p class="text-xs text-ink-muted">
                    {{ t.dias }}
                    {{ t.dias === 1 ? 'día' : 'días' }} en etapa
                    @if (t.proximoPaso) {
                      <span> · {{ t.proximoPaso }}</span>
                    }
                  </p>
                  @if (t.responsable) {
                    <p class="flex items-center gap-1 text-xs text-ink-muted">
                      <pt-icon name="usuario" class="h-3 w-3" />
                      {{ t.responsable }}
                    </p>
                  }
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
  `
})
export class ComercialComponent {
  readonly crm = inject(CrmService);
  private readonly empresasSvc = inject(EmpresasService);
  private readonly admin = inject(PuenteAdminService);

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
          this.crm.obtenerCotizaciones().pipe(catchError(() => of([]))),
          this.crm.obtenerActividades().pipe(catchError(() => of([]))),
          this.crm.obtenerHitos().pipe(catchError(() => of([]))),
          this.crm
            .obtenerAlertasEstancados()
            .pipe(catchError(() => of(ALERTAS_ESTANCADOS_OMISION)))
        ]).pipe(
          map(
            ([
              proyectos,
              clientes,
              cotizaciones,
              actividades,
              hitos,
              alertas
            ]) => ({
              proyectos,
              clientes,
              cotizaciones,
              actividades,
              hitos,
              alertas
            })
          ),
          catchError((err) => {
            this.error.set(err.message || 'Error al cargar el kanban.');
            return of({
              proyectos: [] as CrmProyecto[],
              clientes: [] as CrmCliente[],
              cotizaciones: [] as CrmCotizacion[],
              actividades: [] as CrmActividadCliente[],
              hitos: [],
              alertas: ALERTAS_ESTANCADOS_OMISION
            });
          })
        )
      )
    ),
    {
      initialValue: {
        proyectos: [] as CrmProyecto[],
        clientes: [] as CrmCliente[],
        cotizaciones: [] as CrmCotizacion[],
        actividades: [] as CrmActividadCliente[],
        hitos: [],
        alertas: ALERTAS_ESTANCADOS_OMISION
      }
    }
  );

  readonly clientes = computed(() => this.datos().clientes);

  readonly tarjetas = computed(() => {
    const d = this.datos();
    const empresas = this.empresas();
    const equipo = this.equipo();
    const filtrados = filtrarProyectos(d.proyectos, {
      empresaId: this.filtroEmpresa() || undefined,
      clienteId: this.filtroCliente() || undefined,
      responsableId: this.filtroResponsable() || undefined
    });
    return filtrados.map((proyecto) => {
      const cliente = d.clientes.find((c) => c.id === proyecto.clienteId);
      const clienteFinal = proyecto.clienteFinalId
        ? d.clientes.find((c) => c.id === proyecto.clienteFinalId)
        : undefined;
      const cots = d.cotizaciones.filter((c) => c.proyectoId === proyecto.id);
      const acts = d.actividades.filter((a) => a.proyectoId === proyecto.id);
      const hitos = d.hitos.filter((h) => h.proyectoId === proyecto.id);
      const responsable =
        proyecto.responsableInterno?.name ??
        equipo.find((p) => p.id === proyecto.responsableComercialId)?.name;
      return {
        proyecto,
        cliente,
        clienteFinal,
        empresa: empresas.find((e) => e.id === proyecto.empresaAtiendeId)
          ?.nombre,
        monto: montoVigenteDe(cots),
        dias: diasEnEtapa(proyecto),
        estancado: proyectoEstancado(proyecto, d.alertas),
        proximoPaso: proximoPasoDe(acts, hitos),
        responsable
      } satisfies TarjetaLead;
    });
  });

  readonly estancados = computed(
    () => this.tarjetas().filter((t) => t.estancado).length
  );

  readonly columnas = computed(() => {
    const grupos = agruparPorEtapa(this.tarjetas().map((t) => t.proyecto));
    return ETAPAS_KANBAN.map((etapa) => {
      const items = this.tarjetas().filter(
        (t) => etapaEfectiva(t.proyecto) === etapa
      );
      const anterior = etapaVecina(etapa, -1);
      const siguiente = etapaVecina(etapa, 1);
      return {
        etapa,
        etiqueta: ETAPA_LABEL[etapa],
        items,
        anterior,
        siguiente,
        anteriorLabel: anterior ? ETAPA_LABEL[anterior] : undefined,
        siguienteLabel: siguiente ? ETAPA_LABEL[siguiente] : undefined,
        vacia: grupos[etapa].length === 0
      };
    });
  });

  empezarArrastre(proyecto: CrmProyecto, evento: DragEvent): void {
    evento.dataTransfer?.setData('text/plain', proyecto.id);
    evento.dataTransfer?.setDragImage(
      (evento.currentTarget as HTMLElement) ?? new Image(),
      20,
      20
    );
  }

  permitirSoltar(evento: DragEvent): void {
    evento.preventDefault();
  }

  soltar(etapa: CrmEtapaComercial, evento: DragEvent): void {
    evento.preventDefault();
    const id = evento.dataTransfer?.getData('text/plain');
    if (!id) return;
    const proyecto = this.tarjetas().find(
      (t) => t.proyecto.id === id
    )?.proyecto;
    if (!proyecto) return;
    this.mover(proyecto, etapa);
  }

  mover(proyecto: CrmProyecto, etapa?: CrmEtapaComercial): void {
    if (!etapa || etapaEfectiva(proyecto) === etapa || this.moviendo()) {
      return;
    }
    this.moviendo.set(true);
    this.crm.moverEtapa(proyecto.id, etapa).subscribe({
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
