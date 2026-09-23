import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
  viewChild,
  DestroyRef
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IaService, describirError } from '../core/ia/ia.service';
import { SesionService } from '../core/acceso/sesion.service';
import { PuenteAdminService } from '../core/sources/gateway/puente-admin.service';
import { AvisosService } from '../core/avisos/avisos.service';
import { ElementRef, effect } from '@angular/core';
import { Borrador } from '../core/ia/ia.models';
import { EmpresasService } from '../core/empresas/empresas.service';
import { ProveedoresService } from '../core/proveedores/proveedores.service';
import { ACCOUNT_CHIP_CLASS } from './account-colors';
import {
  SENDER_KIND_LABEL,
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  Person,
  TaskItem,
  TaskOrigin,
  TaskPriority,
  TaskStatus,
  TaskUnread
} from '../core/models';
import { LocalTaskStore } from '../core/sources/local/local-task.store';
import { PortalStore } from '../core/state/portal.store';
import { isOverdue } from '../core/util/date.util';
import { MAX_FOTOS } from '../core/util/fotos.util';
import { sinPrefijosDeCorreo } from '../core/util/text.util';
import { DetalleEditorComponent } from './detalle-editor.component';
import { FotosPendienteComponent } from './fotos-pendiente.component';
import {
  CLASE_PLAZO,
  PUNTO_PLAZO,
  textoPlazo,
  tonoPlazo
} from '../core/util/plazo.util';
import { ACCOUNT_BAR_CLASS } from './account-colors';
import { AccountChipComponent } from './account-chip.component';
import { IconComponent } from './icon.component';
import { DayPipe, RelativePipe, TimePipe } from './portal.pipes';

const PRIORITY_CLASS: Record<TaskPriority, string> = {
  urgente: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  alta: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  media: 'bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300',
  baja: 'bg-slate-100 text-slate-500 dark:bg-slate-500/10 dark:text-slate-400'
};

const STATUS_CLASS: Record<TaskStatus, string> = {
  pendiente: 'text-ink-muted',
  en_progreso: 'text-info',
  bloqueado: 'text-danger',
  hecho: 'text-ok'
};

/** El origen en minúsculas, para el chip "cuenta · origen". */
const ORIGIN_SHORT: Record<TaskOrigin, string> = {
  odoo: 'Odoo',
  ops: 'Ops',
  correo: 'correo',
  local: 'propio'
};

/** Cuanto dura la pregunta "¿Borrar?" antes de volver al icono. */
const ESPERA_BORRAR_MS = 5000;

/**
 * Renglon de pendiente. Lo comparten el panel, la lista y la vista de equipo.
 *
 * Cerrado enseña lo esencial; abierto (clic en el título) deja comentar,
 * marcar hecho, asignar a alguien del equipo y, si vino por correo, pedir un
 * borrador de respuesta. Todo eso se guarda en el puente y aplica a cualquier
 * origen: correo, Ops, Odoo o propios.
 *
 * Los metadatos van siempre en el mismo orden (fecha, estado, responsable,
 * prioridad, cuenta · origen) para que se lean igual aquí, en Hoy y en Equipo.
 */
