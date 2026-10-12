import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';
import {
  CRM_CLIENTE_TIPO_LABEL,
  type CrmClienteTipo
} from '../../core/models/crm-nativo.model';
import { CrmService } from '../../core/sources/gateway/crm.service';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { IconComponent } from '../../ui/icon.component';
import { PageHeaderComponent } from '../../ui/page-header.component';

const TIPO_CLASE: Record<CrmClienteTipo, string> = {
  directo: 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200',
  intermediario:
    'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
  final:
    'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200'
};

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
    <pt-page-header
      title="Clientes"
      [subtitle]="
        clientesFiltrados().length +
        (clientesFiltrados().length === 1 ? ' cliente' : ' clientes')
      " />

    @if (crm.cargando()) {
      <p class="py-8 text-center text-ink-muted">Cargando…</p>
    } @else if (!crm.tieneAcceso()) {
      <pt-empty-state
        icon="usuario"
        title="Sin acceso"
        hint="No tienes permiso para ver el CRM." />
    } @else if (error()) {
      <pt-empty-state icon="alerta" title="Error" [hint]="error()!" />
    } @else {
      <div class="mb-4 flex flex-wrap gap-3">
        <input
          type="search"
          class="field max-w-md flex-1"
          placeholder="Buscar por nombre, razón social o RFC…"
          [value]="busqueda()"
          (input)="buscar($event)" />
        <select
          class="field max-w-xs"
          [value]="filtroTipo()"
          (change)="filtrarTipo($event)">
          <option value="">Todos los tipos</option>
          @for (tipo of tipos; track tipo.valor) {
            <option [value]="tipo.valor">{{ tipo.etiqueta }}</option>
          }
        </select>
      </div>

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
        <div class="flex flex-col gap-2">
          @for (cliente of clientesFiltrados(); track cliente.id) {
            <a
              class="card card-pad flex items-center gap-3 transition hover:border-brand/40 hover:shadow-md"
              [routerLink]="['/clientes', cliente.id]">
              <div class="min-w-0 flex-1">
                <p class="truncate font-semibold text-ink">
                  {{ cliente.nombre }}
                </p>
                @if (cliente.razonSocial) {
                  <p class="truncate text-sm text-ink-muted">
                    {{ cliente.razonSocial }}
                  </p>
                }
              </div>
              <div
                class="flex shrink-0 flex-wrap items-center justify-end gap-2">
                <span class="chip" [class]="tipoClase[cliente.tipo]">
                  {{ tipoLabel[cliente.tipo] }}
                </span>
                @if (cliente.rfc) {
                  <span class="font-mono text-xs text-ink-subtle">{{
                    cliente.rfc
                  }}</span>
                }
              </div>
              <pt-icon
                name="siguiente"
                class="h-4 w-4 shrink-0 text-ink-subtle" />
            </a>
          }
        </div>
      }
    }
  `
})
export class ClientesComponent {
  readonly crm = inject(CrmService);

  readonly tipoLabel = CRM_CLIENTE_TIPO_LABEL;
  readonly tipoClase = TIPO_CLASE;
  readonly tipos = [
    { valor: 'directo', etiqueta: 'Directo' },
    { valor: 'intermediario', etiqueta: 'Intermediario' },
    { valor: 'final', etiqueta: 'Final' }
  ];

  readonly busqueda = signal('');
  readonly filtroTipo = signal('');
  readonly error = signal<string | null>(null);

  private readonly clientes$ = this.crm.obtenerClientes().pipe(
    catchError((err) => {
      this.error.set(err.message || 'Error al cargar clientes');
      return of([]);
    })
  );

  readonly clientes = toSignal(this.clientes$, { initialValue: [] });

  readonly clientesFiltrados = computed(() => {
    let resultado = this.clientes();
    const busqueda = this.busqueda().toLowerCase().trim();
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

    return resultado.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
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
