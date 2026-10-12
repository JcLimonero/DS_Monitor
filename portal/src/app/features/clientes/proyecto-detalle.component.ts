import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
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
  type CrmCotizacionEstatus,
  type CrmFactura,
  type CrmFuncionalidad,
  type CrmHito,
  type CrmOrdenCompra,
  type CrmPagoProgramado,
  type CrmPartida,
  type CrmProyecto,
  type CrmProyectoEstado,
  type CrmRiesgo,
  type CrmSemaforoProyecto
} from '../../core/models/crm-nativo.model';
import type { Person } from '../../core/models';
import { CrmService } from '../../core/sources/gateway/crm.service';
import { PuenteAdminService } from '../../core/sources/gateway/puente-admin.service';
import { PortalStore } from '../../core/state/portal.store';
import { DialogoComponent } from '../../ui/dialogo.component';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { IconComponent } from '../../ui/icon.component';
import { PageHeaderComponent } from '../../ui/page-header.component';
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

const SEMAFORO_CLASE: Record<CrmSemaforoProyecto, string> = {
  en_tiempo:
    'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200',
  en_riesgo:
    'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
  atrasado: 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200'
};

const ESTATUS_COT_CLASE: Record<CrmCotizacionEstatus, string> = {
  borrador: 'bg-surface-muted text-ink-muted',
  enviada: 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200',
  aprobada:
    'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200',
  rechazada: 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200',
  vencida:
    'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
  obsoleta: 'bg-surface-muted text-ink-subtle',
  desconocido: 'bg-surface-muted text-ink-muted'
};

