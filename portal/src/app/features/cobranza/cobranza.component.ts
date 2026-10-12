import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, combineLatest, map, of } from 'rxjs';
import {
  CRM_PAGO_ESTATUS_LABEL,
  type CrmCliente,
  type CrmCotizacion,
  type CrmFactura,
  type CrmOrdenCompra,
  type CrmPagoEstatus,
  type CrmPagoProgramado,
  type CrmPartida,
  type CrmProyecto
} from '../../core/models/crm-nativo.model';
import { CrmService } from '../../core/sources/gateway/crm.service';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { PageHeaderComponent } from '../../ui/page-header.component';
import { DayPipe, MoneyPipe, RelativePipe } from '../../ui/portal.pipes';

interface PagoConContexto extends CrmPagoProgramado {
  cotizacion?: CrmCotizacion;
  proyecto?: CrmProyecto;
  cliente?: CrmCliente;
}

const ESTATUS_CLASE: Record<CrmPagoEstatus, string> = {
  por_facturar: 'bg-surface-muted text-ink-muted',
  facturado: 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200',
  pagado:
    'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200',
  vencido: 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200',
  por_confirmar: 'bg-surface-muted text-ink-muted'
};

type VistaCobranza = 'pagos' | 'oc' | 'facturas' | 'margen';

