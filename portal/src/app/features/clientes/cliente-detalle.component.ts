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
  CRM_CLIENTE_TIPO_LABEL,
  CRM_COTIZACION_ESTATUS_LABEL,
  CRM_PROYECTO_ESTADO_LABEL,
  CRM_ACTIVIDAD_TIPO_LABEL,
  CRM_PAGO_ESTATUS_LABEL,
  type CrmCliente,
  type CrmContacto,
  type CrmProyecto,
  type CrmCotizacion,
  type CrmPagoProgramado,
  type CrmActividadCliente
} from '../../core/models/crm-nativo.model';
import { CrmService } from '../../core/sources/gateway/crm.service';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { IconComponent } from '../../ui/icon.component';
import { PageHeaderComponent } from '../../ui/page-header.component';
import { MoneyPipe, RelativePipe } from '../../ui/portal.pipes';

interface DatosCliente {
  cliente: CrmCliente;
  contactos: CrmContacto[];
  proyectos: CrmProyecto[];
  cotizaciones: CrmCotizacion[];
  pagos: CrmPagoProgramado[];
  actividades: CrmActividadCliente[];
}

@Component({
  selector: 'pt-cliente-detalle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    EmptyStateComponent,
    IconComponent,
    PageHeaderComponent,
    MoneyPipe,
    RelativePipe
  ],
  template: `
    <pt-page-header [title]="datos()?.cliente?.nombre ?? 'Cliente'" />

    @if (cargando()) {
      <div class="loading-message">Cargando...</div>
    } @else if (error()) {
      <pt-empty-state icon="alerta" title="Error" [hint]="error()!" />
    } @else if (datos(); as d) {
      <div class="detalle">
        <!-- Info del cliente -->
        <section class="card seccion">
          <h3 class="seccion-titulo">Información</h3>
          <div class="info-grid">
            <div class="info-item">
              <span class="info-label">Tipo</span>
              <span class="chip chip--{{ d.cliente.tipo }}">
                {{ tipoLabel[d.cliente.tipo] }}
              </span>
            </div>
            @if (d.cliente.razonSocial) {
              <div class="info-item">
                <span class="info-label">Razón social</span>
                <span class="info-valor">{{ d.cliente.razonSocial }}</span>
              </div>
            }
            @if (d.cliente.rfc) {
              <div class="info-item">
                <span class="info-label">RFC</span>
                <span class="info-valor mono">{{ d.cliente.rfc }}</span>
              </div>
            }
            @if (d.cliente.driveFolderUrl) {
              <div class="info-item">
                <span class="info-label">Carpeta Drive</span>
                <a
                  [href]="d.cliente.driveFolderUrl"
                  target="_blank"
                  class="link">
                  <pt-icon name="externo" class="h-4 w-4" />
                  Abrir
                </a>
              </div>
            }
          </div>
        </section>

        <!-- Contactos -->
        <section class="card seccion">
          <h3 class="seccion-titulo">
            Contactos
            <span class="badge">{{ d.contactos.length }}</span>
          </h3>
          @if (d.contactos.length === 0) {
            <p class="sin-datos">Sin contactos registrados</p>
          } @else {
            <div class="lista-items">
              @for (contacto of d.contactos; track contacto.id) {
                <div class="contacto-item">
                  <div class="contacto-info">
                    <span class="contacto-nombre">
                      {{ contacto.nombre }}
                      @if (contacto.esResponsableProyecto) {
                        <span class="chip chip--small">Responsable</span>
                      }
                    </span>
                    @if (contacto.puesto) {
                      <span class="contacto-puesto">{{ contacto.puesto }}</span>
                    }
                  </div>
                  <div class="contacto-datos">
                    @if (contacto.correo) {
                      <a [href]="'mailto:' + contacto.correo" class="link">
                        {{ contacto.correo }}
                      </a>
                    }
                    @if (contacto.telefono) {
                      <span class="contacto-tel">{{ contacto.telefono }}</span>
                    }
                  </div>
                </div>
              }
            </div>
          }
        </section>

        <!-- Proyectos -->
        <section class="card seccion">
          <h3 class="seccion-titulo">
            Proyectos
            <span class="badge">{{ d.proyectos.length }}</span>
          </h3>
          @if (d.proyectos.length === 0) {
            <p class="sin-datos">Sin proyectos</p>
          } @else {
            <div class="lista-items">
              @for (proyecto of d.proyectos; track proyecto.id) {
                <a
                  class="proyecto-item"
                  [routerLink]="['/proyectos', proyecto.id]">
                  <div class="proyecto-info">
                    <span class="proyecto-nombre">{{ proyecto.nombre }}</span>
                    <span class="chip chip--estado-{{ proyecto.estado }}">
                      {{ estadoLabel[proyecto.estado] }}
                    </span>
                  </div>
                  @if (proyecto.avancePct !== undefined) {
                    <div class="avance">
                      <div class="avance-barra">
                        <div
                          class="avance-progreso"
                          [style.width.%]="proyecto.avancePct"></div>
                      </div>
                      <span class="avance-texto"
                        >{{ proyecto.avancePct }}%</span
                      >
                    </div>
                  }
                </a>
              }
            </div>
          }
        </section>

        <!-- Cotizaciones y cobranza -->
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
                    </div>
                    <div class="cotizacion-monto">
                      {{ cot.total | moneda: cot.moneda }}
                    </div>
                  </div>
                }
              </div>

              <!-- Resumen de cobranza -->
              @if (crm.puedeVerCobranza()) {
                <div class="cobranza-resumen">
                  <div class="cobranza-item">
                    <span class="cobranza-label">Pagado</span>
                    <span class="cobranza-valor pagado">
                      {{ pagado() | moneda }}
                    </span>
                  </div>
                  <div class="cobranza-item">
                    <span class="cobranza-label">Por cobrar</span>
                    <span class="cobranza-valor por-cobrar">
                      {{ porCobrar() | moneda }}
                    </span>
                  </div>
                </div>
              }
            }
          </section>
        }

        <!-- Actividades recientes -->
        <section class="card seccion">
          <h3 class="seccion-titulo">
            Actividad reciente
            <span class="badge">{{ d.actividades.length }}</span>
          </h3>
          @if (d.actividades.length === 0) {
            <p class="sin-datos">Sin actividades registradas</p>
          } @else {
            <div class="lista-items">
              @for (act of actividadesRecientes(); track act.id) {
                <div class="actividad-item">
                  <span class="actividad-tipo">
                    {{ actividadTipoLabel[act.tipo] }}
                  </span>
                  <span class="actividad-resumen">{{ act.resumen }}</span>
                  <span class="actividad-fecha">{{
                    act.fecha | relativo
                  }}</span>
                </div>
              }
            </div>
          }
        </section>
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

    .seccion-titulo {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      margin: 0 0 var(--space-3) 0;
      font-size: 1rem;
      font-weight: 600;
      color: var(--text-primary);
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
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
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
      letter-spacing: 0.05em;
    }

    .info-valor {
      color: var(--text-primary);
    }

    .mono {
      font-family: var(--font-mono);
    }

    .link {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      color: var(--accent);
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

    .contacto-item {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: var(--space-3);
      padding: var(--space-2) 0;
      border-bottom: 1px solid var(--border);
    }

    .contacto-item:last-child {
      border-bottom: none;
    }

    .contacto-info {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
    }

    .contacto-nombre {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      font-weight: 500;
    }

    .contacto-puesto {
      font-size: 0.875rem;
      color: var(--text-secondary);
    }

    .contacto-datos {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: var(--space-1);
      font-size: 0.875rem;
    }

    .contacto-tel {
      color: var(--text-secondary);
    }

    .proyecto-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-2);
      border-radius: var(--radius);
      text-decoration: none;
      color: inherit;
      transition: background-color 0.15s;
    }

    .proyecto-item:hover {
      background: var(--surface-hover);
    }

    .proyecto-info {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }

    .proyecto-nombre {
      font-weight: 500;
    }

    .avance {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }

    .avance-barra {
      width: 80px;
      height: 6px;
      background: var(--surface-secondary);
      border-radius: 3px;
      overflow: hidden;
    }

    .avance-progreso {
      height: 100%;
      background: var(--accent);
      border-radius: 3px;
    }

    .avance-texto {
      font-size: 0.75rem;
      color: var(--text-secondary);
      min-width: 36px;
      text-align: right;
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
    }

    .cotizacion-folio {
      color: var(--text-secondary);
      font-size: 0.875rem;
    }

    .cotizacion-monto {
      font-weight: 600;
      font-family: var(--font-mono);
    }

    .cobranza-resumen {
      display: flex;
      gap: var(--space-4);
      margin-top: var(--space-4);
      padding-top: var(--space-3);
      border-top: 1px solid var(--border);
    }

    .cobranza-item {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
    }

    .cobranza-label {
      font-size: 0.75rem;
      color: var(--text-tertiary);
      text-transform: uppercase;
    }

    .cobranza-valor {
      font-size: 1.25rem;
      font-weight: 600;
      font-family: var(--font-mono);
    }

    .cobranza-valor.pagado {
      color: var(--accent-green);
    }

    .cobranza-valor.por-cobrar {
      color: var(--accent-orange);
    }

    .actividad-item {
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: var(--space-2);
      padding: var(--space-2) 0;
      border-bottom: 1px solid var(--border);
      align-items: center;
    }

    .actividad-item:last-child {
      border-bottom: none;
    }

    .actividad-tipo {
      font-size: 0.75rem;
      color: var(--text-secondary);
      text-transform: uppercase;
    }

    .actividad-resumen {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .actividad-fecha {
      font-size: 0.75rem;
      color: var(--text-tertiary);
    }

    .chip--small {
      font-size: 0.625rem;
      padding: 1px 6px;
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
export class ClienteDetalleComponent {
  readonly crm = inject(CrmService);

  readonly id = input.required<string>();

  readonly tipoLabel = CRM_CLIENTE_TIPO_LABEL;
  readonly estadoLabel = CRM_PROYECTO_ESTADO_LABEL;
  readonly estatusLabel = CRM_COTIZACION_ESTATUS_LABEL;
  readonly actividadTipoLabel = CRM_ACTIVIDAD_TIPO_LABEL;
  readonly pagoEstatusLabel = CRM_PAGO_ESTATUS_LABEL;

  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);

  readonly datos = computed(() => {
    const datos = this._datos();
    if (!datos) return null;
    return datos;
  });

  private readonly _datos = toSignal(
    this.crm.obtenerClientes().pipe(
      switchMap(() => {
        const clienteId = this.id();
        return combineLatest([
          this.crm.obtenerCliente(clienteId),
          this.crm.obtenerContactos(clienteId),
          this.crm
            .obtenerProyectos()
            .pipe(map((p) => p.filter((pr) => pr.clienteId === clienteId))),
          this.crm.obtenerCotizaciones().pipe(
            switchMap((cots) => {
              return this.crm.obtenerProyectos().pipe(
                map((proyectos) => {
                  const proyectosDelCliente = proyectos
                    .filter((p) => p.clienteId === clienteId)
                    .map((p) => p.id);
                  return cots.filter((c) =>
                    proyectosDelCliente.includes(c.proyectoId)
                  );
                })
              );
            })
          ),
          this.crm.obtenerPagos().pipe(
            switchMap((pagos) => {
              return this.crm.obtenerCotizaciones().pipe(
                switchMap((cots) => {
                  return this.crm.obtenerProyectos().pipe(
                    map((proyectos) => {
                      const proyectosDelCliente = proyectos
                        .filter((p) => p.clienteId === clienteId)
                        .map((p) => p.id);
                      const cotsDelCliente = cots
                        .filter((c) =>
                          proyectosDelCliente.includes(c.proyectoId)
                        )
                        .map((c) => c.id);
                      return pagos.filter((p) =>
                        cotsDelCliente.includes(p.cotizacionId)
                      );
                    })
                  );
                })
              );
            })
          ),
          this.crm.obtenerActividades(clienteId)
        ]).pipe(
          map(
            ([
              cliente,
              contactos,
              proyectos,
              cotizaciones,
              pagos,
              actividades
            ]) => {
              this.cargando.set(false);
              return {
                cliente,
                contactos,
                proyectos,
                cotizaciones,
                pagos,
                actividades
              };
            }
          )
        );
      }),
      catchError((err) => {
        this.cargando.set(false);
        this.error.set(err.message || 'Error al cargar cliente');
        return of(null);
      })
    )
  );

  readonly actividadesRecientes = computed(() => {
    const datos = this.datos();
    if (!datos) return [];
    return datos.actividades.slice(0, 5);
  });

  readonly pagado = computed(() => {
    const datos = this.datos();
    if (!datos) return 0;
    return datos.pagos
      .filter((p) => p.estatus === 'pagado')
      .reduce((sum, p) => sum + p.monto, 0);
  });

  readonly porCobrar = computed(() => {
    const datos = this.datos();
    if (!datos) return 0;
    return datos.pagos
      .filter((p) => p.estatus !== 'pagado')
      .reduce((sum, p) => sum + p.monto, 0);
  });
}