const ESTADO_CLASE: Record<CrmProyectoEstado, string> = {
  prospecto: 'bg-surface-muted text-ink-muted',
  en_cotizacion: 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200',
  aprobado:
    'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200',
  en_desarrollo:
    'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-200',
  en_pruebas:
    'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
  entregado:
    'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200',
  en_soporte: 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200',
  pausado: 'bg-surface-muted text-ink-subtle',
  cancelado: 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200',
  por_confirmar: 'bg-surface-muted text-ink-muted'
};

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
    <pt-page-header [title]="datos()?.proyecto?.nombre ?? 'Proyecto'">
      <a class="btn" [routerLink]="volverUrl()">
        <pt-icon name="anterior" class="h-4 w-4" />
        Volver
      </a>
    </pt-page-header>

    @if (cargando()) {
      <p class="py-8 text-center text-ink-muted">Cargando…</p>
    } @else if (error()) {
      <pt-empty-state icon="alerta" title="Error" [hint]="error()!" />
    } @else if (datos(); as d) {
      <div class="flex flex-col gap-4">
        <section class="card card-pad">
          <h2 class="mb-3 text-base font-semibold text-ink">Información</h2>
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p
                class="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                Estado
              </p>
              @if (d.proyecto.estado) {
                <span
                  class="chip mt-1"
                  [class]="estadoClase[d.proyecto.estado]">
                  {{ estadoLabel[d.proyecto.estado] }}
                </span>
              } @else {
                <span class="chip mt-1 bg-surface-muted text-ink-muted"
                  >Por confirmar</span
                >
              }
            </div>
            @if (d.cliente) {
              <div>
                <p
                  class="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                  Cliente
                </p>
                <a
                  class="mt-1 block text-info hover:underline"
                  [routerLink]="['/clientes', d.cliente.id]">
                  {{ d.cliente.nombre }}
                </a>
              </div>
            }
            @if (d.responsable) {
              <div>
                <p
                  class="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                  Responsable (cliente)
                </p>
                <p class="mt-1 text-ink">{{ d.responsable.nombre }}</p>
              </div>
            }
            @if (d.clienteFinal) {
              <div>
                <p
                  class="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                  Cliente final
                </p>
                <a
                  class="mt-1 block text-info hover:underline"
                  [routerLink]="['/clientes', d.clienteFinal.id]">
                  {{ d.clienteFinal.nombre }}
                </a>
              </div>
            }
            @if (empresaNombre()) {
              <div>
                <p
                  class="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                  Empresa
                </p>
                <p class="mt-1 text-ink">{{ empresaNombre() }}</p>
              </div>
            }
            @if (d.proyecto.responsableInterno) {
              <div>
                <p
                  class="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                  Responsable interno
                </p>
                <p class="mt-1 text-ink">
                  {{ d.proyecto.responsableInterno.name }}
                </p>
              </div>
            }
            <div>
              <p
                class="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                Etapa comercial
              </p>
              <span class="chip mt-1 bg-brand-soft text-brand">
                {{ etapaLabel[etapaDe(d.proyecto) ?? 'por_confirmar'] }}
              </span>
            </div>
            <div>
              <p
                class="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                Semáforo
              </p>
              <span class="chip mt-1" [class]="semaforoClase[semaforo()]">
                {{ semaforoLabel[semaforo()] }}
              </span>
            </div>
            @if (d.proyecto.fechaInicio) {
              <div>
                <p
                  class="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                  Inicio
                </p>
                <p class="mt-1 text-ink">{{ d.proyecto.fechaInicio | dia }}</p>
              </div>
            }
            @if (d.proyecto.fechaFinEstimada) {
              <div>
                <p
                  class="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                  Fin estimado
                </p>
                <p class="mt-1 text-ink">
                  {{ d.proyecto.fechaFinEstimada | dia }}
                </p>
              </div>
            }
          </div>

          @if (d.proyecto.avancePct !== undefined) {
            <div class="mt-4 border-t border-line pt-3">
              <div class="mb-2 flex items-center justify-between">
                <span class="text-sm text-ink-muted">Avance del proyecto</span>
                <span class="text-lg font-semibold tabular-nums text-accent"
                  >{{ d.proyecto.avancePct }}%</span
                >
              </div>
              <div class="h-2 overflow-hidden rounded bg-surface-muted">
                <div
                  class="h-full rounded bg-accent transition-all"
                  [style.width.%]="d.proyecto.avancePct"></div>
              </div>
            </div>
          }

          @if (d.proyecto.alcance) {
            <div class="mt-3">
              <p
                class="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                Alcance
              </p>
              <p class="mt-1 whitespace-pre-wrap text-ink-muted">
                {{ d.proyecto.alcance }}
              </p>
            </div>
          }
        </section>

        @if (crm.puedeVerCotizaciones()) {
          <section class="card card-pad">
            <h2 class="mb-3 flex items-center gap-2 text-base font-semibold">
              Cotizaciones
              <span class="chip bg-surface-muted text-ink-muted">{{
                d.cotizaciones.length
              }}</span>
            </h2>
            @if (d.cotizaciones.length === 0) {
              <p class="text-sm italic text-ink-muted">Sin cotizaciones</p>
            } @else {
              <div class="divide-y divide-line">
                @for (cot of d.cotizaciones; track cot.id) {
                  <div
                    class="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div class="flex min-w-0 flex-wrap items-center gap-2">
                      <span class="font-medium text-ink">
                        {{ cot.nombre }}
                        @if (cot.folio) {
                          <span class="font-normal text-ink-muted"
                            >({{ cot.folio }})</span
                          >
                        }
                      </span>
                      @if (cot.estatus) {
                        <span
                          class="chip"
                          [class]="estatusCotClase[cot.estatus]">
                          {{ estatusLabel[cot.estatus] }}
                        </span>
                      }
                      @if (cot.autorizadaPorCarlosEn) {
                        <span
                          class="chip bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200">
                          <pt-icon name="ok" class="h-3 w-3" />
                          Autorizada
                        </span>
                      }
                    </div>
                    <span class="shrink-0 font-semibold tabular-nums">{{
                      cot.total | moneda: cot.moneda
                    }}</span>
                  </div>
                }
              </div>
              <div
                class="mt-3 flex items-center justify-between border-t border-line pt-3 font-medium">
                <span>Total cotizado</span>
                <span class="text-lg tabular-nums text-accent">{{
                  totalCotizado() | moneda
                }}</span>
              </div>
            }
          </section>
        }

        @if (crm.puedeVerDesarrollo()) {
          <section class="card card-pad">
            <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 class="flex items-center gap-2 text-base font-semibold">
                Funcionalidades
                <span class="chip bg-surface-muted text-ink-muted">{{
                  d.funcionalidades.length
                }}</span>
              </h2>
              <a
                class="btn"
                routerLink="/desarrollo"
                [queryParams]="{ proyecto: id() }">
                Ver tablero
              </a>
            </div>
            @if (d.funcionalidades.length === 0) {
              <p class="text-sm italic text-ink-muted">Sin funcionalidades</p>
            } @else {
              <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
                @for (estado of estadosFuncionalidad; track estado.key) {
                  <div
                    class="rounded-lg bg-surface-muted px-3 py-3 text-center">
                    <p class="text-2xl font-semibold tabular-nums">
                      {{ contarFuncionalidades(estado.key) }}
                    </p>
                    <p class="text-xs text-ink-muted">{{ estado.label }}</p>
                  </div>
                }
              </div>
            }
          </section>
        }

        <section class="card card-pad">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-base font-semibold">Línea de tiempo</h2>
            @if (crm.puedeEditarProyectos()) {
              <button type="button" class="btn" (click)="abrirAvance()">
                <pt-icon name="mas" class="h-4 w-4" />
                Avance
              </button>
            }
          </div>
          @if (lineaTiempo().length === 0) {
            <p class="text-sm italic text-ink-muted">
              Sin avances ni cambios de etapa
            </p>
          } @else {
            <ul class="divide-y divide-line">
              @for (ev of lineaTiempo(); track ev.id) {
                <li
                  class="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div class="min-w-0">
                    <p class="font-medium text-ink">{{ ev.titulo }}</p>
                    <p class="text-sm text-ink-muted">{{ ev.detalle }}</p>
                  </div>
                  <span class="shrink-0 text-xs text-ink-muted">{{
                    ev.fecha | relativo
                  }}</span>
                </li>
              }
            </ul>
          }
        </section>

        <section class="card card-pad">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 class="flex items-center gap-2 text-base font-semibold">
              Hitos
              <span class="chip bg-surface-muted text-ink-muted">{{
                d.hitos.length
              }}</span>
            </h2>
            @if (crm.puedeEditarProyectos()) {
              <button type="button" class="btn" (click)="abrirHito()">
                <pt-icon name="mas" class="h-4 w-4" />
                Hito
              </button>
            }
          </div>
          @if (d.hitos.length === 0) {
            <p class="text-sm italic text-ink-muted">Sin hitos</p>
          } @else {
            <div class="divide-y divide-line">
              @for (h of d.hitos; track h.id) {
                <div class="py-3">
                  <p class="flex flex-wrap items-center gap-2 font-medium">
                    {{ h.nombre }}
                    @if (h.completado) {
                      <span
                        class="chip bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200"
                        >Hecho</span
                      >
                    }
                  </p>
                  <p class="text-sm text-ink-muted">
                    Compromiso
                    {{ h.fechaCompromiso ? (h.fechaCompromiso | dia) : '—' }}
                    · Real {{ h.fechaReal ? (h.fechaReal | dia) : '—' }}
                    @if (nombreDe(h.responsableId); as n) {
                      · {{ n }}
                    }
                  </p>
                </div>
              }
            </div>
          }
        </section>

        <section class="card card-pad">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 class="flex items-center gap-2 text-base font-semibold">
              Riesgos y bloqueos
              <span class="chip bg-surface-muted text-ink-muted">{{
                riesgosAbiertos()
              }}</span>
            </h2>
            @if (crm.puedeEditarProyectos()) {
              <button type="button" class="btn" (click)="abrirRiesgo()">
                <pt-icon name="mas" class="h-4 w-4" />
                Riesgo
              </button>
            }
          </div>
          @if (d.riesgos.length === 0) {
            <p class="text-sm italic text-ink-muted">Sin riesgos</p>
          } @else {
            <div class="divide-y divide-line">
              @for (r of d.riesgos; track r.id) {
                <div class="py-3">
                  <p class="flex flex-wrap items-center gap-2 font-medium">
                    {{ r.descripcion }}
                    <span
                      class="chip"
                      [class]="
                        r.tipo === 'bloqueo'
                          ? 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200'
                          : 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200'
                      ">
                      {{ tipoRiesgoLabel[r.tipo] }}
                    </span>
                    @if (!r.abierto) {
                      <span class="chip bg-surface-muted text-ink-muted"
                        >Cerrado</span
                      >
                    }
                  </p>
                  <p class="text-sm text-ink-muted">
                    {{ r.abierto ? 'Abierto' : 'Cerrado' }}
                    @if (nombreDe(r.responsableId); as n) {
                      · {{ n }}
                    }
                  </p>
                </div>
              }
            </div>
          }
        </section>

        @if (pendientesLigados().length > 0) {
          <section class="card card-pad">
            <h2 class="mb-3 text-base font-semibold">Pendientes ligados</h2>
            <div class="flex flex-col gap-2">
              @for (t of pendientesLigados(); track t.id) {
                <a class="text-info hover:underline" routerLink="/pendientes">{{
                  t.title
                }}</a>
              }
            </div>
          </section>
        }

        @if (crm.puedeVerCobranza() && proximosCobros().length > 0) {
          <section class="card card-pad">
            <h2 class="mb-3 text-base font-semibold">Próximos cobros</h2>
            <div class="divide-y divide-line">
              @for (p of proximosCobros(); track p.id) {
                <div class="flex items-center justify-between gap-3 py-3">
                  <span class="text-ink">
                    {{ p.nota ?? 'Pago' }}
                    ·
                    @if (p.fechaEsperada) {
                      {{ p.fechaEsperada | dia }}
                    } @else {
                      Por confirmar
                    }
                  </span>
                  <span class="font-semibold tabular-nums">{{
                    p.monto | moneda: p.moneda
                  }}</span>
                </div>
              }
            </div>
          </section>
        }

        @if (crm.puedeVerCobranza()) {
          <section class="card card-pad">
            <h2 class="mb-3 text-base font-semibold">
              Órdenes de compra y facturas
            </h2>
            @if (d.ordenes.length === 0 && d.facturas.length === 0) {
              <p class="text-sm italic text-ink-muted">Sin OC ni facturas</p>
            } @else {
              <div class="divide-y divide-line">
                @for (oc of d.ordenes; track oc.id) {
                  <div class="flex items-center justify-between gap-3 py-3">
                    <span>OC {{ oc.folio }} {{ oc.periodo }}</span>
                    <span class="font-semibold tabular-nums">{{
                      oc.monto | moneda: oc.moneda
                    }}</span>
                  </div>
                }
                @for (f of d.facturas; track f.id) {
                  <div class="flex items-center justify-between gap-3 py-3">
                    <span>Factura {{ f.folio ?? f.uuid }}</span>
                    <span class="font-semibold tabular-nums">{{
                      f.total | moneda: f.moneda
                    }}</span>
                  </div>
                }
              </div>
            }
            @if (crm.puedeVerCostos() && margen(); as m) {
              <div
                class="mt-3 flex items-center justify-between border-t border-line pt-3 font-medium">
                <span>Margen</span>
                <span class="tabular-nums text-accent"
                  >{{ m.margen | moneda }} ({{
                    m.margenPct | number: '1.0-0'
                  }}%)</span
                >
              </div>
            }
          </section>
        }

        @if (d.proyecto.driveUrl || d.proyecto.repos?.length) {
          <section class="card card-pad">
            <h2 class="mb-3 text-base font-semibold">Enlaces</h2>
            <div class="flex flex-wrap gap-2">
              @if (d.proyecto.driveUrl) {
                <a
                  class="btn"
                  [href]="d.proyecto.driveUrl"
                  target="_blank"
                  rel="noopener">
                  <pt-icon name="externo" class="h-4 w-4" />
                  Google Drive
                </a>
              }
              @for (repo of d.proyecto.repos ?? []; track repo) {
                <a class="btn" [href]="repo" target="_blank" rel="noopener">
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
  readonly semaforoClase = SEMAFORO_CLASE;
  readonly estatusCotClase = ESTATUS_COT_CLASE;
  readonly estadoClase = ESTADO_CLASE;

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
              } satisfies DatosProyecto;
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