@Component({
  selector: 'pt-task-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AccountChipComponent,
    FormsModule,
    IconComponent,
    RouterLink,
    DayPipe,
    TimePipe,
    RelativePipe,
    DetalleEditorComponent,
    FotosPendienteComponent
  ],
  template: `
    <article
      class="relative overflow-hidden rounded-lg border border-line bg-surface px-4 py-3 transition hover:border-brand/40"
      [class.border-brand]="open()">
      <span class="account-bar" [class]="barClass()"></span>
      <div class="flex items-start gap-3 pl-2">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <button
              type="button"
              class="text-left text-sm font-medium text-ink hover:underline"
              [class.line-through]="done()"
              [class.text-ink-subtle]="done()"
              (click)="open.set(!open())">
              {{ titulo() }}
            </button>
            @if (task().company; as company) {
              <span class="chip" [class]="companyClass()">{{ company }}</span>
            }
            @if (task().unread; as u) {
              <!-- Llegó un correo del hilo, contestó el equipo, o es un
                   pendiente nuevo (junta Fireflies); se quita al abrir. -->
              <span
                class="chip"
                [class]="
                  u.kind === 'respuesta'
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200'
                    : u.kind === 'nuevo'
                      ? 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200'
                      : 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200'
                "
                [title]="
                  u.kind === 'respuesta'
                    ? 'Respuesta del responsable: ' + u.text
                    : u.kind === 'nuevo'
                      ? 'Pendiente nuevo; se quita al abrirlo'
                      : u.text
                ">
                <pt-icon
                  [name]="
                    u.kind === 'respuesta'
                      ? 'enviar'
                      : u.kind === 'nuevo'
                        ? 'alerta'
                        : 'bandeja'
                  "
                  class="h-3.5 w-3.5" />
                {{
                  u.kind === 'respuesta'
                    ? 'Respondió el responsable'
                    : u.kind === 'nuevo'
                      ? 'Nuevo'
                      : 'Novedad por correo'
                }}
              </span>
            }
            @if (task().updateRequested; as r) {
              <!-- Se les pidió actualización y nadie ha contestado. -->
              <span
                class="chip bg-surface-muted text-ink-muted"
                [title]="'Se pidió a ' + r.to.join(', ')">
                <pt-icon name="reloj" class="h-3.5 w-3.5" />
                Actualización pedida {{ r.at | relativo }}
              </span>
            }
            @if (done()) {
              <span
                class="chip bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
                <pt-icon name="ok" class="h-3.5 w-3.5" />
                Hecho
              </span>
            }
            @if (overdue()) {
              <span
                class="chip bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                Vencido
              </span>
            }
            @if (task().reassignRequest) {
              <span
                class="chip bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">
                Pide reasignar
              </span>
            }
            @if (comments().length > 0) {
              <span class="chip bg-surface-muted text-ink-muted">
                {{ comments().length }}
                {{ comments().length === 1 ? 'comentario' : 'comentarios' }}
              </span>
            }
            <!-- Abierto: hecho o reabrir de un clic, sin pasar por el selector. -->
            @if (open() && puedeMarcar()) {
              @if (done()) {
                <button
                  type="button"
                  class="btn ml-auto h-10 px-3 text-xs lg:h-8"
                  [disabled]="saving()"
                  (click)="toggle()">
                  Reabrir
                </button>
              } @else {
                <button
                  type="button"
                  class="btn btn-primary ml-auto h-10 px-3 text-xs lg:h-8"
                  [disabled]="saving()"
                  (click)="toggle()">
                  <pt-icon name="ok" class="h-3.5 w-3.5" />
                  Marcar hecho
                </button>
              }
            }
          </div>

          @if (task().description) {
            <p
              class="mt-1 whitespace-pre-line break-words text-sm text-ink-muted"
              [class.line-clamp-2]="!open()">
              {{ task().description }}
            </p>
          }
          @if (!editing()) {
            <pt-fotos-pendiente
              [urls]="task().imagenes"
              [compact]="!open()"
              [editable]="open() && puedeFotos()"
              [disabled]="saving()"
              (imagenesChange)="guardarFotos($event)" />
          }

          <!-- Orden fijo: fecha, estado, responsable, prioridad, cuenta · origen. -->
          <div
            class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
            @if (puedeFecha()) {
              <label class="inline-flex items-center gap-1">
                <input
                  class="h-10 rounded border border-line bg-surface px-1 text-xs text-ink lg:h-8"
                  type="date"
                  [disabled]="saving()"
                  [ngModel]="fechaValor()"
                  (ngModelChange)="cambiarFecha($event)"
                  name="fecha-{{ task().id }}"
                  aria-label="Fecha del pendiente" />
                @if (task().dueDate) {
                  <span
                    class="font-medium"
                    [class]="done() ? 'text-ink-subtle' : clasePlazo()">
                    {{ textoPlazo() }}
                  </span>
                }
              </label>
            } @else if (task().dueDate; as due) {
              <span
                class="inline-flex items-center gap-1 font-medium"
                [class]="done() ? 'text-ink-subtle' : clasePlazo()">
                <span
                  class="h-2 w-2 rounded-full"
                  [class]="done() ? 'bg-ink-subtle' : puntoPlazo()"></span>
                {{ due | dia
                }}{{ task().dueHasTime ? ' ' + (due | hora) : '' }} ·
                {{ textoPlazo() }}
              </span>
            }
            @if (ia.disponible) {
              <select
                class="h-10 rounded border border-line bg-surface px-1 text-xs font-medium lg:h-8"
                [class]="statusClass()"
                [disabled]="saving()"
                [ngModel]="task().status"
                (ngModelChange)="cambiarEstado($event)"
                name="estado-{{ task().id }}"
                aria-label="Estado">
                @for (e of estados; track e) {
                  <option [value]="e">{{ statusLabels[e] }}</option>
                }
              </select>
            } @else {
              <span [class]="statusClass()">{{ statusLabel() }}</span>
            }
            @if (ia.disponible && ia.equipo().length > 0) {
              <!-- Responsable de tres formas: Mío (me lo asigno, sin correo si
                   nadie más sigue), el selector (avisa de inmediato) o Varios…
                   (principal y quiénes dan seguimiento; un solo correo con copia). -->
              <span class="inline-flex flex-wrap items-center gap-1">
                <pt-icon name="equipo" class="h-3.5 w-3.5" />
                @if (yo()) {
                  <button
                    type="button"
                    class="btn h-10 gap-1 px-2 text-xs lg:h-8"
                    [class.btn-activo]="esMio()"
                    [disabled]="saving() || esMio()"
                    title="Asignármelo"
                    aria-label="Asignármelo"
                    (click)="asignarmelo()">
                    <pt-icon name="usuario" class="h-3.5 w-3.5" />
                    Mío
                  </button>
                }
                <select
                  class="h-10 max-w-40 rounded border border-line bg-surface px-1 text-xs text-ink lg:h-8"
                  [class.text-ink-subtle]="!task().assignee"
                  [disabled]="saving()"
                  [ngModel]="responsableValor()"
                  (ngModelChange)="reasignar($event)"
                  name="resp-{{ task().id }}"
                  aria-label="Responsable">
                  <option value="">Sin asignar</option>
                  @for (p of ia.equipo(); track p.id) {
                    <option [value]="p.email ?? p.id">{{ p.name }}</option>
                  }
                </select>
                @if (!task().personal) {
                  <button
                    type="button"
                    class="btn h-10 gap-1 px-2 text-xs lg:h-8"
                    [class.btn-activo]="!!varios()"
                    [disabled]="saving()"
                    title="Elegir responsable principal y quiénes dan seguimiento; un solo correo con copia"
                    aria-label="Varios responsables"
                    (click)="abrirVarios()">
                    <pt-icon name="equipo" class="h-3.5 w-3.5" />
                    Varios…
                  </button>
                }
              </span>
            } @else if (ia.disponible && !task().assignee) {
              <!-- Con puente pero sin equipo capturado: el selector saldria vacio. -->
              <a
                routerLink="/integraciones"
                [queryParams]="{ tab: 'equipo' }"
                class="inline-flex items-center gap-1 rounded px-1 text-brand transition hover:bg-surface-muted hover:underline">
                <pt-icon name="equipo" class="h-3.5 w-3.5" />
                Captura tu equipo para asignar
              </a>
            } @else {
              <button
                type="button"
                class="inline-flex items-center gap-1 rounded px-1 transition hover:bg-surface-muted hover:text-ink"
                [class.text-ink-subtle]="!task().assignee"
                (click)="abrirAsignar()">
                <pt-icon name="equipo" class="h-3.5 w-3.5" />
                {{ task().assignee?.name ?? 'Sin asignar · asignar' }}
              </button>
            }
            @if (seguidores().length > 0) {
              <span
                class="text-ink-subtle"
                [title]="'También: ' + nombresSeguidores()">
                +{{ seguidores().length }}
              </span>
            }
            @if (!task().assignee && task().suggestedAssignee; as sg) {
              <!-- La IA propone; un clic asigna (y avisa), la × descarta. -->
              <!-- Botones con area tactil de 40 px en celular; compactos en escritorio. -->
              <span
                class="inline-flex items-center gap-1 rounded bg-brand/10 px-1.5 py-0.5 text-xs text-ink"
                [title]="sg.reason">
                <span class="text-brand">✦</span>
                <span class="whitespace-nowrap"
                  >Sugerido: <strong>{{ sg.person.name }}</strong></span
                >
                <button
                  type="button"
                  class="ml-0.5 inline-flex min-h-10 min-w-10 items-center justify-center rounded px-1.5 font-medium text-brand transition hover:bg-brand/10 hover:underline lg:min-h-0 lg:min-w-0"
                  [disabled]="saving()"
                  (click)="asignarSugerido()">
                  Asignar
                </button>
                <button
                  type="button"
                  class="inline-flex min-h-10 min-w-10 items-center justify-center rounded px-1 text-base leading-none text-ink-subtle transition hover:text-ink lg:min-h-0 lg:min-w-0"
                  aria-label="Descartar sugerencia"
                  title="Descartar sugerencia"
                  [disabled]="saving()"
                  (click)="descartarSugerencia()">
                  ×
                </button>
              </span>
            }
            <span class="chip" [class]="priorityClass()">{{
              priorityLabel()
            }}</span>
            <pt-account-chip
              [accountId]="task().accountId"
              [sufijo]="origenCorto()" />
            @for (cuenta of task().alsoIn ?? []; track cuenta) {
              <pt-account-chip [accountId]="cuenta" />
            }
            @if (task().senderKind; as kind) {
              <!-- El chip del remitente abre "Quién lo pide" en el formulario de edición. -->
              <button
                type="button"
                class="chip"
                [class]="
                  kind === 'por_identificar'
                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200'
                    : kind === 'equipo'
                      ? 'bg-sky-100 text-sky-800 dark:bg-stone-500/20 dark:text-stone-200'
                      : 'bg-surface-muted text-ink-muted'
                "
                [disabled]="!ia.disponible"
                title="Cambiar quién lo pide"
                (click)="abrirRemitente()">
                {{ senderLabel[kind] }}
              </button>
            }
            @if (task().project; as project) {
              <span class="chip" [class]="projectClass()">{{ project }}</span>
            }
          </div>

          @if (varios(); as v) {
            <!-- Varios…: principal del selector, seguimiento por chips; al
                 guardar, un solo correo (principal, copia a los demás). -->
            <div
              class="mt-2 grid gap-3 rounded-lg border border-line bg-surface-muted p-3 text-xs"
              role="group"
              aria-label="Responsables del pendiente">
              <label class="sm:max-w-xs">
                <span class="mb-1 block font-medium text-ink-muted"
                  >Responsable principal</span
                >
                <select
                  class="field h-10 lg:h-8"
                  [ngModel]="v.principal"
                  (ngModelChange)="patchVarios({ principal: $event })"
                  name="varios-resp-{{ task().id }}">
                  <option value="">Sin responsable</option>
                  @for (p of ia.equipo(); track p.id) {
                    <option [value]="clave(p)">{{ p.name }}</option>
                  }
                </select>
              </label>
              <div>
                <span class="mb-1 block font-medium text-ink-muted"
                  >También dan seguimiento (van con copia)</span
                >
                <div
                  class="flex flex-wrap gap-1.5"
                  role="group"
                  aria-label="Quiénes dan seguimiento">
                  @for (p of ia.equipo(); track p.id) {
                    @if (clave(p) !== v.principal) {
                      <button
                        type="button"
                        class="inline-flex min-h-10 items-center rounded-full border px-3 font-medium transition lg:min-h-8"
                        [class]="
                          sigue(v, p)
                            ? 'border-brand bg-brand/10 text-ink'
                            : 'border-line bg-surface text-ink-muted hover:text-ink'
                        "
                        [attr.aria-pressed]="sigue(v, p)"
                        [disabled]="saving()"
                        (click)="toggleSeguidor(p)">
                        {{ sigue(v, p) ? '✓ ' : '' }}{{ p.name }}
                      </button>
                    }
                  }
                </div>
              </div>
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class="btn btn-primary"
                  [disabled]="saving()"
                  (click)="guardarVarios()">
                  Guardar y avisar
                </button>
                <button
                  type="button"
                  class="btn"
                  [disabled]="saving()"
                  (click)="varios.set(undefined)">
                  Cancelar
                </button>
              </div>
            </div>
          }

          @if (open()) {
            <div class="mt-3 space-y-3 border-t border-line pt-3">
              @if (respuestaVista(); as u) {
                <!-- Lo que contestó el equipo, a la vista mientras la tarjeta
                     esté abierta (el chip ya se quitó al abrirla). -->
                <p
                  class="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-100">
                  <pt-icon
                    name="enviar"
                    class="mr-1 h-3.5 w-3.5 align-middle" />
                  {{ u.text }}
                  <span
                    class="text-xs text-emerald-800/70 dark:text-emerald-200/70"
                    >· {{ u.at | relativo }}</span
                  >
                </p>
              }
              @if (task().subtareas?.length) {
                <div class="space-y-2">
                  <p
                    class="text-xs font-medium uppercase tracking-wide text-ink-muted">
                    Acuerdos de la junta
                  </p>
                  <ul class="space-y-2">
                    @for (s of task().subtareas!; track s.id) {
                      <li
                        class="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-line bg-surface-muted/40 px-3 py-2">
                        <div class="min-w-0 flex-1">
                          <p class="text-sm text-ink">{{ s.titulo }}</p>
                          <div class="mt-1 flex flex-wrap gap-1">
                            @for (r of s.responsables ?? []; track r.id) {
                              <span class="chip bg-surface text-ink-muted">{{
                                r.name
                              }}</span>
                            }
                            @if (
                              !s.responsables?.length && s.responsableEtiqueta
                            ) {
                              <span
                                class="chip bg-surface text-ink-subtle"
                                [title]="'Según Fireflies; no emparejó con el equipo'"
                                >{{ s.responsableEtiqueta }}</span
                              >
                            }
                          </div>
                        </div>
                        @if (s.convertida) {
                          <span
                            class="chip bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
                            [title]="
                              s.pendienteId
                                ? 'Pendiente: ' + s.pendienteId
                                : 'Ya convertido'
                            "
                            >Ya es pendiente</span
                          >
                        } @else if (ia.disponible) {
                          <button
                            type="button"
                            class="btn btn-primary shrink-0"
                            [disabled]="saving() || convirtiendo() === s.id"
                            (click)="convertirSubtarea(s.id)">
                            {{
                              convirtiendo() === s.id
                                ? 'Convirtiendo…'
                                : 'Convertir en pendiente'
                            }}
                          </button>
                        }
                      </li>
                    }
                  </ul>
                </div>
              }
              @if (task().reassignRequest; as r) {
                <div
                  class="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-500/10">
                  <p
                    class="text-sm font-medium text-amber-900 dark:text-amber-200">
                    {{ r.by }} pide que se reasigne
                    <span
                      class="font-normal text-amber-800/80 dark:text-amber-200/70">
                      · {{ r.at | relativo }}
                    </span>
                  </p>
                  @if (r.reason) {
                    <p
                      class="mt-1 text-sm text-amber-900/90 dark:text-amber-100/80">
                      “{{ r.reason }}”
                    </p>
                  }
                  <div class="mt-2 flex flex-wrap items-end gap-2">
                    <label class="min-w-40">
                      <span
                        class="mb-1 block text-xs font-medium text-ink-muted"
                        >Reasignar a</span
                      >
                      <select
                        class="field"
                        [ngModel]="reasignarA()"
                        (ngModelChange)="reasignarA.set($event)"
                        name="reasig-{{ task().id }}">
                        <option value="">Elige a alguien</option>
                        @for (p of ia.equipo(); track p.id) {
                          @if (p.name !== r.by) {
                            <option [value]="p.email ?? p.id">
                              {{ p.name }}
                            </option>
                          }
                        }
                      </select>
                    </label>
                    <label class="min-w-0 flex-1">
                      <span
                        class="mb-1 block text-xs font-medium text-ink-muted"
                        >Nota para quien lo pidió (opcional)</span
                      >
                      <input
                        class="field"
                        type="text"
                        [ngModel]="notaDecision()"
                        (ngModelChange)="notaDecision.set($event)"
                        name="nota-reasig-{{ task().id }}" />
                    </label>
                    <button
                      type="button"
                      class="btn btn-primary"
                      [disabled]="saving() || !reasignarA()"
                      (click)="decidirReasignacion('aprobar')">
                      Aprobar y reasignar
                    </button>
                    <button
                      type="button"
                      class="btn"
                      [disabled]="saving()"
                      (click)="decidirReasignacion('rechazar')">
                      Rechazar
                    </button>
                  </div>
                </div>
              }
              @if (
                ia.disponible && ia.equipo().length > 0 && !task().personal
              ) {
                <!-- Además del responsable, quiénes le dan seguimiento. -->
                <div
                  class="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                  <span>También da seguimiento:</span>
                  @for (p of seguidores(); track p.id) {
                    <span class="chip bg-surface-muted text-ink">
                      <span class="whitespace-nowrap">{{ p.name }}</span>
                      <button
                        type="button"
                        class="ml-0.5 inline-flex min-h-10 min-w-10 items-center justify-center rounded px-1 text-base leading-none text-ink-subtle transition hover:text-danger lg:min-h-0 lg:min-w-0"
                        [attr.aria-label]="'Quitar a ' + p.name"
                        [disabled]="saving()"
                        (click)="quitarSeguidor(p)">
                        ×
                      </button>
                    </span>
                  } @empty {
                    <span class="text-ink-subtle">nadie más</span>
                  }
                  @if (!varios()) {
                    <button
                      type="button"
                      class="btn h-10 gap-1 px-2 text-xs lg:h-8"
                      [disabled]="saving()"
                      title="Elegir responsable principal y quiénes dan seguimiento; un solo correo con copia"
                      (click)="abrirVarios()">
                      <pt-icon name="equipo" class="h-3.5 w-3.5" />
                      Varios…
                    </button>
                  }
                </div>
              }
              @if (historial().length > 0) {
                <details class="rounded-lg bg-surface-muted p-3">
                  <summary
                    class="cursor-pointer text-xs font-bold uppercase tracking-wide text-ink-subtle">
                    Trazabilidad · {{ historial().length }}
                  </summary>
                  <ol class="mt-2 space-y-1.5 border-l border-line pl-3">
                    @for (h of historial(); track h.at + h.kind) {
                      <li class="relative text-xs">
                        <span
                          class="absolute -left-[0.95rem] top-1.5 h-2 w-2 rounded-full"
                          [class]="
                            h.kind === 'estado'
                              ? 'bg-brand'
                              : h.kind === 'asignacion'
                                ? 'bg-amber-500'
                                : h.kind === 'eliminado'
                                  ? 'bg-danger'
                                  : 'bg-ink-subtle'
                          "></span>
                        <span class="text-ink">{{ h.text }}</span>
                        <span class="ml-1 text-ink-subtle"
                          >· {{ h.by ?? 'alguien' }} ·
                          {{ h.at | relativo }}</span
                        >
                      </li>
                    }
                  </ol>
                </details>
              }

              @if (comments().length > 0) {
                <ul class="space-y-1.5">
                  @for (c of comments(); track c.at) {
                    <li class="text-sm">
                      <span class="text-ink">{{ c.text }}</span>
                      <span class="ml-2 text-xs text-ink-subtle"
                        >{{ c.by ?? 'alguien' }} · {{ c.at | relativo }}</span
                      >
                    </li>
                  }
                </ul>
              }

              @if (ia.disponible) {
                <!-- Acciones arriba del comentario; el resultado sale junto a ellas. -->
                <div class="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    class="btn"
                    [disabled]="saving()"
                    (click)="startEdit()">
                    Editar
                  </button>
                  @if (puedeFotos()) {
                    <button
                      type="button"
                      class="btn"
                      [disabled]="
                        saving() || (task().imagenes?.length ?? 0) >= maxFotos
                      "
                      title="Pantallazo, croquis o foto para tener a la mano"
                      (click)="elegirFoto()">
                      <pt-icon name="foto" class="h-4 w-4" />
                      Foto de referencia
                    </button>
                  }
                  @if (task().dueDate && ia.calendarios().length > 0) {
                    <button
                      type="button"
                      class="btn"
                      [disabled]="saving()"
                      (click)="agendar()">
                      <pt-icon name="agenda" class="h-4 w-4" />
                      Agendar
                    </button>
                  }
                  @if (
                    !task().assignee &&
                    !task().personal &&
                    ia.activa() !== false
                  ) {
                    <button
                      type="button"
                      class="btn"
                      [disabled]="sugiriendo()"
                      title="La IA propone responsable y empresa; tú decides"
                      (click)="sugerir()">
                      <span class="text-base leading-none">✦</span>
                      {{ sugiriendo() ? 'Pensando…' : 'Sugerir responsable' }}
                    </button>
                  }
                  @if (task().origin === 'correo' && ia.activa() !== false) {
                    <button
                      type="button"
                      class="btn"
                      [disabled]="drafting()"
                      (click)="reply()">
                      <pt-icon name="bandeja" class="h-4 w-4" />
                      {{ drafting() ? 'Redactando…' : 'Borrador de respuesta' }}
                    </button>
                  }
                  @if (puedePedirActualizacion()) {
                    <!-- Es de alguien más: se le pide por correo en qué va,
                         con copia a quienes dan seguimiento. -->
                    <button
                      type="button"
                      class="btn"
                      [class.btn-activo]="!!pidiendo()"
                      [disabled]="saving()"
                      title="Correo al responsable (copia a quienes dan seguimiento) con su liga para contestar"
                      (click)="abrirPedir()">
                      <pt-icon name="enviar" class="h-4 w-4" />
                      Pedir actualización
                    </button>
                  }
                  @if (message(); as m) {
                    @if (m.error) {
                      <p class="banner banner-danger basis-full py-2 text-xs">
                        {{ m.texto }}
                      </p>
                    } @else {
                      <p class="text-xs font-medium text-ok">{{ m.texto }}</p>
                    }
                  }
                </div>

                @if (pidiendo(); as p) {
                  <form
                    class="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface-muted p-3"
                    role="group"
                    aria-label="Pedir actualización"
                    (ngSubmit)="enviarSolicitud()">
                    <!-- En celular la nota ocupa el renglón completo y los
                         botones van debajo; en escritorio, todo en línea. -->
                    <label class="min-w-0 basis-full sm:basis-0 sm:flex-1">
                      <span
                        class="mb-1 block text-xs font-medium text-ink-muted"
                        >Nota para el responsable (opcional)</span
                      >
                      <input
                        #campoNota
                        class="field"
                        type="text"
                        placeholder="Qué necesitas saber…"
                        [ngModel]="p.nota"
                        (ngModelChange)="pidiendo.set({ nota: $event })"
                        name="nota-act-{{ task().id }}" />
                    </label>
                    <div class="flex gap-2">
                      <button
                        type="submit"
                        class="btn btn-primary"
                        [disabled]="saving()">
                        <pt-icon name="enviar" class="h-4 w-4" />
                        Enviar
                      </button>
                      <button
                        type="button"
                        class="btn"
                        [disabled]="saving()"
                        (click)="pidiendo.set(undefined)">
                        Cancelar
                      </button>
                    </div>
                  </form>
                }

                <form
                  class="flex flex-wrap items-end gap-2"
                  (ngSubmit)="comment()">
                  <label class="min-w-0 flex-1">
                    <span class="mb-1 block text-xs font-medium text-ink-muted"
                      >Comentario</span
                    >
                    <input
                      class="field"
                      type="text"
                      placeholder="Qué pasó, qué falta…"
                      [ngModel]="draft()"
                      (ngModelChange)="draft.set($event)"
                      name="comentario-{{ task().id }}" />
                  </label>
                  <button
                    type="submit"
                    class="btn"
                    [disabled]="!draft().trim() || saving()">
                    Comentar
                  </button>
                </form>
              } @else if (message(); as m) {
                <p
                  class="text-xs font-medium"
                  [class]="m.error ? 'text-danger' : 'text-ok'">
                  {{ m.texto }}
                </p>
              }

              @if (editing(); as e) {
                <form
                  class="grid gap-2 rounded-lg bg-surface-muted p-3 sm:grid-cols-2"
                  (ngSubmit)="saveEdit()">
                  <label class="sm:col-span-2">
                    <span class="mb-1 block text-xs font-medium text-ink-muted"
                      >Título</span
                    >
                    <input
                      class="field"
                      type="text"
                      name="e-titulo-{{ task().id }}"
                      [ngModel]="e.title"
                      (ngModelChange)="patchEdit({ title: $event })" />
                  </label>
                  <pt-detalle-editor
                    class="sm:col-span-2"
                    [name]="'e-desc-' + task().id"
                    etiqueta="Descripción y fotos de referencia"
                    placeholder="El detalle: lo que se capturó de referencia se puede completar aquí"
                    [disabled]="saving()"
                    [texto]="e.description"
                    (textoChange)="patchEdit({ description: $event })"
                    [imagenes]="e.imagenes"
                    (imagenesChange)="patchEdit({ imagenes: $event })" />
                  @if (!task().personal) {
                    <label>
                      <span
                        class="mb-1 block text-xs font-medium text-ink-muted"
                        >Prioridad</span
                      >
                      <select
                        class="field"
                        name="e-prio-{{ task().id }}"
                        [ngModel]="e.priority"
                        (ngModelChange)="patchEdit({ priority: $event })">
                        <option value="urgente">Urgente</option>
                        <option value="alta">Alta</option>
                        <option value="media">Media</option>
                        <option value="baja">Baja</option>
                      </select>
                    </label>
                  } @else {
                    <!-- Lo personal: alta, y urgente si tiene fecha. Lo pone el puente. -->
                    <p class="text-xs text-ink-muted">
                      Prioridad:
                      {{ e.dueLocal ? 'urgente (tiene fecha)' : 'alta' }}
                    </p>
                  }
                  <label>
                    <span class="mb-1 block text-xs font-medium text-ink-muted"
                      >Para cuándo</span
                    >
                    <input
                      class="field"
                      type="date"
                      name="e-fecha-{{ task().id }}"
                      [ngModel]="e.dueLocal"
                      (ngModelChange)="patchEdit({ dueLocal: $event })" />
                  </label>
                  <label>
                    <span class="mb-1 block text-xs font-medium text-ink-muted"
                      >Hora (opcional)</span
                    >
                    <input
                      class="field"
                      type="time"
                      name="e-hora-{{ task().id }}"
                      [disabled]="!e.dueLocal"
                      [ngModel]="e.dueTime"
                      (ngModelChange)="patchEdit({ dueTime: $event })" />
                  </label>
                  <label>
                    <span class="mb-1 block text-xs font-medium text-ink-muted"
                      >Empresa</span
                    >
                    <select
                      class="field"
                      name="e-emp-{{ task().id }}"
                      [ngModel]="e.company"
                      (ngModelChange)="patchEdit({ company: $event })">
                      <option value="">Sin empresa</option>
                      @for (emp of empresasParaElegir(); track emp) {
                        <option [value]="emp">{{ emp }}</option>
                      }
                    </select>
                  </label>
                  <label>
                    <span class="mb-1 block text-xs font-medium text-ink-muted"
                      >Proveedor / cliente</span
                    >
                    <select
                      class="field"
                      name="e-proy-{{ task().id }}"
                      [ngModel]="e.project"
                      (ngModelChange)="patchEdit({ project: $event })">
                      <option value="">Sin proveedor</option>
                      @for (p of proveedoresParaElegir(); track p) {
                        <option [value]="p">{{ p }}</option>
                      }
                    </select>
                  </label>
                  @if (task().origin === 'correo') {
                    <label>
                      <span
                        class="mb-1 block text-xs font-medium text-ink-muted"
                        >Quién lo pide</span
                      >
                      <select
                        class="field"
                        name="e-rem-{{ task().id }}"
                        [ngModel]="e.senderKind"
                        (ngModelChange)="patchEdit({ senderKind: $event })">
                        <option value="empresa">De empresas</option>
                        <option value="equipo">Del equipo</option>
                        <option value="por_identificar">Por identificar</option>
                      </select>
                    </label>
                  }
                  <div class="flex gap-2 sm:col-span-2">
                    <button
                      type="submit"
                      class="btn btn-primary"
                      [disabled]="saving() || !e.title.trim()">
                      Guardar cambios
                    </button>
                    <button
                      type="button"
                      class="btn"
                      (click)="editing.set(undefined)">
                      Cancelar
                    </button>
                  </div>
                </form>
              }

              @if (sugerencia(); as sg) {
                <div
                  class="rounded-lg border border-line bg-surface-muted p-3 text-sm">
                  <p class="text-ink">
                    <span class="text-brand">✦</span>
                    @if (sg.persona) {
                      Propone a <strong>{{ sg.persona.name }}</strong>
                    } @else {
                      Sin propuesta de responsable
                    }
                    @if (sg.empresa) {
                      · {{ sg.empresa }}
                    }
                  </p>
                  <p class="mt-1 text-xs text-ink-muted">{{ sg.motivo }}</p>
                  <div class="mt-2 flex flex-wrap gap-2">
                    @if (sg.persona || sg.empresa) {
                      <button
                        type="button"
                        class="btn btn-primary"
                        [disabled]="saving()"
                        (click)="aplicarSugerencia()">
                        Aplicar
                      </button>
                    }
                    <button
                      type="button"
                      class="btn"
                      (click)="sugerencia.set(undefined)">
                      Descartar
                    </button>
                  </div>
                </div>
              }
              @if (borrador(); as b) {
                <div class="rounded-lg bg-surface-muted p-3">
                  <p class="text-xs text-ink-muted">
                    Para: {{ b.para ?? '(sin remitente)' }} · Asunto:
                    {{ b.asunto }}
                  </p>
                  <textarea
                    class="field mt-2 min-h-32 w-full"
                    [ngModel]="b.cuerpo"
                    (ngModelChange)="
                      borrador.set({
                        para: b.para,
                        asunto: b.asunto,
                        cuerpo: $event
                      })
                    "
                    name="borrador-{{ task().id }}"></textarea>
                  <div class="mt-2 flex flex-wrap gap-2">
                    <a class="btn btn-primary" [href]="mailto()">
                      Abrir en mi correo
                    </a>
                    <button type="button" class="btn" (click)="copy()">
                      Copiar texto
                    </button>
                    <span class="self-center text-xs text-ink-subtle"
                      >Revísalo antes de mandar: el puente no envía nada por
                      ti.</span
                    >
                  </div>
                </div>
              }
            </div>
          } @else if (message(); as m) {
            <p
              class="mt-2 text-xs font-medium"
              [class]="m.error ? 'text-danger' : 'text-ok'">
              {{ m.texto }}
            </p>
          }
        </div>

        <!-- Iconos con area tactil de 44 px en celular; en escritorio, compactos. -->
        <div class="flex shrink-0 flex-wrap items-center justify-end gap-1">
          @if (confirmandoBorrar()) {
            <span class="text-xs font-medium text-ink">¿Borrar?</span>
            <button
              type="button"
              class="btn btn-danger h-10 px-3 text-xs lg:h-8"
              [disabled]="saving()"
              (click)="borrarConfirmado()">
              Sí
            </button>
            <button
              type="button"
              class="btn h-10 px-3 text-xs lg:h-8"
              (click)="cancelarBorrar()">
              No
            </button>
          } @else {
            <button
              type="button"
              class="inline-flex min-h-11 min-w-11 items-center justify-center rounded p-2 text-ink-subtle transition hover:bg-surface-muted hover:text-ink lg:min-h-0 lg:min-w-0"
              [attr.aria-label]="
                open() ? 'Cerrar detalle' : 'Comentar, asignar o marcar'
              "
              [attr.aria-expanded]="open()"
              (click)="open.set(!open())">
              <pt-icon
                name="siguiente"
                class="h-4 w-4 transition"
                [class.rotate-90]="open()" />
            </button>
            @if (task().url; as url) {
              <a
                class="inline-flex min-h-11 min-w-11 items-center justify-center rounded p-2 text-ink-subtle transition hover:bg-surface-muted hover:text-ink lg:min-h-0 lg:min-w-0"
                [href]="url"
                target="_blank"
                rel="noopener"
                [attr.aria-label]="'Abrir ' + task().title + ' en su sistema'">
                <pt-icon name="externo" class="h-4 w-4" />
              </a>
            }
            @if (task().origin === 'local' || done()) {
              <button
                type="button"
                class="inline-flex min-h-11 min-w-11 items-center justify-center rounded p-2 text-ink-subtle transition hover:bg-surface-muted hover:text-danger lg:min-h-0 lg:min-w-0"
                [disabled]="saving()"
                [attr.aria-label]="'Eliminar ' + task().title"
                title="Eliminar"
                (click)="remove()">
                <pt-icon name="basura" class="h-4 w-4" />
              </button>
            }
          }
        </div>
      </div>
    </article>
  `
})
export class TaskCardComponent {
  private readonly store = inject(PortalStore);
  private readonly local = inject(LocalTaskStore);
  readonly ia = inject(IaService);
  private readonly admin = inject(PuenteAdminService);
  private readonly sesion = inject(SesionService);

