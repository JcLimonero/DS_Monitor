import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
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
  calcularSemaforo,
  ETAPA_LABEL,
  etapaEfectiva
} from '../../core/crm/crm-tablero';
import { EmpresasService } from '../../core/empresas/empresas.service';
import {
  CRM_PROYECTO_ESTADO_LABEL,
  CRM_COTIZACION_ESTATUS_LABEL,
  CRM_FUNCIONALIDAD_ESTADO_LABEL,
  CRM_FUENTE_AVANCE_LABEL,
  CRM_SEMAFORO_LABEL,
  CRM_TIPO_RIESGO_LABEL,
  type CrmAvanceProyecto,
  type CrmCambioEtapa,
  type CrmCliente,
  type CrmContacto,
  type CrmCotizacion,
  type CrmFactura,
  type CrmFuncionalidad,
  type CrmHito,
  type CrmOrdenCompra,
  type CrmPagoProgramado,
  type CrmPartida,
  type CrmProyecto,
  type CrmRiesgo
} from '../../core/models/crm-nativo.model';
import type { Person } from '../../core/models';
import { CrmService } from '../../core/sources/gateway/crm.service';
import { PuenteAdminService } from '../../core/sources/gateway/puente-admin.service';
import { PortalStore } from '../../core/state/portal.store';
import { DialogoComponent } from '../../ui/dialogo.component';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { IconComponent } from '../../ui/icon.component';
import { PageHeaderComponent } from '../../ui/page-header.component';
import { DecimalPipe } from '@angular/common';
import { DayPipe, MoneyPipe, RelativePipe } from '../../ui/portal.pipes';

interface DatosProyecto {
  proyecto: CrmProyecto;
  cliente: CrmCliente | null;
  clienteFinal: CrmCliente | null;
  responsable: CrmContacto | null;
  cotizaciones: CrmCotizacion[];
  funcionalidades: CrmFuncionalidad[];
  avances: CrmAvanceProyecto[];
  cambios: CrmCambioEtapa[];
  hitos: CrmHito[];
  riesgos: CrmRiesgo[];
  pagos: CrmPagoProgramado[];
  ordenes: CrmOrdenCompra[];
  facturas: CrmFactura[];
  partidas: CrmPartida[];
}