@Component({
  selector: 'pt-cobranza',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    EmptyStateComponent,
    PageHeaderComponent,
    DayPipe,
    MoneyPipe,
    RelativePipe
  ],
  template: `
    <pt-page-header
      title="Cobranza"
      subtitle="Pagos, órdenes de compra, facturas y margen." />

    @if (crm.cargando()) {
      <p class="py-8 text-center text-ink-muted">Cargando…</p>
    } @else if (!crm.puedeVerCobranza()) {
      <pt-empty-state
        icon="usuario"
        title="Sin acceso"
        hint="No tienes permiso para ver cobranza." />
    } @else if (error()) {
      <pt-empty-state icon="alerta" title="Error" [hint]="error()!" />
    } @else {
      <div class="mb-4 grid gap-3 sm:grid-cols-3">
        <button
          type="button"
          class="card card-pad text-left transition hover:border-brand/40"
          [class.ring-2]="filtroEstatus() === 'pagado'"
          [class.ring-ok]="filtroEstatus() === 'pagado'"
          (click)="aplicarFiltroEstatus('pagado')">
          <p class="text-2xl font-semibold tabular-nums text-ok">
            {{ totalPagado() | moneda }}
          </p>
          <p class="text-xs font-medium text-ink-muted">Pagado</p>
        </button>
        <button
          type="button"
          class="card card-pad text-left transition hover:border-brand/40"
          [class.ring-2]="
            filtroEstatus() === 'por_facturar' ||
            filtroEstatus() === 'facturado'
          "
          [class.ring-warn]="
            filtroEstatus() === 'por_facturar' ||
            filtroEstatus() === 'facturado'
          "
          (click)="aplicarFiltroEstatus('')">
          <p class="text-2xl font-semibold tabular-nums text-warn">
            {{ totalPendiente() | moneda }}
          </p>
          <p class="text-xs font-medium text-ink-muted">Por cobrar</p>
        </button>
        <button
          type="button"
          class="card card-pad text-left transition hover:border-brand/40"
          [class.ring-2]="filtroEstatus() === 'vencido'"
          [class.ring-danger]="filtroEstatus() === 'vencido'"
          (click)="aplicarFiltroEstatus('vencido')">
          <p class="text-2xl font-semibold tabular-nums text-danger">
            {{ totalVencido() | moneda }}
          </p>
          <p class="text-xs font-medium text-ink-muted">Vencido</p>
        </button>
      </div>

      <div class="mb-4 flex flex-wrap gap-3">
        <input
          type="search"
          class="field max-w-md flex-1"
          placeholder="Buscar por cotización, cliente o folio…"
          [value]="busqueda()"
          (input)="buscar($event)" />
        <select
          class="field max-w-xs"
          [value]="filtroEstatus()"
          (change)="filtrarEstatus($event)">
          <option value="">Todos los estados</option>
          @for (e of estatusOpciones; track e.valor) {
            <option [value]="e.valor">{{ e.etiqueta }}</option>
          }
        </select>
        <select
          class="field max-w-xs"
          [value]="filtroCliente()"
          (change)="filtrarCliente($event)">
          <option value="">Todos los clientes</option>
          @for (c of clientes(); track c.id) {
            <option [value]="c.id">{{ c.nombre }}</option>
          }
        </select>
      </div>

      <div class="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          class="btn"
          [class.btn-activo]="vista() === 'pagos'"
          (click)="vista.set('pagos')">
          Pagos
          <span class="chip bg-surface-muted text-ink-muted">{{
            pagosFiltrados().length
          }}</span>
        </button>
        <button
          type="button"
          class="btn"
          [class.btn-activo]="vista() === 'oc'"
          (click)="vista.set('oc')">
          Órdenes de compra
          <span class="chip bg-surface-muted text-ink-muted">{{
            ordenesFiltradas().length
          }}</span>
        </button>
        <button
          type="button"
          class="btn"
          [class.btn-activo]="vista() === 'facturas'"
          (click)="vista.set('facturas')">
          Facturas
          <span class="chip bg-surface-muted text-ink-muted">{{
            facturasFiltradas().length
          }}</span>
        </button>
        @if (crm.puedeVerCostos()) {
          <button
            type="button"
            class="btn"
            [class.btn-activo]="vista() === 'margen'"
            (click)="vista.set('margen')">
            Partidas y margen
            <span class="chip bg-surface-muted text-ink-muted">{{
              partidas().length
            }}</span>
          </button>
        }
      </div>

      @if (vista() === 'oc') {
        @if (ordenesFiltradas().length === 0) {
          <pt-empty-state
            icon="monitoreo"
            title="Sin órdenes de compra"
            hint="Aún no hay OC registradas o no coinciden con los filtros." />
        } @else {
          <div class="flex flex-col gap-2">
            @for (oc of ordenesFiltradas(); track oc.id) {
              <div
                class="card card-pad flex items-center justify-between gap-4">
                <div class="min-w-0">
                  <p class="font-semibold text-ink">OC {{ oc.folio }}</p>
                  <p class="text-sm text-ink-muted">{{ oc.periodo }}</p>
                </div>
                <span class="shrink-0 text-lg font-semibold tabular-nums">{{
                  oc.monto | moneda: oc.moneda
                }}</span>
              </div>
            }
          </div>
        }
      } @else if (vista() === 'facturas') {
        @if (facturasFiltradas().length === 0) {
          <pt-empty-state
            icon="monitoreo"
            title="Sin facturas"
            hint="Aún no hay facturas registradas o no coinciden con los filtros." />
        } @else {
          <div class="flex flex-col gap-2">
            @for (f of facturasFiltradas(); track f.id) {
              <div
                class="card card-pad flex items-center justify-between gap-4">
                <div class="min-w-0">
                  <p class="font-semibold text-ink">
                    {{ f.folio ?? f.uuid }}
                  </p>
                  <p class="text-sm text-ink-muted">
                    {{ f.fechaEmision | dia }}
                  </p>
                </div>
                <span class="shrink-0 text-lg font-semibold tabular-nums">{{
                  f.total | moneda: f.moneda
                }}</span>
              </div>
            }
          </div>
        }
      } @else if (vista() === 'margen' && crm.puedeVerCostos()) {
        @if (partidas().length === 0) {
          <pt-empty-state
            icon="monitoreo"
            title="Sin partidas"
            hint="Aún no hay partidas con costo." />
        } @else {
          <div class="flex flex-col gap-2">
            @for (p of partidas(); track p.id) {
              <div
                class="card card-pad flex items-center justify-between gap-4">
                <div class="min-w-0">
                  <p class="font-semibold text-ink">{{ p.descripcion }}</p>
                  <p class="text-sm text-ink-muted">
                    Costo {{ p.costoTotal | moneda: p.moneda }}
                  </p>
                </div>
                <span class="shrink-0 text-lg font-semibold tabular-nums">{{
                  p.importe | moneda: p.moneda
                }}</span>
              </div>
            }
          </div>
        }
      } @else if (pagosFiltrados().length === 0) {
        <pt-empty-state
          icon="monitoreo"
          title="Sin pagos"
          [hint]="
            filtroEstatus() || filtroCliente() || busqueda()
              ? 'No hay pagos que coincidan con los filtros.'
              : 'Aún no hay pagos programados.'
          " />
      } @else {
        <div class="flex flex-col gap-2">
          @for (pago of pagosFiltrados(); track pago.id) {
            <div
              class="card card-pad flex flex-wrap items-center justify-between gap-4"
              [class.ring-2]="estaVencido(pago)"
              [class.ring-rose-400]="estaVencido(pago)">
              <div class="min-w-0 flex-1">
                <div class="mb-1 flex flex-wrap items-center gap-2">
                  @if (pago.proyecto) {
                    <a
                      class="font-semibold text-ink hover:underline"
                      [routerLink]="['/proyectos', pago.proyecto.id]">
                      {{ pago.cotizacion?.nombre ?? 'Cotización' }}
                      @if (pago.cotizacion?.folio) {
                        <span class="font-normal text-ink-muted"
                          >({{ pago.cotizacion?.folio }})</span
                        >
                      }
                    </a>
                  } @else {
                    <span class="font-semibold text-ink">
                      {{ pago.cotizacion?.nombre ?? 'Cotización' }}
                      @if (pago.cotizacion?.folio) {
                        <span class="font-normal text-ink-muted"
                          >({{ pago.cotizacion?.folio }})</span
                        >
                      }
                    </span>
                  }
                  @if (pago.estatus) {
                    <span class="chip" [class]="estatusClase[pago.estatus]">
                      {{ estatusLabel[pago.estatus] }}
                    </span>
                  } @else {
                    <span class="chip bg-surface-muted text-ink-muted"
                      >Por confirmar</span
                    >
                  }
                </div>
                <div class="flex flex-wrap gap-3 text-sm text-ink-muted">
                  <span>Pago {{ pago.numero }} de {{ pago.totalPagos }}</span>
                  @if (pago.cliente) {
                    <a
                      class="text-info hover:underline"
                      [routerLink]="['/clientes', pago.cliente.id]">
                      {{ pago.cliente.nombre }}
                    </a>
                  }
                </div>
              </div>
              <div class="shrink-0 text-right">
                <p class="text-lg font-semibold tabular-nums">
                  {{ pago.monto | moneda: pago.moneda }}
                </p>
                <p
                  class="text-xs text-ink-muted"
                  [class.text-danger]="estaVencido(pago)">
                  @if (pago.estatus === 'pagado' && pago.fechaPagoReal) {
                    Pagado {{ pago.fechaPagoReal | dia }}
                  } @else {
                    Vence {{ pago.fechaEsperada | relativo }}
                  }
                </p>
              </div>
            </div>
          }
        </div>
      }
    }
  `
})
export class CobranzaComponent {
  readonly crm = inject(CrmService);