  readonly task = input.required<TaskItem>();
  /** En el diálogo de un aviso la tarjeta nace abierta. */
  readonly abierta = input(false);
  readonly maxFotos = MAX_FOTOS;
  private readonly fotosRef = viewChild(FotosPendienteComponent);

  readonly open = signal(false);
  readonly draft = signal('');
  readonly saving = signal(false);
  /** Id de subtarea que se está convirtiendo en pendiente. */
  readonly convirtiendo = signal<string | undefined>(undefined);
  readonly drafting = signal(false);
  readonly sugiriendo = signal(false);
  readonly sugerencia = signal<
    | {
        persona?: { id: string; name: string; email?: string };
        empresa?: string;
        motivo: string;
      }
    | undefined
  >(undefined);
  /** Resultado de la última acción; `error` decide el tono con que se pinta. */
  readonly message = signal<{ texto: string; error?: boolean } | undefined>(
    undefined
  );
  /** El icono de borrar se volvió pregunta ("¿Borrar? Sí / No"). */
  readonly confirmandoBorrar = signal(false);
  private temporizadorBorrar: ReturnType<typeof setTimeout> | undefined;
  private readonly destroyRef = inject(DestroyRef);
  /** Para decidir una solicitud de reasignación: a quién y una nota. */
  readonly reasignarA = signal('');
  readonly notaDecision = signal('');
  readonly borrador = signal<Borrador | undefined>(undefined);
  private readonly catalogo = inject(EmpresasService);
  private readonly catalogoProveedores = inject(ProveedoresService);
  /**
   * Las empresas activas del catálogo y, si el pendiente trae una que ya no
   * está (inactiva o renombrada afuera), también esa, para no perderla al
   * editar.
   */
  readonly empresasParaElegir = computed(() => {
    const lista = this.catalogo.nombres();
    const actual = this.task().company;
    return actual && !lista.includes(actual) ? [...lista, actual] : lista;
  });
  /** Igual que empresas, para el selector de proveedor. */
  readonly proveedoresParaElegir = computed(() => {
    const lista = this.catalogoProveedores.nombres();
    const actual = this.task().project;
    return actual && !lista.includes(actual) ? [...lista, actual] : lista;
  });
  readonly senderLabel = SENDER_KIND_LABEL;
  /** Copia editable del pendiente mientras el formulario está abierto. */
  readonly editing = signal<
    | {
        title: string;
        description: string;
        imagenes: string[];
        priority: string;
        /** "YYYY-MM-DD" del input de fecha. */
        dueLocal: string;
        /** "HH:mm" o vacío. */
        dueTime: string;
        company: string;
        project: string;
        senderKind: string;
      }
    | undefined
  >(undefined);