@Component({
  selector: 'pt-proyecto-detalle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    FormsModule,
    DialogoComponent,
    EmptyStateComponent,
    IconComponent,
    PageHeaderComponent,
    DayPipe,
    DecimalPipe,
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
              @if (d.proyecto.estado) {
                <span class="chip chip--estado-{{ d.proyecto.estado }}">
                  {{ estadoLabel[d.proyecto.estado] }}
                </span>
              } @else {
                <span class="chip chip--estado-por_confirmar">
                  Por confirmar
                </span>
              }
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
            @if (d.clienteFinal) {
              <div class="info-item">
                <span class="info-label">Cliente final</span>
                <a class="link" [routerLink]="['/clientes', d.clienteFinal.id]">
                  {{ d.clienteFinal.nombre }}
                </a>
              </div>
            }
            @if (empresaNombre()) {
              <div class="info-item">
                <span class="info-label">Empresa</span>
                <span class="info-valor">{{ empresaNombre() }}</span>
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
            <div class="info-item">
              <span class="info-label">Etapa comercial</span>
              <span class="chip">{{
                etapaLabel[etapaDe(d.proyecto) ?? 'por_confirmar']
              }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Semáforo</span>
              <span class="chip chip--semaforo-{{ semaforo() }}">
                {{ semaforoLabel[semaforo()] }}
              </span>
            </div>
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
                      @if (cot.estatus) {
                        <span class="chip chip--estatus-{{ cot.estatus }}">
                          {{ estatusLabel[cot.estatus] }}
                        </span>
                      }
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

        <!-- Linea de tiempo -->
        <section class="card seccion">
          <div class="seccion-header">
            <h3 class="seccion-titulo">Línea de tiempo</h3>
            @if (crm.puedeEditarProyectos()) {
              <button type="button" class="btn" (click)="abrirAvance()">
                <pt-icon name="mas" class="h-4 w-4" />
                Avance
              </button>
            }
          </div>
          @if (lineaTiempo().length === 0) {
            <p class="sin-datos">Sin avances ni cambios de etapa</p>
          } @else {
            <ul class="lista-items">
              @for (ev of lineaTiempo(); track ev.id) {
                <li class="contacto-item">
                  <div class="contacto-info">
                    <span class="contacto-nombre">{{ ev.titulo }}</span>
                    <span class="contacto-puesto">{{ ev.detalle }}</span>
                  </div>
                  <span class="text-xs text-ink-muted">{{
                    ev.fecha | relativo
                  }}</span>
                </li>
              }
            </ul>
          }
        </section>

        <!-- Hitos -->
        <section class="card seccion">
          <div class="seccion-header">
            <h3 class="seccion-titulo">
              Hitos
              <span class="badge">{{ d.hitos.length }}</span>
            </h3>
            @if (crm.puedeEditarProyectos()) {
              <button type="button" class="btn" (click)="abrirHito()">
                <pt-icon name="mas" class="h-4 w-4" />
                Hito
              </button>
            }
          </div>
          @if (d.hitos.length === 0) {
            <p class="sin-datos">Sin hitos</p>
          } @else {
            <div class="lista-items">
              @for (h of d.hitos; track h.id) {
                <div class="contacto-item">
                  <div class="contacto-info">
                    <span class="contacto-nombre">
                      {{ h.nombre }}
                      @if (h.completado) {
                        <span class="chip chip--autorizada">Hecho</span>
                      }
                    </span>
                    <span class="contacto-puesto">
                      Compromiso
                      {{ h.fechaCompromiso ? (h.fechaCompromiso | dia) : '—' }}
                      · Real
                      {{ h.fechaReal ? (h.fechaReal | dia) : '—' }}
                      @if (nombreDe(h.responsableId); as n) {
                        · {{ n }}
                      }
                    </span>
                  </div>
                </div>
              }
            </div>
          }
        </section>

        <!-- Riesgos -->
        <section class="card seccion">
          <div class="seccion-header">
            <h3 class="seccion-titulo">
              Riesgos y bloqueos
              <span class="badge">{{ riesgosAbiertos() }}</span>
            </h3>
            @if (crm.puedeEditarProyectos()) {
              <button type="button" class="btn" (click)="abrirRiesgo()">
                <pt-icon name="mas" class="h-4 w-4" />
                Riesgo
              </button>
            }
          </div>
          @if (d.riesgos.length === 0) {
            <p class="sin-datos">Sin riesgos</p>
          } @else {
            <div class="lista-items">
              @for (r of d.riesgos; track r.id) {
                <div class="contacto-item">
                  <div class="contacto-info">
                    <span class="contacto-nombre">
                      {{ r.descripcion }}
                      <span class="chip">{{ tipoRiesgoLabel[r.tipo] }}</span>
                    </span>
                    <span class="contacto-puesto">
                      {{ r.abierto ? 'Abierto' : 'Cerrado' }}
                      @if (nombreDe(r.responsableId); as n) {
                        · {{ n }}
                      }
                    </span>
                  </div>
                </div>
              }
            </div>
          }
        </section>

        <!-- Pendientes ligados -->
        @if (pendientesLigados().length > 0) {
          <section class="card seccion">
            <h3 class="seccion-titulo">Pendientes ligados</h3>
            <div class="lista-items">
              @for (t of pendientesLigados(); track t.id) {
                <a class="link" routerLink="/pendientes">{{ t.title }}</a>
              }
            </div>
          </section>
        }

        <!-- Proximos cobros -->
        @if (crm.puedeVerCobranza() && proximosCobros().length > 0) {
          <section class="card seccion">
            <h3 class="seccion-titulo">Próximos cobros</h3>
            <div class="lista-items">
              @for (p of proximosCobros(); track p.id) {
                <div class="cotizacion-item">
                  <span>
                    {{ p.nota ?? 'Pago' }}
                    ·
                    @if (p.fechaEsperada) {
                      {{ p.fechaEsperada | dia }}
                    } @else {
                      Por confirmar
                    }
                  </span>
                  <span class="cotizacion-monto">{{
                    p.monto | moneda: p.moneda
                  }}</span>
                </div>
              }
            </div>
          </section>
        }

        <!-- OC, facturas y margen -->
        @if (crm.puedeVerCobranza()) {
          <section class="card seccion">
            <h3 class="seccion-titulo">Órdenes de compra y facturas</h3>
            @if (d.ordenes.length === 0 && d.facturas.length === 0) {
              <p class="sin-datos">Sin OC ni facturas</p>
            } @else {
              @for (oc of d.ordenes; track oc.id) {
                <div class="cotizacion-item">
                  <span>OC {{ oc.folio }} {{ oc.periodo }}</span>
                  <span class="cotizacion-monto">{{
                    oc.monto | moneda: oc.moneda
                  }}</span>
                </div>
              }
              @for (f of d.facturas; track f.id) {
                <div class="cotizacion-item">
                  <span>Factura {{ f.folio ?? f.uuid }}</span>
                  <span class="cotizacion-monto">{{
                    f.total | moneda: f.moneda
                  }}</span>
                </div>
              }
            }
            @if (crm.puedeVerCostos() && margen(); as m) {
              <div class="cotizacion-total">
                <span>Margen</span>
                <span class="total-valor"
                  >{{ m.margen | moneda }} ({{
                    m.margenPct | number: '1.0-0'
                  }}%)</span
                >
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

    @if (dialogo(); as tipo) {
      <pt-dialogo
        [titulo]="
          tipo === 'avance'
            ? 'Registrar avance'
            : tipo === 'hito'
              ? 'Nuevo hito'
              : 'Nuevo riesgo'
        "
        (cerrar)="dialogo.set(null)">
        <form class="grid gap-3" (ngSubmit)="guardarDialogo()">
          @if (tipo === 'avance') {
            <label>
              <span class="mb-1 block text-xs font-medium text-ink-muted"
                >Nota</span
              >
              <textarea
                class="field"
                [(ngModel)]="formNota"
                name="nota"></textarea>
            </label>
            <label>
              <span class="mb-1 block text-xs font-medium text-ink-muted"
                >Avance %</span
              >
              <input
                class="field"
                type="number"
                min="0"
                max="100"
                [(ngModel)]="formPct"
                name="pct" />
            </label>
          }
          @if (tipo === 'hito') {
            <label>
              <span class="mb-1 block text-xs font-medium text-ink-muted"
                >Nombre</span
              >
              <input class="field" [(ngModel)]="formNombre" name="nombre" />
            </label>
            <label>
              <span class="mb-1 block text-xs font-medium text-ink-muted"
                >Fecha compromiso</span
              >
              <input
                class="field"
                type="date"
                [(ngModel)]="formFecha"
                name="fecha" />
            </label>
          }
          @if (tipo === 'riesgo') {
            <label>
              <span class="mb-1 block text-xs font-medium text-ink-muted"
                >Descripción</span
              >
              <textarea
                class="field"
                [(ngModel)]="formNota"
                name="desc"></textarea>
            </label>
            <label>
              <span class="mb-1 block text-xs font-medium text-ink-muted"
                >Tipo</span
              >
              <select class="field" [(ngModel)]="formTipo" name="tipo">
                <option value="riesgo">Riesgo</option>
                <option value="bloqueo">Bloqueo</option>
              </select>
            </label>
          }
          <label>
            <span class="mb-1 block text-xs font-medium text-ink-muted"
              >Responsable</span
            >
            <select class="field" [(ngModel)]="formResponsable" name="resp">
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
            [disabled]="!puedeGuardarDialogo()"
            (click)="guardarDialogo()">
            Guardar
          </button>
          <button type="button" class="btn" (click)="dialogo.set(null)">
            Cancelar
          </button>
        </div>
      </pt-dialogo>
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
    .chip--semaforo-en_tiempo {
      --chip-bg: var(--accent-green-bg);
      --chip-text: var(--accent-green);
    }
    .chip--semaforo-en_riesgo {
      --chip-bg: var(--accent-orange-bg);
      --chip-text: var(--accent-orange);
    }
    .chip--semaforo-atrasado {
      --chip-bg: var(--accent-red-bg);
      --chip-text: var(--accent-red);
    }
  `
})
export class ProyectoDetalleComponent {
  readonly crm = inject(CrmService);
  private readonly empresasSvc = inject(EmpresasService);
  private readonly admin = inject(PuenteAdminService);
  private readonly store = inject(PortalStore);

  readonly id = input.required<string>();
  private readonly id$ = toObservable(this.id);

  readonly estadoLabel = CRM_PROYECTO_ESTADO_LABEL;
  readonly estatusLabel = CRM_COTIZACION_ESTATUS_LABEL;
  readonly funcEstadoLabel = CRM_FUNCIONALIDAD_ESTADO_LABEL;
  readonly etapaLabel = ETAPA_LABEL;
  readonly semaforoLabel = CRM_SEMAFORO_LABEL;
  readonly tipoRiesgoLabel = CRM_TIPO_RIESGO_LABEL;
  readonly fuenteLabel = CRM_FUENTE_AVANCE_LABEL;

  readonly estadosFuncionalidad = [
    { key: 'por_hacer', label: 'Por hacer' },
    { key: 'en_progreso', label: 'En progreso' },
    { key: 'en_revision', label: 'En revisión' },
    { key: 'hecho', label: 'Hecho' }
  ] as const;

  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly dialogo = signal<'avance' | 'hito' | 'riesgo' | null>(null);
  formNota = '';
  formNombre = '';
  formFecha = '';
  formPct = 0;
  formTipo = 'riesgo';
  formResponsable = '';
  private readonly recarga = new Subject<void>();

  readonly equipo = toSignal(
    this.admin.disponible
      ? this.admin.equipo().pipe(catchError(() => of([] as Person[])))
      : of([] as Person[]),
    { initialValue: [] as Person[] }
  );

  private readonly _datos = toSignal(
    combineLatest([this.id$, this.recarga.pipe(startWith(undefined))]).pipe(
      switchMap(([proyectoId]) => {
        return combineLatest([
          this.crm.obtenerProyecto(proyectoId),
          this.crm.obtenerClientes().pipe(catchError(() => of([]))),
          this.crm.obtenerContactos().pipe(catchError(() => of([]))),
          this.crm
            .obtenerCotizaciones(proyectoId)
            .pipe(catchError(() => of([]))),
          this.crm
            .obtenerFuncionalidades(proyectoId)
            .pipe(catchError(() => of([]))),
          this.crm.obtenerAvances(proyectoId).pipe(catchError(() => of([]))),
          this.crm
            .obtenerCambiosEtapa(proyectoId)
            .pipe(catchError(() => of([]))),
          this.crm.obtenerHitos(proyectoId).pipe(catchError(() => of([]))),
          this.crm.obtenerRiesgos(proyectoId).pipe(catchError(() => of([]))),
          this.crm
            .obtenerPagos(undefined, proyectoId)
            .pipe(catchError(() => of([]))),
          this.crm
            .obtenerOrdenesCompra({ proyectoId })
            .pipe(catchError(() => of([]))),
          this.crm
            .obtenerFacturas({ proyectoId })
            .pipe(catchError(() => of([]))),
          this.crm
            .obtenerPartidas({ proyectoId })
            .pipe(catchError(() => of([])))
        ]).pipe(
          map(
            ([
              proyecto,
              clientes,
              contactos,
              cotizaciones,
              funcionalidades,
              avances,
              cambios,
              hitos,
              riesgos,
              pagos,
              ordenes,
              facturas,
              partidas
            ]) => {
              this.cargando.set(false);
              const cliente =
                clientes.find((c) => c.id === proyecto.clienteId) ?? null;
              const clienteFinal = proyecto.clienteFinalId
                ? (clientes.find((c) => c.id === proyecto.clienteFinalId) ??
                  null)
                : null;
              const responsable = proyecto.responsableClienteId
                ? (contactos.find(
                    (c) => c.id === proyecto.responsableClienteId
                  ) ?? null)
                : null;
              return {
                proyecto,
                cliente,
                clienteFinal,
                responsable,
                cotizaciones,
                funcionalidades,
                avances,
                cambios,
                hitos,
                riesgos,
                pagos,
                ordenes,
                facturas,
                partidas
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

  readonly empresaNombre = computed(() => {
    const id = this.datos()?.proyecto.empresaAtiendeId;
    if (!id) return undefined;
    return this.empresasSvc.lista().find((e) => e.id === id)?.nombre;
  });

  readonly semaforo = computed(() => {
    const d = this.datos();
    if (!d) return 'en_tiempo' as const;
    return calcularSemaforo(d.proyecto, d.hitos);
  });

  readonly riesgosAbiertos = computed(
    () => this.datos()?.riesgos.filter((r) => r.abierto).length ?? 0
  );

  readonly lineaTiempo = computed(() => {
    const d = this.datos();
    if (!d) return [];
    const evs = [
      ...d.avances.map((a) => ({
        id: `av-${a.id}`,
        fecha: a.fecha,
        titulo: a.nota,
        detalle: [
          this.fuenteLabel[a.fuente],
          a.avancePct !== undefined ? `${a.avancePct}%` : undefined,
          a.autor?.name
        ]
          .filter(Boolean)
          .join(' · ')
      })),
      ...d.cambios.map((c) => ({
        id: `ce-${c.id}`,
        fecha: c.fecha,
        titulo: `Etapa: ${this.etapaLabel[c.etapaNueva]}`,
        detalle: [c.autor?.name, c.nota].filter(Boolean).join(' · ')
      }))
    ];
    return evs.sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 20);
  });

  readonly proximosCobros = computed(() => {
    const d = this.datos();
    if (!d) return [];
    return d.pagos
      .filter((p) => p.estatus !== 'pagado')
      .sort((a, b) =>
        (a.fechaEsperada ?? '9999').localeCompare(b.fechaEsperada ?? '9999')
      )
      .slice(0, 6);
  });

  readonly pendientesLigados = computed(() => {
    const d = this.datos();
    if (!d) return [];
    const ids = new Set(
      d.funcionalidades.map((f) => f.pendienteId).filter(Boolean)
    );
    const nombre = d.proyecto.nombre.toLowerCase();
    return this.store
      .tasks()
      .filter(
        (t) =>
          t.status !== 'hecho' &&
          (ids.has(t.id) || t.project?.toLowerCase() === nombre)
      );
  });

  readonly margen = computed(() => {
    const d = this.datos();
    if (!d || d.partidas.length === 0) return null;
    const venta = d.partidas.reduce((s, p) => s + (p.importe ?? 0), 0);
    const costo = d.partidas.reduce((s, p) => s + (p.costoTotal ?? 0), 0);
    const margen = venta - costo;
    return { margen, margenPct: venta > 0 ? (margen / venta) * 100 : 0 };
  });

  readonly totalCotizado = computed(() => {
    const d = this.datos();
    if (!d) return 0;
    return d.cotizaciones.reduce((sum, c) => sum + (c.total ?? 0), 0);
  });

  etapaDe(proyecto: CrmProyecto) {
    return etapaEfectiva(proyecto);
  }

  nombreDe(id?: string): string | undefined {
    if (!id) return undefined;
    return this.equipo().find((p) => p.id === id)?.name;
  }

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

  abrirAvance(): void {
    this.formNota = '';
    this.formPct = this.datos()?.proyecto.avancePct ?? 0;
    this.formResponsable = '';
    this.dialogo.set('avance');
  }

  abrirHito(): void {
    this.formNombre = '';
    this.formFecha = '';
    this.formResponsable = '';
    this.dialogo.set('hito');
  }

  abrirRiesgo(): void {
    this.formNota = '';
    this.formTipo = 'riesgo';
    this.formResponsable = '';
    this.dialogo.set('riesgo');
  }

  puedeGuardarDialogo(): boolean {
    const tipo = this.dialogo();
    if (tipo === 'avance') return this.formNota.trim().length > 0;
    if (tipo === 'hito') {
      return !!this.formNombre.trim() && !!this.formResponsable;
    }
    if (tipo === 'riesgo') {
      return !!this.formNota.trim() && !!this.formResponsable;
    }
    return false;
  }

  guardarDialogo(): void {
    if (!this.puedeGuardarDialogo()) return;
    const proyectoId = this.id();
    const tipo = this.dialogo();
    const listo = () => {
      this.dialogo.set(null);
      this.recarga.next();
    };
    const fallo = (err: { error?: { error?: string }; message?: string }) => {
      this.error.set(err.error?.error ?? err.message ?? 'No se pudo guardar.');
    };
    if (tipo === 'avance') {
      this.crm
        .guardarAvance({
          proyectoId,
          nota: this.formNota.trim(),
          avancePct: Number(this.formPct) || undefined,
          fuente: 'manual'
        })
        .subscribe({ next: listo, error: fallo });
    } else if (tipo === 'hito') {
      this.crm
        .guardarHito({
          proyectoId,
          nombre: this.formNombre.trim(),
          fechaCompromiso: this.formFecha
            ? new Date(`${this.formFecha}T12:00:00`).toISOString()
            : undefined,
          completado: false,
          responsableId: this.formResponsable
        })
        .subscribe({ next: listo, error: fallo });
    } else if (tipo === 'riesgo') {
      this.crm
        .guardarRiesgo({
          proyectoId,
          tipo: this.formTipo === 'bloqueo' ? 'bloqueo' : 'riesgo',
          descripcion: this.formNota.trim(),
          abierto: true,
          fechaReporte: new Date().toISOString(),
          responsableId: this.formResponsable
        })
        .subscribe({ next: listo, error: fallo });
    }
  }
}