  readonly estatusLabel = CRM_PAGO_ESTATUS_LABEL;
  readonly estatusClase = ESTATUS_CLASE;
  readonly estatusOpciones = [
    { valor: 'por_facturar', etiqueta: 'Por facturar' },
    { valor: 'facturado', etiqueta: 'Facturado' },
    { valor: 'pagado', etiqueta: 'Pagado' },
    { valor: 'vencido', etiqueta: 'Vencido' }
  ];

  readonly filtroEstatus = signal('');
  readonly filtroCliente = signal('');
  readonly busqueda = signal('');
  readonly vista = signal<VistaCobranza>('pagos');
  readonly error = signal<string | null>(null);

  private readonly datos$ = combineLatest([
    this.crm.obtenerPagos(),
    this.crm.obtenerCotizaciones(),
    this.crm.obtenerProyectos(),
    this.crm.obtenerClientes(),
    this.crm.obtenerOrdenesCompra().pipe(catchError(() => of([]))),
    this.crm.obtenerFacturas().pipe(catchError(() => of([]))),
    this.crm.obtenerPartidas().pipe(catchError(() => of([] as CrmPartida[])))
  ]).pipe(
    map(
      ([
        pagos,
        cotizaciones,
        proyectos,
        clientes,
        ordenes,
        facturas,
        partidas
      ]) => ({
        pagos,
        cotizaciones,
        proyectos,
        clientes,
        ordenes,
        facturas,
        partidas
      })
    ),
    catchError((err) => {
      this.error.set(err.message || 'Error al cargar cobranza');
      return of({
        pagos: [],
        cotizaciones: [],
        proyectos: [],
        clientes: [],
        ordenes: [] as CrmOrdenCompra[],
        facturas: [] as CrmFactura[],
        partidas: [] as CrmPartida[]
      });
    })
  );

  private readonly datos = toSignal(this.datos$, {
    initialValue: {
      pagos: [],
      cotizaciones: [],
      proyectos: [],
      clientes: [],
      ordenes: [] as CrmOrdenCompra[],
      facturas: [] as CrmFactura[],
      partidas: [] as CrmPartida[]
    }
  });

  readonly ordenes = computed(() => this.datos().ordenes);
  readonly facturas = computed(() => this.datos().facturas);
  readonly partidas = computed(() => this.datos().partidas);
  readonly clientes = computed(() => this.datos().clientes);