  readonly done = computed(() => this.task().status === 'hecho');
  /** El asunto sin los "RE: RV: Fwd:" que acumula el correo. */
  readonly titulo = computed(() => sinPrefijosDeCorreo(this.task().title));
  readonly origenCorto = computed(() => ORIGIN_SHORT[this.task().origin]);
  /**
   * Hecho/Reabrir de un clic: con puente vale para cualquier origen; sin
   * puente (demostración) solo para los propios, que cambian en memoria.
   */
  readonly puedeMarcar = computed(
    () => this.ia.disponible || this.task().origin === 'local'
  );
  readonly overdue = computed(
    () => !this.done() && isOverdue(this.task().dueDate)
  );
  readonly comments = computed(() => this.task().comments ?? []);
  readonly seguidores = computed(() => this.task().followers ?? []);
  readonly nombresSeguidores = computed(() =>
    this.seguidores()
      .map((p) => p.name)
      .join(', ')
  );
  /** Quien entró, si está en el equipo (por correo, sin importar mayúsculas). */
  readonly yo = computed(() => {
    const correo = this.sesion.correo()?.trim().toLowerCase();
    return correo
      ? this.ia.equipo().find((p) => p.email?.toLowerCase() === correo)
      : undefined;
  });
  /** El pendiente ya está a mi nombre. */
  readonly esMio = computed(() => {
    const yo = this.yo();
    const a = this.task().assignee;
    return !!yo && !!a && mismaPersona(a, yo);
  });
  /** El panel "Varios…" abierto: principal y seguimiento por elegir (claves del equipo). */
  readonly varios = signal<
    { principal: string; seguidores: string[] } | undefined
  >(undefined);
  /** El campo "Nota para el responsable" abierto para pedir actualización. */
  readonly pidiendo = signal<{ nota: string } | undefined>(undefined);
  private readonly campoNota =
    viewChild<ElementRef<HTMLInputElement>>('campoNota');
  /**
   * La respuesta del equipo que se acaba de ver al abrir la tarjeta: se
   * deja a la vista en el detalle aunque el chip ya se haya quitado.
   */
  readonly respuestaVista = signal<TaskUnread | undefined>(undefined);
  /**
   * Se puede pedir actualización cuando el pendiente es de alguien más:
   * tiene responsable o seguidores y ninguno es quien entró ni uno de los
   * correos del dueño del monitor (sus buzones). Sin sesión (solo token de
   * administración) no se sabe quién pide: no se ofrece. Lo hecho ya no se
   * pregunta.
   */
  readonly puedePedirActualizacion = computed(() => {
    const t = this.task();
    const correo = this.sesion.correo()?.trim().toLowerCase();
    if (!this.ia.disponible || !correo || t.personal || this.done()) {
      return false;
    }
    const involucrados = [t.assignee, ...(t.followers ?? [])].filter(
      (p): p is Person => !!p
    );
    if (involucrados.length === 0) {
      return false;
    }
    const propios = new Set([correo, ...this.ia.correosDelDueno()]);
    return !involucrados.some(
      (p) => !!p.email && propios.has(p.email.trim().toLowerCase())
    );
  });
  readonly historial = computed(() =>
    [...(this.task().history ?? [])].sort((a, b) => b.at.localeCompare(a.at))
  );
  readonly estados: TaskStatus[] = [
    'pendiente',
    'en_progreso',
    'bloqueado',
    'hecho'
  ];
  readonly statusLabels = TASK_STATUS_LABEL;
  readonly clasePlazo = computed(() =>
    this.task().dueDate
      ? CLASE_PLAZO[tonoPlazo(this.task().dueDate as string)]
      : ''
  );
  readonly puntoPlazo = computed(() =>
    this.task().dueDate
      ? PUNTO_PLAZO[tonoPlazo(this.task().dueDate as string)]
      : ''
  );
  readonly textoPlazo = computed(() =>
    this.task().dueDate ? textoPlazo(this.task().dueDate as string) : ''
  );
  readonly priorityLabel = computed(
    () => TASK_PRIORITY_LABEL[this.task().priority]
  );
  readonly priorityClass = computed(() => PRIORITY_CLASS[this.task().priority]);
  /** Color del chip de empresa: el del catálogo o uno derivado del nombre. */
  readonly companyClass = computed(() => {
    const company = this.task().company;
    return company
      ? ACCOUNT_CHIP_CLASS[this.catalogo.colorDe(company)]
      : 'bg-surface-muted text-ink-muted';
  });
  readonly projectClass = computed(() => {
    const project = this.task().project;
    return project
      ? ACCOUNT_CHIP_CLASS[this.catalogoProveedores.colorDe(project)]
      : 'bg-surface-muted text-ink-muted';
  });
  readonly statusLabel = computed(() => TASK_STATUS_LABEL[this.task().status]);

