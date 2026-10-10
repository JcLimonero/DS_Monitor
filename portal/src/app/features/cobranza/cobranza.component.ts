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
  CrmPagoEstatus,
  type CrmCliente,
  type CrmCotizacion,
  type CrmPagoProgramado,
  type CrmProyecto
} from '../../core/models/crm-nativo.model';
import { CrmService } from '../../core/sources/gateway/crm.service';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { IconComponent } from '../../ui/icon.component';
import { PageHeaderComponent } from '../../ui/page-header.component';
import { DayPipe, MoneyPipe, RelativePipe } from '../../ui/portal.pipes';

interface PagoConContexto extends CrmPagoProgramado {
  cotizacion?: CrmCotizacion;
  proyecto?: CrmProyecto;
  cliente?: CrmCliente;
}

@Component({
  selector: 'pt-cobranza',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    EmptyStateComponent,
    IconComponent,
    PageHeaderComponent,
    DayPipe,
    MoneyPipe,
    RelativePipe
  ],
  template: `
    <pt-page-header title="Cobranza" />

    @if (crm.cargando()) {
      <div class="loading-message">Cargando...</div>
    } @else if (!crm.puedeVerCobranza()) {
      <pt-empty-state
        icon="usuario"
        title="Sin acceso"
        hint="No tienes permiso para ver cobranza." />
    } @else if (error()) {
      <pt-empty-state icon="alerta" title="Error" [hint]="error()!" />
    } @else {
      <!-- Resumen -->
      <div class="resumen">
        <div class="resumen-item">
          <span class="resumen-valor pagado">{{ totalPagado() | moneda }}</span>
          <span class="resumen-label">Pagado</span>
        </div>
        <div class="resumen-item">
          <span class="resumen-valor pendiente">
            {{ totalPendiente() | moneda }}
          </span>
          <span class="resumen-label">Por cobrar</span>
        </div>
        <div class="resumen-item">
          <span class="resumen-valor vencido">{{
            totalVencido() | moneda
          }}</span>
          <span class="resumen-label">Vencido</span>
        </div>
      </div>

      <!-- Filtros -->
      <div class="filtros">
        <select
          class="field"
          [value]="filtroEstatus()"
          (change)="filtrarEstatus($event)">
          <option value="">Todos los estados</option>
          @for (e of estatusOpciones; track e.valor) {
            <option [value]="e.valor">{{ e.etiqueta }}</option>
          }
        </select>
        <select
          class="field"
          [value]="filtroCliente()"
          (change)="filtrarCliente($event)">
          <option value="">Todos los clientes</option>
          @for (c of clientes(); track c.id) {
            <option [value]="c.id">{{ c.nombre }}</option>
          }
        </select>
      </div>

      <!-- Lista de pagos -->
      @if (pagosFiltrados().length === 0) {
        <pt-empty-state
          icon="monitoreo"
          title="Sin pagos"
          [hint]="
            filtroEstatus() || filtroCliente()
              ? 'No hay pagos que coincidan con los filtros.'
              : 'Aún no hay pagos programados.'
          " />
      } @else {
        <div class="lista">
          @for (pago of pagosFiltrados(); track pago.id) {
            <div class="card pago-card">
              <div class="pago-info">
                <div class="pago-header">
                  <span class="pago-cotizacion">
                    {{ pago.cotizacion?.nombre ?? 'Cotización' }}
                    @if (pago.cotizacion?.folio) {
                      <span class="pago-folio">
                        ({{ pago.cotizacion?.folio }})
                      </span>
                    }
                  </span>
                  @if (pago.estatus) {
                    <span class="chip chip--{{ pago.estatus }}">
                      {{ estatusLabel[pago.estatus] }}
                    </span>
                  } @else {
                    <span class="chip chip--por_confirmar">
                      Por confirmar
                    </span>
                  }
                </div>
                <div class="pago-detalles">
                  <span class="pago-numero">
                    Pago {{ pago.numero }} de {{ pago.totalPagos }}
                  </span>
                  @if (pago.cliente) {
                    <a
                      class="pago-cliente"
                      [routerLink]="['/clientes', pago.cliente.id]">
                      {{ pago.cliente.nombre }}
                    </a>
                  }
                </div>
              </div>
              <div class="pago-montos">
                <span class="pago-monto">
                  {{ pago.monto | moneda: pago.moneda }}
                </span>
                <span class="pago-fecha" [class.vencida]="estaVencido(pago)">
                  @if (pago.estatus === 'pagado' && pago.fechaPagoReal) {
                    Pagado {{ pago.fechaPagoReal | dia }}
                  } @else {
                    Vence {{ pago.fechaEsperada | relativo }}
                  }
                </span>
              </div>
            </div>
          }
        </div>
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

    .resumen {
      display: flex;
      gap: var(--space-4);
      margin-bottom: var(--space-4);
      padding: var(--space-4);
      background: var(--surface-secondary);
      border-radius: var(--radius);
      flex-wrap: wrap;
    }

    .resumen-item {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      min-width: 120px;
    }

    .resumen-valor {
      font-size: 1.5rem;
      font-weight: 600;
      font-family: var(--font-mono);
    }

    .resumen-valor.pagado {
      color: var(--accent-green);
    }

    .resumen-valor.pendiente {
      color: var(--accent-orange);
    }

    .resumen-valor.vencido {
      color: var(--accent-red);
    }

    .resumen-label {
      font-size: 0.75rem;
      color: var(--text-secondary);
      text-transform: uppercase;
    }

    .filtros {
      display: flex;
      gap: var(--space-3);
      margin-bottom: var(--space-4);
      flex-wrap: wrap;
    }

    .filtros select {
      min-width: 180px;
    }

    .lista {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }

    .pago-card {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--space-4);
      padding: var(--space-3) var(--space-4);
    }

    .pago-info {
      flex: 1;
      min-width: 0;
    }

    .pago-header {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      margin-bottom: var(--space-1);
    }

    .pago-cotizacion {
      font-weight: 500;
    }

    .pago-folio {
      color: var(--text-secondary);
      font-size: 0.875rem;
    }

    .pago-detalles {
      display: flex;
      gap: var(--space-3);
      font-size: 0.875rem;
      color: var(--text-secondary);
    }

    .pago-cliente {
      color: var(--accent);
      text-decoration: none;
    }

    .pago-cliente:hover {
      text-decoration: underline;
    }

    .pago-montos {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: var(--space-1);
    }

    .pago-monto {
      font-size: 1.125rem;
      font-weight: 600;
      font-family: var(--font-mono);
    }

    .pago-fecha {
      font-size: 0.75rem;
      color: var(--text-secondary);
    }

    .pago-fecha.vencida {
      color: var(--accent-red);
    }

    .chip--por_facturar {
      --chip-bg: var(--surface-secondary);
      --chip-text: var(--text-secondary);
    }
    .chip--facturado {
      --chip-bg: var(--accent-blue-bg);
      --chip-text: var(--accent-blue);
    }
    .chip--pagado {
      --chip-bg: var(--accent-green-bg);
      --chip-text: var(--accent-green);
    }
    .chip--vencido {
      --chip-bg: var(--accent-red-bg);
      --chip-text: var(--accent-red);
    }
  `
})
export class CobranzaComponent {
  readonly crm = inject(CrmService);

