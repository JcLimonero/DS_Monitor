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
  type CrmClienteTipo,
  type CrmCotizacionEstatus,
  type CrmProyectoEstado
} from '../../core/models/crm-nativo.model';
import { CrmService } from '../../core/sources/gateway/crm.service';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { IconComponent } from '../../ui/icon.component';
import { PageHeaderComponent } from '../../ui/page-header.component';
import { MoneyPipe, RelativePipe } from '../../ui/portal.pipes';

const TIPO_CLASE: Record<CrmClienteTipo, string> = {
  directo: 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200',
  intermediario:
    'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
  final:
    'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200'
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
    <pt-page-header [title]="datos()?.cliente?.nombre ?? 'Cliente'">
      <a class="btn" routerLink="/clientes">
        <pt-icon name="anterior" class="h-4 w-4" />
        Clientes
      </a>
    </pt-page-header>

    @if (cargando()) {
      <p class="py-8 text-center text-ink-muted">Cargando…</p>
    } @else if (error()) {
      <pt-empty-state icon="alerta" title="Error" [hint]="error()!" />
    } @else if (datos(); as d) {
      <div class="flex flex-col gap-4">
        <section class="card card-pad">
          <h2 class="mb-3 text-base font-semibold">Información</h2>
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p
                class="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                Tipo
              </p>
              <span class="chip mt-1" [class]="tipoClase[d.cliente.tipo]">
                {{ tipoLabel[d.cliente.tipo] }}
              </span>
            </div>
            @if (d.cliente.razonSocial) {
              <div>
                <p
                  class="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                  Razón social
                </p>
                <p class="mt-1 text-ink">{{ d.cliente.razonSocial }}</p>
              </div>
            }
            @if (d.cliente.rfc) {
              <div>
                <p
                  class="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                  RFC
                </p>
                <p class="mt-1 font-mono text-ink">{{ d.cliente.rfc }}</p>
              </div>
            }
            @if (d.cliente.driveFolderUrl) {
              <div>
                <p
                  class="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                  Carpeta Drive
                </p>
                <a
                  class="mt-1 inline-flex items-center gap-1 text-info hover:underline"
                  [href]="d.cliente.driveFolderUrl"
                  target="_blank"
                  rel="noopener">
                  <pt-icon name="externo" class="h-4 w-4" />
                  Abrir
                </a>
              </div>
            }
          </div>
        </section>

        <section class="card card-pad">
          <h2 class="mb-3 flex items-center gap-2 text-base font-semibold">
            Contactos
            <span class="chip bg-surface-muted text-ink-muted">{{
              d.contactos.length
            }}</span>
          </h2>
          @if (d.contactos.length === 0) {
            <p class="text-sm italic text-ink-muted">
              Sin contactos registrados
            </p>
          } @else {
            <div class="divide-y divide-line">
              @for (contacto of d.contactos; track contacto.id) {
                <div
                  class="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div>
                    <p class="flex flex-wrap items-center gap-2 font-medium">
                      {{ contacto.nombre }}
                      @if (contacto.esResponsableProyecto) {
                        <span class="chip bg-brand-soft text-brand"
                          >Responsable</span
                        >
                      }
                    </p>
                    @if (contacto.puesto) {
                      <p class="text-sm text-ink-muted">
                        {{ contacto.puesto }}
                      </p>
                    }
                  </div>
                  <div class="text-right text-sm">
                    @if (contacto.correo) {
                      <a
                        class="block text-info hover:underline"
                        [href]="'mailto:' + contacto.correo">
                        {{ contacto.correo }}
                      </a>
                    }
                    @if (contacto.telefono) {
                      <p class="text-ink-muted">{{ contacto.telefono }}</p>
                    }
                  </div>
                </div>
              }
            </div>
          }
        </section>

        <section class="card card-pad">
          <h2 class="mb-3 flex items-center gap-2 text-base font-semibold">
            Proyectos
            <span class="chip bg-surface-muted text-ink-muted">{{
              d.proyectos.length
            }}</span>
          </h2>
          @if (d.proyectos.length === 0) {
            <p class="text-sm italic text-ink-muted">Sin proyectos</p>
          } @else {
            <div class="flex flex-col gap-2">
              @for (proyecto of d.proyectos; track proyecto.id) {
                <a
                  class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-transparent px-3 py-2 transition hover:border-line hover:bg-surface-muted"
                  [routerLink]="['/proyectos', proyecto.id]">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="font-medium text-ink">{{
                      proyecto.nombre
                    }}</span>
                    @if (proyecto.estado) {
                      <span class="chip" [class]="estadoClase[proyecto.estado]">
                        {{ estadoLabel[proyecto.estado] }}
                      </span>
                    } @else {
                      <span class="chip bg-surface-muted text-ink-muted"
                        >Por confirmar</span
                      >
                    }
                  </div>
                  @if (proyecto.avancePct !== undefined) {
                    <div class="flex items-center gap-2">
                      <div
                        class="h-1.5 w-20 overflow-hidden rounded bg-surface-muted">
                        <div
                          class="h-full rounded bg-accent"
                          [style.width.%]="proyecto.avancePct"></div>
                      </div>
                      <span
                        class="w-9 text-right text-xs tabular-nums text-ink-muted"
                        >{{ proyecto.avancePct }}%</span
                      >
                    </div>
                  }
                </a>
              }
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
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="font-medium">
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
                    </div>
                    <span class="font-semibold tabular-nums">{{
                      cot.total | moneda: cot.moneda
                    }}</span>
                  </div>
                }
              </div>

              @if (crm.puedeVerCobranza()) {
                <div
                  class="mt-4 grid gap-3 border-t border-line pt-3 sm:grid-cols-2">
                  <div>
                    <p
                      class="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                      Pagado
                    </p>
                    <p class="text-xl font-semibold tabular-nums text-ok">
                      {{ pagado() | moneda }}
                    </p>
                  </div>
                  <div>
                    <p
                      class="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                      Por cobrar
                    </p>
                    <p class="text-xl font-semibold tabular-nums text-warn">
                      {{ porCobrar() | moneda }}
                    </p>
                  </div>
                </div>
              }
            }
          </section>
        }

        <section class="card card-pad">
          <h2 class="mb-3 flex items-center gap-2 text-base font-semibold">
            Actividad reciente
            <span class="chip bg-surface-muted text-ink-muted">{{
              d.actividades.length
            }}</span>
          </h2>
          @if (d.actividades.length === 0) {
            <p class="text-sm italic text-ink-muted">
              Sin actividades registradas
            </p>
          } @else {
            <div class="divide-y divide-line">
              @for (act of actividadesRecientes(); track act.id) {
                <div
                  class="grid grid-cols-[auto_1fr_auto] items-center gap-3 py-3">
                  <span class="text-xs font-medium uppercase text-ink-subtle">{{
                    actividadTipoLabel[act.tipo]
                  }}</span>
                  <span class="truncate text-ink">{{ act.resumen }}</span>
                  <span class="shrink-0 text-xs text-ink-muted">{{
                    act.fecha | relativo
                  }}</span>
                </div>
              }
            </div>
          }
        </section>
      </div>
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
  readonly tipoClase = TIPO_CLASE;
  readonly estatusCotClase = ESTATUS_COT_CLASE;
  readonly estadoClase = ESTADO_CLASE;

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
                  return cots.filter(
                    (c) =>
                      (c.proyectoId &&
                        proyectosDelCliente.includes(c.proyectoId)) ||
                      c.clienteId === clienteId
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
                        .filter(
                          (c) =>
                            (c.proyectoId &&
                              proyectosDelCliente.includes(c.proyectoId)) ||
                            c.clienteId === clienteId
                        )
                        .map((c) => c.id);
                      return pagos.filter(
                        (p) =>
                          (p.cotizacionId &&
                            cotsDelCliente.includes(p.cotizacionId)) ||
                          (p.proyectoId &&
                            proyectosDelCliente.includes(p.proyectoId))
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
      .filter((p) => p.estatus === 'pagado' && p.monto != null)
      .reduce((sum, p) => sum + (p.monto ?? 0), 0);
  });

  readonly porCobrar = computed(() => {
    const datos = this.datos();
    if (!datos) return 0;
    return datos.pagos
      .filter((p) => p.estatus !== 'pagado' && p.monto != null)
      .reduce((sum, p) => sum + (p.monto ?? 0), 0);
  });
}