  /**
   * El valor del selector de responsable: la persona del equipo que
   * corresponde al asignado, buscada por id o por correo (sin importar
   * mayúsculas), para que no salga en blanco cuando el pendiente guardó al
   * asignado con otro dato del que trae el equipo.
   */
  readonly responsableValor = computed(() => {
    const a = this.task().assignee;
    if (!a) {
      return '';
    }
    const correo = a.email?.toLowerCase();
    const p = this.ia
      .equipo()
      .find(
        (q) => q.id === a.id || (!!correo && q.email?.toLowerCase() === correo)
      );
    return p ? (p.email ?? p.id) : (a.email ?? a.id ?? '');
  });
  readonly statusClass = computed(() => STATUS_CLASS[this.task().status]);
  readonly barClass = computed(
    () =>
      ACCOUNT_BAR_CLASS[
        this.store.accountOf(this.task().accountId)?.color ?? 'slate'
      ]
  );
  readonly mailto = computed(() => {
    const b = this.borrador();
    if (!b) {
      return '';
    }
    return `mailto:${encodeURIComponent(b.para ?? '')}?subject=${encodeURIComponent(b.asunto)}&body=${encodeURIComponent(b.cuerpo)}`;
  });

  private readonly avisos = inject(AvisosService);
  private readonly host = inject(ElementRef<HTMLElement>);