  readonly pagosConContexto = computed(() => {
    const { pagos, cotizaciones, proyectos, clientes } = this.datos();

    return pagos.map((p) => {
      const cotizacion = cotizaciones.find((c) => c.id === p.cotizacionId);
      const proyecto = cotizacion
        ? proyectos.find((pr) => pr.id === cotizacion.proyectoId)
        : undefined;
      const cliente = proyecto
        ? clientes.find((c) => c.id === proyecto.clienteId)
        : undefined;

      return { ...p, cotizacion, proyecto, cliente } satisfies PagoConContexto;
    });
  });

  readonly pagosFiltrados = computed(() => {
    let resultado = this.pagosConContexto();
    const estatus = this.filtroEstatus() as CrmPagoEstatus | '';
    const clienteId = this.filtroCliente();
    const q = this.busqueda().toLowerCase().trim();

    if (estatus) {
      resultado = resultado.filter((p) => p.estatus === estatus);
    }

    if (clienteId) {
      resultado = resultado.filter((p) => p.cliente?.id === clienteId);
    }

    if (q) {
      resultado = resultado.filter(
        (p) =>
          p.cotizacion?.nombre?.toLowerCase().includes(q) ||
          p.cotizacion?.folio?.toLowerCase().includes(q) ||
          p.cliente?.nombre?.toLowerCase().includes(q) ||
          p.proyecto?.nombre?.toLowerCase().includes(q)
      );
    }

    return resultado.sort((a, b) => {
      if (a.estatus === 'vencido' && b.estatus !== 'vencido') return -1;
      if (a.estatus !== 'vencido' && b.estatus === 'vencido') return 1;
      if (!a.fechaEsperada && !b.fechaEsperada) return 0;
      if (!a.fechaEsperada) return 1;
      if (!b.fechaEsperada) return -1;
      return (
        new Date(a.fechaEsperada).getTime() -
        new Date(b.fechaEsperada).getTime()
      );
    });
  });

  readonly ordenesFiltradas = computed(() => {
    const clienteId = this.filtroCliente();
    const q = this.busqueda().toLowerCase().trim();
    let resultado = this.ordenes();
    if (clienteId) {
      resultado = resultado.filter((o) => o.clienteId === clienteId);
    }
    if (q) {
      resultado = resultado.filter(
        (o) =>
          o.folio?.toLowerCase().includes(q) ||
          o.periodo?.toLowerCase().includes(q)
      );
    }
    return resultado;
  });

  readonly facturasFiltradas = computed(() => {
    const q = this.busqueda().toLowerCase().trim();
    let resultado = this.facturas();
    if (q) {
      resultado = resultado.filter(
        (f) =>
          f.folio?.toLowerCase().includes(q) ||
          f.uuid?.toLowerCase().includes(q)
      );
    }
    return resultado;
  });

  readonly totalPagado = computed(() =>
    this.pagosConContexto()
      .filter((p) => p.estatus === 'pagado' && p.monto != null)
      .reduce((sum, p) => sum + (p.monto ?? 0), 0)
  );

  readonly totalPendiente = computed(() =>
    this.pagosConContexto()
      .filter(
        (p) =>
          p.estatus !== 'pagado' && p.estatus !== 'vencido' && p.monto != null
      )
      .reduce((sum, p) => sum + (p.monto ?? 0), 0)
  );

  readonly totalVencido = computed(() =>
    this.pagosConContexto()
      .filter((p) => p.estatus === 'vencido' && p.monto != null)
      .reduce((sum, p) => sum + (p.monto ?? 0), 0)
  );

  buscar(event: Event): void {
    this.busqueda.set((event.target as HTMLInputElement).value);
  }

  filtrarEstatus(event: Event): void {
    this.filtroEstatus.set((event.target as HTMLSelectElement).value);
    this.vista.set('pagos');
  }

  aplicarFiltroEstatus(estatus: string): void {
    this.filtroEstatus.set(
      this.filtroEstatus() === estatus && estatus !== '' ? '' : estatus
    );
    this.vista.set('pagos');
  }

  filtrarCliente(event: Event): void {
    this.filtroCliente.set((event.target as HTMLSelectElement).value);
  }

  estaVencido(pago: CrmPagoProgramado): boolean {
    if (pago.estatus === 'pagado') return false;
    if (!pago.fechaEsperada) return false;
    return new Date(pago.fechaEsperada) < new Date();
  }
}
