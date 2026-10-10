import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, combineLatest, map, of, switchMap } from 'rxjs';
import {
  CRM_PROYECTO_ESTADO_LABEL,
  CRM_COTIZACION_ESTATUS_LABEL,
  CRM_FUNCIONALIDAD_ESTADO_LABEL,
  type CrmCliente,
  type CrmContacto,
  type CrmCotizacion,
  type CrmFuncionalidad,
  type CrmProyecto
} from '../../core/models/crm-nativo.model';
import { CrmService } from '../../core/sources/gateway/crm.service';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { IconComponent } from '../../ui/icon.component';
import { PageHeaderComponent } from '../../ui/page-header.component';
import { DayPipe, MoneyPipe, RelativePipe } from '../../ui/portal.pipes';

interface DatosProyecto {
  proyecto: CrmProyecto;
  cliente: CrmCliente | null;
  responsable: CrmContacto | null;
  cotizaciones: CrmCotizacion[];
  funcionalidades: CrmFuncionalidad[];
}

@Component({
  selector: 'pt-proyecto-detalle',
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
    <pt-page-header [title]="datos()?.proyecto?.nombre ?? 'Proyecto'" />

    @if (cargando()) {
      <div class="loading-message">Cargando...</div>
    } @else if (error()) {
      <pt-empty-state icon="alerta" title="Error" [hint]="error()!" />
    } @else if (datos(); as d) {
      <div class="detalle">
        <!-- Info del proyecto -->
        <section class="card seccion">
          <h3 class="seccion-titulo">Información</h3>
          <div class="info-grid">
            <div class="info-item">
              <span class="info-label">Estado</span>
              <span class="chip chip--estado-{{ d.proyecto.estado }}">
                {{ estadoLabel[d.proyecto.estado] }}
              </span>
            </div>
            @if (d.cliente) {
              <div class="info-item">
                <span class="info-label">Cliente</span>
                <a class="link" [routerLink]="['/clientes', d.cliente.id]">
                  {{ d.cliente.nombre }}
                </a>
              </div>
            }
            @if (d.responsable) {
              <div class="info-item">
                <span class="info-label">Responsable (cliente)</span>
                <span class="info-valor">{{ d.responsable.nombre }}</span>
              </div>
            }
            @if (d.proyecto.responsableInterno) {
              <div class="info-item">
                <span class="info-label">Responsable interno</span>
                <span class="info-valor">
                  {{ d.proyecto.responsableInterno.name }}
                </span>
              </div>
            }
            @if (d.proyecto.fechaInicio) {
              <div class="info-item">
                <span class="info-label">Inicio</span>
                <span class="info-valor">
                  {{ d.proyecto.fechaInicio | dia }}
                </span>
              </div>
            }
            @if (d.proyecto.fechaFinEstimada) {
              <div class="info-item">
                <span class="info-label">Fin estimado</span>
                <span class="info-valor">
                  {{ d.proyecto.fechaFinEstimada | dia }}
                </span>
              </div>
            }
          </div>

          @if (d.proyecto.avancePct !== undefined) {
            <div class="avance-grande">
              <div class="avance-header">
                <span class="avance-label">Avance del proyecto</span>
                <span class="avance-porcentaje"
                  >{{ d.proyecto.avancePct }}%</span
                >
              </div>
              <div class="avance-barra">
                <div
                  class="avance-progreso"
                  [style.width.%]="d.proyecto.avancePct"></div>
              </div>
            </div>
          }

          @if (d.proyecto.alcance) {
            <div class="alcance">
              <span class="info-label">Alcance</span>
              <p class="alcance-texto">{{ d.proyecto.alcance }}</p>
            </div>
          }
        </section>

        <!-- Cotizaciones -->
        @if (crm.puedeVerCotizaciones()) {
          <section class="card seccion">
            <h3 class="seccion-titulo">
              Cotizaciones
              <span class="badge">{{ d.cotizaciones.length }}</span>
            </h3>
            @if (d.cotizaciones.length === 0) {
              <p class="sin-datos">Sin cotizaciones</p>
            } @else {
              <div class="lista-items">
                @for (cot of d.cotizaciones; track cot.id) {
                  <div class="cotizacion-item">
                    <div class="cotizacion-info">
                      <span class="cotizacion-nombre">
                        {{ cot.nombre }}
                        @if (cot.folio) {
                          <span class="cotizacion-folio"
                            >({{ cot.folio }})</span
                          >
                        }
                      </span>
                      <span class="chip chip--estatus-{{ cot.estatus }}">
                        {{ estatusLabel[cot.estatus] }}
                      </span>
                      @if (cot.autorizadaPorCarlosEn) {
                        <span class="chip chip--autorizada">
                          <pt-icon name="ok" class="h-3 w-3" />
                          Autorizada
                        </span>
                      }
                    </div>
                    <div class="cotizacion-monto">
                      {{ cot.total | moneda: cot.moneda }}
                    </div>
                  </div>
                }
              </div>
              <div class="cotizacion-total">
                <span>Total cotizado:</span>
                <span class="total-valor">{{ totalCotizado() | moneda }}</span>
              </div>
            }
          </section>
        }

        <!-- Funcionalidades -->
        @if (crm.puedeVerDesarrollo()) {
          <section class="card seccion">
            <div class="seccion-header">
              <h3 class="seccion-titulo">
                Funcionalidades
                <span class="badge">{{ d.funcionalidades.length }}</span>
              </h3>
              <a
                class="btn btn--text"
                routerLink="/desarrollo"
                [queryParams]="{ proyecto: id() }">
                Ver tablero
              </a>
            </div>
            @if (d.funcionalidades.length === 0) {
              <p class="sin-datos">Sin funcionalidades</p>
            } @else {
              <div class="func-resumen">
                @for (estado of estadosFuncionalidad; track estado.key) {
                  <div class="func-estado">
                    <span class="func-count">
                      {{ contarFuncionalidades(estado.key) }}
                    </span>
                    <span class="func-label">{{ estado.label }}</span>
                  </div>
                }
              </div>
            }
          </section>
        }

        <!-- Enlaces -->
        @if (d.proyecto.driveUrl || d.proyecto.repos?.length) {
          <section class="card seccion">
            <h3 class="seccion-titulo">Enlaces</h3>
            <div class="enlaces">
              @if (d.proyecto.driveUrl) {
                <a class="enlace" [href]="d.proyecto.driveUrl" target="_blank">
                  <pt-icon name="externo" class="h-4 w-4" />
                  Google Drive
                </a>
              }
              @for (repo of d.proyecto.repos ?? []; track repo) {
                <a class="enlace" [href]="repo" target="_blank">
                  <pt-icon name="rama" class="h-4 w-4" />
                  Repositorio
                </a>
              }
            </div>
          </section>
        }
      </div>
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

    .detalle {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }

    .seccion {
      padding: var(--space-4);
    }

    .seccion-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: var(--space-3);
    }

    .seccion-titulo {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      margin: 0 0 var(--space-3) 0;
      font-size: 1rem;
      font-weight: 600;
    }

    .seccion-header .seccion-titulo {
      margin-bottom: 0;
    }

    .badge {
      background: var(--surface-secondary);
      color: var(--text-secondary);
      font-size: 0.75rem;
      font-weight: 500;
      padding: 2px 8px;
      border-radius: 10px;
    }

    .info-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: var(--space-3);
    }

    .info-item {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
    }

    .info-label {
      font-size: 0.75rem;
      color: var(--text-tertiary);
      text-transform: uppercase;
    }

    .info-valor {
      color: var(--text-primary);
    }

    .link {
      color: var(--accent);
      text-decoration: none;
    }

    .link:hover {
      text-decoration: underline;
    }

    .avance-grande {
      margin-top: var(--space-4);
      padding-top: var(--space-3);
      border-top: 1px solid var(--border);
    }

    .avance-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: var(--space-2);
    }

    .avance-label {
      font-size: 0.875rem;
      color: var(--text-secondary);
    }

    .avance-porcentaje {
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--accent);
    }

    .avance-barra {
      height: 8px;
      background: var(--surface-secondary);
      border-radius: 4px;
      overflow: hidden;
    }

    .avance-progreso {
      height: 100%;
      background: var(--accent);
      border-radius: 4px;
    }

    .alcance {
      margin-top: var(--space-3);
    }

    .alcance-texto {
      margin: var(--space-1) 0 0 0;
      color: var(--text-secondary);
      white-space: pre-wrap;
    }

    .sin-datos {
      color: var(--text-secondary);
      font-style: italic;
      margin: 0;
    }

    .lista-items {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }

    .cotizacion-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-2) 0;
      border-bottom: 1px solid var(--border);
    }

    .cotizacion-item:last-child {
      border-bottom: none;
    }

    .cotizacion-info {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      flex-wrap: wrap;
    }

    .cotizacion-nombre {
      font-weight: 500;
    }

    .cotizacion-folio {
      color: var(--text-secondary);
      font-size: 0.875rem;
    }

    .cotizacion-monto {
      font-weight: 600;
      font-family: var(--font-mono);
    }

    .cotizacion-total {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: var(--space-3);
      padding-top: var(--space-3);
      border-top: 1px solid var(--border);
      font-weight: 500;
    }

    .total-valor {
      font-size: 1.125rem;
      font-family: var(--font-mono);
      color: var(--accent);
    }

    .func-resumen {
      display: flex;
      gap: var(--space-4);
      flex-wrap: wrap;
    }

    .func-estado {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-1);
      min-width: 80px;
    }

    .func-count {
      font-size: 1.5rem;
      font-weight: 600;
      color: var(--text-primary);
    }

    .func-label {
      font-size: 0.75rem;
      color: var(--text-secondary);
      text-align: center;
    }

    .enlaces {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }

    .enlace {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-2) var(--space-3);
      background: var(--surface-secondary);
      border-radius: var(--radius);
      color: var(--text-primary);
      text-decoration: none;
      transition: background-color 0.15s;
    }

    .enlace:hover {
      background: var(--surface-hover);
    }

    .chip--autorizada {
      --chip-bg: var(--accent-green-bg);
      --chip-text: var(--accent-green);
    }

    .chip--estatus-borrador {
      --chip-bg: var(--surface-secondary);
      --chip-text: var(--text-secondary);
    }
    .chip--estatus-enviada {
      --chip-bg: var(--accent-blue-bg);
      --chip-text: var(--accent-blue);
    }
    .chip--estatus-aprobada {
      --chip-bg: var(--accent-green-bg);
      --chip-text: var(--accent-green);
    }
    .chip--estatus-rechazada {
      --chip-bg: var(--accent-red-bg);
      --chip-text: var(--accent-red);
    }
    .chip--estatus-vencida {
      --chip-bg: var(--accent-orange-bg);
      --chip-text: var(--accent-orange);
    }
    .chip--estatus-obsoleta {
      --chip-bg: var(--surface-secondary);
      --chip-text: var(--text-tertiary);
    }
    .chip--estatus-desconocido {
      --chip-bg: var(--surface-secondary);
      --chip-text: var(--text-secondary);
    }

    .chip--estado-prospecto {
      --chip-bg: var(--surface-secondary);
      --chip-text: var(--text-secondary);
    }
    .chip--estado-en_cotizacion {
      --chip-bg: var(--accent-blue-bg);
      --chip-text: var(--accent-blue);
    }
    .chip--estado-aprobado {
      --chip-bg: var(--accent-green-bg);
      --chip-text: var(--accent-green);
    }
    .chip--estado-en_desarrollo {
      --chip-bg: var(--accent-purple-bg);
      --chip-text: var(--accent-purple);
    }
    .chip--estado-en_pruebas {
      --chip-bg: var(--accent-orange-bg);
      --chip-text: var(--accent-orange);
    }
    .chip--estado-entregado {
      --chip-bg: var(--accent-green-bg);
      --chip-text: var(--accent-green);
    }
    .chip--estado-en_soporte {
      --chip-bg: var(--accent-blue-bg);
      --chip-text: var(--accent-blue);
    }
    .chip--estado-pausado {
      --chip-bg: var(--surface-secondary);
      --chip-text: var(--text-tertiary);
    }
    .chip--estado-cancelado {
      --chip-bg: var(--accent-red-bg);
      --chip-text: var(--accent-red);
    }
  `
})
export class ProyectoDetalleComponent {
  readonly crm = inject(CrmService);

  readonly id = input.required<string>();

  readonly estadoLabel = CRM_PROYECTO_ESTADO_LABEL;
  readonly estatusLabel = CRM_COTIZACION_ESTATUS_LABEL;
  readonly funcEstadoLabel = CRM_FUNCIONALIDAD_ESTADO_LABEL;

  readonly estadosFuncionalidad = [
    { key: 'por_hacer', label: 'Por hacer' },
    { key: 'en_progreso', label: 'En progreso' },
    { key: 'en_revision', label: 'En revisión' },
    { key: 'hecho', label: 'Hecho' }
  ] as const;

  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);

  private readonly _datos = toSignal(
    this.crm.obtenerProyectos().pipe(
      switchMap(() => {
        const proyectoId = this.id();
        return combineLatest([
          this.crm.obtenerProyecto(proyectoId),
          this.crm.obtenerClientes(),
          this.crm.obtenerContactos(),
          this.crm.obtenerCotizaciones(proyectoId),
          this.crm.obtenerFuncionalidades(proyectoId)
        ]).pipe(
          map(
            ([
              proyecto,
              clientes,
              contactos,
              cotizaciones,
              funcionalidades
            ]) => {
              this.cargando.set(false);
              const cliente =
                clientes.find((c) => c.id === proyecto.clienteId) ?? null;
              const responsable = proyecto.responsableClienteId
                ? (contactos.find(
                    (c) => c.id === proyecto.responsableClienteId
                  ) ?? null)
                : null;
              return {
                proyecto,
                cliente,
                responsable,
                cotizaciones,
                funcionalidades
              };
            }
          )
        );
      }),
      catchError((err) => {
        this.cargando.set(false);
        this.error.set(err.message || 'Error al cargar proyecto');
        return of(null);
      })
    )
  );

  readonly datos = computed(() => this._datos());

  readonly totalCotizado = computed(() => {
    const d = this.datos();
    if (!d) return 0;
    return d.cotizaciones.reduce((sum, c) => sum + (c.total ?? 0), 0);
  });

  volverUrl(): string {
    const d = this.datos();
    if (d?.cliente) {
      return `/clientes/${d.cliente.id}`;
    }
    return '/clientes';
  }

  contarFuncionalidades(estado: string): number {
    const d = this.datos();
    if (!d) return 0;
    return d.funcionalidades.filter((f) => f.estado === estado).length;
  }
}