  /** Ya se le dijo al puente que esta novedad se vio; no repetir. */
  private vistoEnviado = false;

  constructor() {
    this.ia.cargarEquipo();
    // Abrir la tarjeta es ver la novedad: se avisa al puente y el chip se
    // quita al instante, sin esperar el siguiente refresco.
    effect(() => {
      const novedad = this.task().unread;
      if (
        !this.open() ||
        !novedad ||
        this.vistoEnviado ||
        !this.ia.disponible
      ) {
        return;
      }
      this.vistoEnviado = true;
      if (novedad.kind === 'respuesta') {
        this.respuestaVista.set(novedad);
      }
      const id = this.task().id;
      this.admin.marcarVisto(id).subscribe({
        next: () => {
          this.store.actualizarTarea(id, { unread: undefined });
          this.local.olvidarNovedad(id);
        },
        error: () => {
          this.vistoEnviado = false;
        }
      });
    });
    effect(() => {
      if (this.abierta()) {
        this.open.set(true);
      }
    });
    effect(() => {
      if (this.abierta()) {
        this.open.set(true);
      }
    });
    // Si este es el pendiente que un aviso pidio abrir, se abre y se enseña.
    effect(() => {
      if (this.avisos.abrir() === this.task().id) {
        this.open.set(true);
        this.avisos.abrir.set(undefined);
        setTimeout(() => {
          this.host.nativeElement.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
          });
        }, 50);
      }
    });
  }

  /**
   * Marcar hecho vale para cualquier origen: se anota en el puente y se
   * sirve encima de lo que diga la fuente. Sin puente (demostración) solo
   * los propios cambian, en memoria.
   */
  /** Abre la tarjeta y lleva el foco al selector de responsable. */
  abrirAsignar(): void {
    this.open.set(true);
    setTimeout(() => {
      const select = document.querySelector<HTMLSelectElement>(
        `select[name="resp-${CSS.escape(this.task().id)}"]`
      );
      select?.focus();
    });
  }

  /** Abre el formulario de edición con el foco en "Quién lo pide". */
  abrirRemitente(): void {
    if (!this.ia.disponible) {
      return;
    }
    this.open.set(true);
    if (!this.editing()) {
      this.startEdit();
    }
    setTimeout(() => {
      const select = document.querySelector<HTMLSelectElement>(
        `select[name="e-rem-${CSS.escape(this.task().id)}"]`
      );
      select?.focus();
    });
  }

  /** "YYYY-MM-DD" de la fecha del pendiente, para el selector de la tarjeta. */
  readonly fechaValor = computed(() => {
    const fecha = this.task().dueDate;
    return fecha ? aLocal(fecha).slice(0, 10) : '';
  });

  /** La fecha se elige en la tarjeta si hay puente o es un pendiente propio. */
  puedeFecha(): boolean {
    return this.ia.disponible || this.task().origin === 'local';
  }

  cambiarFecha(fecha: string): void {
    if (fecha === this.fechaValor()) {
      return;
    }
    const actual = this.task().dueDate;
    const hora =
      fecha && this.task().dueHasTime && actual
        ? aLocal(actual).slice(11, 16)
        : '';
    const cambios = {
      dueDate: fecha
        ? new Date(`${fecha}T${hora || '12:00'}:00`).toISOString()
        : undefined,
      dueHasTime: !!(fecha && hora)
    };
    if (!this.ia.disponible) {
      if (this.task().origin === 'local') {
        this.local.patch(this.task().id, {
          dueDate: cambios.dueDate,
          dueHasTime: cambios.dueHasTime || undefined
        });
        this.store.refreshTasks();
      }
      return;
    }
    this.guardar({ cambios }, () =>
      this.message.set({
        texto: fecha ? 'Fecha actualizada.' : 'Fecha quitada.'
      })
    );
  }

  /** El estado se elige del selector; Hecho y reabrir son dos de sus valores. */
  cambiarEstado(estado: TaskStatus): void {
    if (estado === this.task().status) {
      return;
    }
    this.store.marcarRecienHecho(this.task().id, estado === 'hecho');
    this.guardar({ estado }, () =>
      this.message.set({
        texto:
          estado === 'hecho'
            ? 'Marcado como hecho. Si fue un error, cambia el estado.'
            : `Estado: ${TASK_STATUS_LABEL[estado]}.`
      })
    );
  }

  toggle(): void {
    const hecho = !this.done();
    this.store.marcarRecienHecho(this.task().id, hecho);
    if (!this.ia.disponible) {
      if (this.task().origin === 'local') {
        this.local.toggleDone(this.task().id);
        this.store.refreshTasks();
      }
      return;
    }
    this.guardar({ hecho }, () =>
      this.message.set({
        texto: hecho
          ? 'Marcado como hecho. Si fue un error, Reabrir.'
          : 'Reabierto.'
      })
    );
  }

  comment(): void {
    const texto = this.draft().trim();
    if (!texto) {
      return;
    }
    this.guardar({ comentario: texto }, () => this.draft.set(''));
  }

  /** Acuerdo de junta Fireflies → pendiente propio. */
  convertirSubtarea(subId: string): void {
    if (!this.ia.disponible || this.convirtiendo()) {
      return;
    }
    this.convirtiendo.set(subId);
    this.message.set(undefined);
    const idPadre = this.task().id;
    this.admin.convertirSubtarea(idPadre, subId).subscribe({
      next: ({ pendiente, padre }) => {
        this.convirtiendo.set(undefined);
        this.local.reemplazar(padre);
        this.local.anteponer(pendiente);
        this.store.actualizarTarea(idPadre, {
          subtareas: padre.subtareas,
          updatedAt: padre.updatedAt
        });
        this.store.refreshTasks();
        this.message.set({
          texto: `Pendiente creado: «${pendiente.title}».`
        });
      },
      error: (error: unknown) => {
        this.convirtiendo.set(undefined);
        this.message.set({ texto: describirError(error), error: true });
      }
    });
  }

  /** Reasignar desde la lista: cambia y avisa sin abrir la tarjeta. */
  decidirReasignacion(decision: 'aprobar' | 'rechazar'): void {
    if (decision === 'aprobar' && !this.reasignarA()) {
      return;
    }
    this.saving.set(true);
    this.message.set(undefined);
    this.admin
      .decidirReasignacion({
        id: this.task().id,
        decision,
        asignarA: decision === 'aprobar' ? this.reasignarA() : undefined,
        nota: this.notaDecision().trim() || undefined,
        tarea: this.task()
      })
      .subscribe({
        next: (r) => {
          this.saving.set(false);
          this.reasignarA.set('');
          this.notaDecision.set('');
          this.message.set({ texto: r.aviso ?? 'Listo.' });
          this.store.refreshTasks();
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.message.set({ texto: describirError(error), error: true });
        }
      });
  }

  /** Del selector: cambia el principal, conserva el seguimiento y avisa de inmediato. */
  reasignar(quien: string): void {
    if (quien === this.responsableValor()) {
      return;
    }
    this.fijarResponsables(quien, this.clavesSeguidores());
  }

  /** Mío: me lo pongo a mi nombre; sin nadie más que siga, no hay correo. */
  asignarmelo(): void {
    const yo = this.yo();
    if (!yo || this.esMio()) {
      return;
    }
    this.fijarResponsables(this.clave(yo), this.clavesSeguidores());
  }

  /** Acepta al que propuso la IA: principal el sugerido, con el seguimiento actual. */
  asignarSugerido(): void {
    const sg = this.task().suggestedAssignee;
    if (!sg) {
      return;
    }
    this.fijarResponsables(
      this.claveDe(sg.person) ?? sg.person.email ?? sg.person.id,
      this.clavesSeguidores()
    );
  }

  /** La clave con que el selector y los chips identifican a alguien del equipo. */
  clave(p: Person): string {
    return p.email ?? p.id;
  }

  /** La clave del equipo de una persona guardada (por id o correo), si está. */
  private claveDe(persona: Person): string | undefined {
    const q = this.ia.equipo().find((p) => mismaPersona(p, persona));
    return q ? this.clave(q) : undefined;
  }

  /** Quiénes dan seguimiento hoy, como claves del equipo (los que ya no están, fuera). */
  private clavesSeguidores(): string[] {
    return this.seguidores()
      .map((p) => this.claveDe(p))
      .filter((k): k is string => !!k);
  }

  /** Abre "Varios…" con lo que hay: principal y seguimiento actuales. */
  abrirVarios(): void {
    this.varios.set({
      principal: this.responsableValor(),
      seguidores: this.clavesSeguidores()
    });
  }

  patchVarios(cambio: { principal: string }): void {
    this.varios.update((v) =>
      v
        ? {
            principal: cambio.principal,
            // El principal no se sigue a sí mismo.
            seguidores: v.seguidores.filter((k) => k !== cambio.principal)
          }
        : v
    );
  }

  sigue(v: { seguidores: string[] }, p: Person): boolean {
    return v.seguidores.includes(this.clave(p));
  }

  toggleSeguidor(p: Person): void {
    const k = this.clave(p);
    this.varios.update((v) =>
      v
        ? {
            ...v,
            seguidores: v.seguidores.includes(k)
              ? v.seguidores.filter((x) => x !== k)
              : [...v.seguidores, k]
          }
        : v
    );
  }

  /** Guarda principal y seguimiento de una vez: un solo correo con copia. */
  guardarVarios(): void {
    const v = this.varios();
    if (!v) {
      return;
    }
    this.fijarResponsables(
      v.principal,
      v.seguidores.filter((k) => k !== v.principal),
      () => this.varios.set(undefined)
    );
  }

  /**
   * Manda principal y seguimiento al puente y pinta la tarea devuelta al
   * instante; el aviso dice a quién se escribió (o por qué no).
   */
  private fijarResponsables(
    principal: string,
    seguidores: string[],
    luego?: () => void
  ): void {
    this.saving.set(true);
    this.message.set(undefined);
    const id = this.task().id;
    this.ia.responsables(id, principal, seguidores, this.task()).subscribe({
      next: (r) => {
        this.saving.set(false);
        if (r.tarea) {
          // Campo por campo: lo que quedó vacío (sin responsable) no viaja
          // en el JSON y un simple {...} no lo borraría.
          this.store.actualizarTarea(id, {
            assignee: r.tarea.assignee,
            followers: r.tarea.followers,
            suggestedAssignee: r.tarea.suggestedAssignee,
            history: r.tarea.history,
            updatedAt: r.tarea.updatedAt
          });
        }
        this.message.set(r.aviso ? { texto: r.aviso } : undefined);
        luego?.();
        this.local.invalidar();
        this.store.refreshTasks();
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.message.set({ texto: describirError(error), error: true });
      }
    });
  }

  /** Abre el campo de la nota y le pone el foco. */
  abrirPedir(): void {
    if (this.pidiendo()) {
      this.pidiendo.set(undefined);
      return;
    }
    this.pidiendo.set({ nota: '' });
    // El campo se pinta en el siguiente ciclo; con ngModel el `name` no
    // llega al DOM, asi que se busca por su id.
    setTimeout(() => this.campoNota()?.nativeElement.focus());
  }

  /**
   * Pide la actualización: el puente escribe al responsable (copia a quienes
   * dan seguimiento) y devuelve la tarea marcada; el aviso dice a quién.
   */
  enviarSolicitud(): void {
    const p = this.pidiendo();
    if (!p) {
      return;
    }
    this.saving.set(true);
    this.message.set(undefined);
    const id = this.task().id;
    this.ia
      .solicitarActualizacion(id, p.nota.trim() || undefined, this.task())
      .subscribe({
        next: (r) => {
          this.saving.set(false);
          this.pidiendo.set(undefined);
          if (r.tarea) {
            this.store.actualizarTarea(id, {
              updateRequested: r.tarea.updateRequested,
              history: r.tarea.history,
              updatedAt: r.tarea.updatedAt
            });
          }
          this.message.set(r.aviso ? { texto: r.aviso } : undefined);
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.message.set({ texto: describirError(error), error: true });
        }
      });
  }

  descartarSugerencia(): void {
    this.guardar({ descartarSugerencia: true }, () =>
      this.store.actualizarTarea(this.task().id, {
        suggestedAssignee: undefined
      })
    );
  }

  quitarSeguidor(persona: { id: string; email?: string }): void {
    this.guardar({ quitarSeguidor: persona.email ?? persona.id });
  }

  sugerir(): void {
    this.sugiriendo.set(true);
    this.message.set(undefined);
    this.ia.sugerir(this.task().id).subscribe({
      next: (r) => {
        const persona = this.ia.equipo().find((p) => p.id === r.responsable);
        this.sugerencia.set({
          persona: persona
            ? { id: persona.id, name: persona.name, email: persona.email }
            : undefined,
          empresa: r.empresa,
          motivo: r.motivo
        });
        this.sugiriendo.set(false);
      },
      error: (error: unknown) => {
        this.message.set({ texto: describirError(error), error: true });
        this.sugiriendo.set(false);
      }
    });
  }

  /** Aplica lo propuesto: empresa por edición y responsable por asignación. */
  aplicarSugerencia(): void {
    const sg = this.sugerencia();
    if (!sg) {
      return;
    }
    const cambios =
      sg.empresa && sg.empresa !== this.task().company
        ? { company: sg.empresa }
        : undefined;
    this.guardar(
      {
        ...(cambios ? { cambios, tarea: this.task() } : {}),
        ...(sg.persona
          ? { asignarA: sg.persona.email ?? sg.persona.id, tarea: this.task() }
          : {})
      },
      () => this.sugerencia.set(undefined)
    );
  }

  reply(): void {
    this.drafting.set(true);
    this.message.set(undefined);
    this.ia.respuesta(this.task().id).subscribe({
      next: (b) => {
        this.borrador.set(b);
        this.drafting.set(false);
      },
      error: (error: unknown) => {
        this.message.set({ texto: describirError(error), error: true });
        this.drafting.set(false);
      }
    });
  }

  /**
   * Fotos de referencia: con puente se anotan; lo propio también se guarda
   * en la lista local si el puente no está.
   */
  puedeFotos(): boolean {
    return this.ia.disponible || this.task().origin === 'local';
  }

  elegirFoto(): void {
    this.fotosRef()?.abrirSelector();
  }

  guardarFotos(imagenes: string[]): void {
    if (this.ia.disponible) {
      this.guardar({
        cambios: { imagenes },
        tarea: this.task()
      });
      return;
    }
    if (this.task().origin === 'local') {
      this.local.patch(this.task().id, {
        imagenes: imagenes.length ? imagenes : undefined
      });
    }
  }

  startEdit(): void {
    const t = this.task();
    this.editing.set({
      title: t.title,
      description: t.description ?? '',
      imagenes: t.imagenes ?? [],
      priority: t.priority,
      dueLocal: t.dueDate ? aLocal(t.dueDate).slice(0, 10) : '',
      dueTime: t.dueDate && t.dueHasTime ? aLocal(t.dueDate).slice(11, 16) : '',
      company: t.company ?? '',
      project: t.project ?? '',
      senderKind: t.senderKind ?? 'por_identificar'
    });
  }

  patchEdit(
    cambio: Partial<NonNullable<ReturnType<typeof this.editing>>>
  ): void {
    this.editing.update((e) => (e ? { ...e, ...cambio } : e));
  }

  saveEdit(): void {
    const e = this.editing();
    if (!e || !e.title.trim()) {
      return;
    }
    this.guardar(
      {
        cambios: {
          title: e.title,
          description: e.description,
          imagenes: e.imagenes,
          priority: this.task().personal
            ? e.dueLocal
              ? 'urgente'
              : 'alta'
            : (e.priority as TaskPriority),
          // Sin hora se ancla a mediodia (cae en ese día en cualquier zona).
          dueDate: e.dueLocal
            ? new Date(`${e.dueLocal}T${e.dueTime || '12:00'}:00`).toISOString()
            : undefined,
          dueHasTime: !!(e.dueLocal && e.dueTime),
          company: e.company || undefined,
          project: e.project || undefined,
          ...(this.task().origin === 'correo'
            ? { senderKind: e.senderKind as TaskItem['senderKind'] }
            : {})
        },
        // Con lo que tenía, el puente anota en la trazabilidad solo lo que
        // de verdad cambió.
        tarea: this.task()
      },
      () => this.editing.set(undefined)
    );
  }

  /** Crea la junta en el calendario a la hora del pendiente (una hora). */
  agendar(): void {
    const t = this.task();
    const calendarios = this.ia.calendarios();
    const cuenta =
      calendarios.length === 1
        ? calendarios[0]
        : calendarios.find((c) => confirm(`¿Agendar en ${c.usuario}?`));
    if (!cuenta || !t.dueDate) {
      return;
    }
    this.saving.set(true);
    this.ia
      .agendar(cuenta.id, {
        titulo: t.title,
        inicio: t.dueDate,
        lugar: t.project,
        cuerpo: t.description,
        invitados: t.assignee?.email ? [t.assignee.email] : []
      })
      .subscribe({
        next: (r) => {
          this.saving.set(false);
          this.message.set({
            texto: `Agendada en ${cuenta.usuario}.${r.joinUrl ? ' Con liga de Teams.' : ''}`
          });
          this.store.refreshMeetings();
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.message.set({ texto: describirError(error), error: true });
        }
      });
  }

  copy(): void {
    const b = this.borrador();
    if (b) {
      void navigator.clipboard?.writeText(b.cuerpo);
      this.message.set({ texto: 'Copiado.' });
    }
  }

  /**
   * Los propios se borran siempre; los demás (correo, Ops, Odoo) solo cuando
   * ya están hechos, y lo que se borra es la vista: la fuente no se toca.
   *
   * El primer clic vuelve el icono pregunta ("¿Borrar? Sí / No"); sin
   * respuesta en unos segundos, regresa el icono.
   */
  remove(): void {
    this.confirmandoBorrar.set(true);
    clearTimeout(this.temporizadorBorrar);
    this.temporizadorBorrar = setTimeout(
      () => this.confirmandoBorrar.set(false),
      ESPERA_BORRAR_MS
    );
    this.destroyRef.onDestroy(() => clearTimeout(this.temporizadorBorrar));
  }

  cancelarBorrar(): void {
    clearTimeout(this.temporizadorBorrar);
    this.confirmandoBorrar.set(false);
  }

  borrarConfirmado(): void {
    this.cancelarBorrar();
    if (!this.ia.disponible) {
      this.local.remove(this.task().id);
      this.store.refreshTasks();
      return;
    }
    this.guardar({ eliminar: true });
  }

  private guardar(
    cambio: Parameters<IaService['anotar']>[1],
    luego?: () => void
  ): void {
    this.saving.set(true);
    this.message.set(undefined);
    this.ia.anotar(this.task().id, cambio).subscribe({
      next: (r) => {
        this.saving.set(false);
        this.message.set(r.aviso ? { texto: r.aviso } : undefined);
        luego?.();
        this.local.invalidar();
        this.store.refreshTasks();
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.message.set({ texto: describirError(error), error: true });
      }
    });
  }
}

/** La misma persona del equipo, por id o por correo (sin importar mayúsculas). */
function mismaPersona(a: Person, b: Person): boolean {
  const correo = a.email?.toLowerCase();
  return a.id === b.id || (!!correo && correo === b.email?.toLowerCase());
}

/** ISO → valor de un input datetime-local, en hora local. */
function aLocal(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