  readonly estatusLabel = CRM_PAGO_ESTATUS_LABEL;
  readonly estatusOpciones = [
    { valor: 'por_facturar', etiqueta: 'Por facturar' },
    { valor: 'facturado', etiqueta: 'Facturado' },
    { valor: 'pagado', etiqueta: 'Pagado' },
    { valor: 'vencido', etiqueta: 'Vencido' }
  ];

  readonly filtroEstatus = signal('');
  readonly filtroCliente = signal('');
  readonly error = signal<string | null>(null);

  private readonly datos$ = combineLatest([
    this.crm.obtenerPagos(),
    this.crm.obtenerCotizaciones(),
    this.crm.obtenerProyectos(),
    this.crm.obtenerClientes()
  ]).pipe(
    map(([pagos, cotizaciones, proyectos, clientes]) => ({
      pagos,
      cotizaciones,
      proyectos,
      clientes
    })),
    catchError((err) => {
      this.error.set(err.message || 'Error al cargar cobranza');
      return of({ pagos: [], cotizaciones: [], proyectos: [], clientes: [] });
    })
  );

  private readonly datos = toSignal(this.datos$, {
    initialValue: { pagos: [], cotizaciones: [], proyectos: [], clientes: [] }
  });

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

      return { ...p, cotizacion, proyecto, cliente };
    });
  });

  readonly pagosFiltrados = computed(() => {
    let resultado = this.pagosConContexto();
    const estatus = this.filtroEstatus() as CrmPagoEstatus | '';
    const clienteId = this.filtroCliente();

    if (estatus) {
      resultado = resultado.filter((p) => p.estatus === estatus);
    }

    if (clienteId) {
      resultado = resultado.filter((p) => p.cliente?.id === clienteId);
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

  filtrarEstatus(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.filtroEstatus.set(select.value);
  }

  filtrarCliente(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.filtroCliente.set(select.value);
  }

  estaVencido(pago: CrmPagoProgramado): boolean {
    if (pago.estatus === 'pagado') return false;
    if (!pago.fechaEsperada) return false;
    return new Date(pago.fechaEsperada) < new Date();
  }
}
