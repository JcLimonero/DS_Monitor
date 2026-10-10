import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { catchError, of, startWith, switchMap, tap } from 'rxjs';
import {
  CRM_CLIENTE_TIPO_LABEL,
  type CrmCliente
} from '../../core/models/crm-nativo.model';
import { CrmService } from '../../core/sources/gateway/crm.service';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { IconComponent } from '../../ui/icon.component';
import { PageHeaderComponent } from '../../ui/page-header.component';

@Component({
  selector: 'pt-clientes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    EmptyStateComponent,
    IconComponent,
    PageHeaderComponent
  ],
  template: `
    <pt-page-header title="Clientes" />

    @if (crm.cargando()) {
      <div class="loading-message">Cargando...</div>
    } @else if (!crm.tieneAcceso()) {
      <pt-empty-state
        icon="usuario"
        title="Sin acceso"
        hint="No tienes permiso para ver el CRM." />
    } @else if (error()) {
      <pt-empty-state icon="alerta" title="Error" [hint]="error()!" />
    } @else {
      <!-- Filtros -->
      <div class="filtros">
        <input
          type="text"
          class="field"
          placeholder="Buscar cliente..."
          [value]="busqueda()"
          (input)="buscar($event)" />
        <select
          class="field"
          [value]="filtroTipo()"
          (change)="filtrarTipo($event)">
          <option value="">Todos los tipos</option>
          @for (tipo of tipos; track tipo.valor) {
            <option [value]="tipo.valor">{{ tipo.etiqueta }}</option>
          }
        </select>
      </div>

      <!-- Lista de clientes -->
      @if (clientesFiltrados().length === 0) {
        <pt-empty-state
          icon="crm"
          title="Sin clientes"
          [hint]="
            busqueda() || filtroTipo()
              ? 'No hay clientes que coincidan con los filtros.'
              : 'Aún no hay clientes registrados.'
          " />
      } @else {
        <div class="lista">
          @for (cliente of clientesFiltrados(); track cliente.id) {
            <a
              class="card cliente-card"
              [routerLink]="['/clientes', cliente.id]">
              <div class="cliente-info">
                <span class="cliente-nombre">{{ cliente.nombre }}</span>
                @if (cliente.razonSocial) {
                  <span class="cliente-razon">{{ cliente.razonSocial }}</span>
                }
              </div>
              <div class="cliente-meta">
                <span class="chip chip--{{ cliente.tipo }}">
                  {{ tipoLabel[cliente.tipo] }}
                </span>
                @if (cliente.rfc) {
                  <span class="cliente-rfc">{{ cliente.rfc }}</span>
                }
              </div>
              <pt-icon name="siguiente" class="chevron h-4 w-4" />
            </a>
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

    .filtros {
      display: flex;
      gap: var(--space-3);
      margin-bottom: var(--space-4);
      flex-wrap: wrap;
    }

    .filtros input {
      flex: 1;
      min-width: 200px;
    }

    .filtros select {
      min-width: 150px;
    }

    .lista {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }

    .cliente-card {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-3) var(--space-4);
      text-decoration: none;
      color: inherit;
      transition: background-color 0.15s;
    }

    .cliente-card:hover {
      background: var(--surface-hover);
    }

    .cliente-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      min-width: 0;
    }

    .cliente-nombre {
      font-weight: 500;
      color: var(--text-primary);
    }

    .cliente-razon {
      font-size: 0.875rem;
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .cliente-meta {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }

    .cliente-rfc {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      color: var(--text-secondary);
    }

    .chip--directo {
      --chip-bg: var(--accent-blue-bg);
      --chip-text: var(--accent-blue);
    }

    .chip--intermediario {
      --chip-bg: var(--accent-orange-bg);
      --chip-text: var(--accent-orange);
    }

    .chip--final {
      --chip-bg: var(--accent-green-bg);
      --chip-text: var(--accent-green);
    }

    .chevron {
      color: var(--text-tertiary);
      flex-shrink: 0;
    }
  `
})
export class ClientesComponent {
  readonly crm = inject(CrmService);

  readonly tipoLabel = CRM_CLIENTE_TIPO_LABEL;
  readonly tipos = [
    { valor: 'directo', etiqueta: 'Directo' },
    { valor: 'intermediario', etiqueta: 'Intermediario' },
    { valor: 'final', etiqueta: 'Final' }
  ];

  readonly busqueda = signal('');
  readonly filtroTipo = signal('');
  readonly error = signal<string | null>(null);
  readonly recargar = signal(0);

  private readonly clientes$ = this.crm.obtenerClientes().pipe(
    catchError((err) => {
      this.error.set(err.message || 'Error al cargar clientes');
      return of([]);
    })
  );

  readonly clientes = toSignal(this.clientes$, { initialValue: [] });

  readonly clientesFiltrados = computed(() => {
    let resultado = this.clientes();
    const busqueda = this.busqueda().toLowerCase();
    const tipo = this.filtroTipo();

    if (busqueda) {
      resultado = resultado.filter(
        (c) =>
          c.nombre.toLowerCase().includes(busqueda) ||
          c.razonSocial?.toLowerCase().includes(busqueda) ||
          c.rfc?.toLowerCase().includes(busqueda)
      );
    }

    if (tipo) {
      resultado = resultado.filter((c) => c.tipo === tipo);
    }

    return resultado.sort((a, b) => a.nombre.localeCompare(b.nombre));
  });

  buscar(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.busqueda.set(input.value);
  }

  filtrarTipo(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.filtroTipo.set(select.value);
  }
}
