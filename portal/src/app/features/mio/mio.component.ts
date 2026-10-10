import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { PORTAL_CONFIG } from '../../core/config/portal-config.token';
import {
  TASK_PRIORITY_LABEL,
  TASK_PRIORITY_WEIGHT,
  TASK_STATUS_LABEL,
  TaskItem,
  TaskStatus
} from '../../core/models';
import {
  CRM_FUNCIONALIDAD_ESTADO_LABEL,
  CRM_FUNCIONALIDAD_PRIORIDAD_LABEL,
  CrmFuncionalidadEstado
} from '../../core/models/crm-nativo.model';
import { BrandLogoComponent } from '../../ui/brand-logo.component';
import { FotosPendienteComponent } from '../../ui/fotos-pendiente.component';
import { IconComponent } from '../../ui/icon.component';
import { DayPipe, RelativePipe, TimePipe } from '../../ui/portal.pipes';
import { sinPrefijosDeCorreo } from '../../core/util/text.util';

interface FuncionalidadMio {
  id: string;
  titulo: string;
  descripcion?: string;
  estado: CrmFuncionalidadEstado;
  prioridad: 'baja' | 'media' | 'alta' | 'urgente';
  fechaCompromiso?: string;
  enlace?: string;
  proyectoNombre?: string;
  clienteNombre?: string;
}

/** Lo que dice la pantalla cuando la liga ya no abre (404 o 410 del puente). */
const LIGA_VENCIDA =
  'Esta liga venció. Pídele a Carlos una nueva o responde el correo con tu avance.';

/**
 * Mis pendientes: la pantalla a la que llega cada persona del equipo desde
 * su liga personal (la que va en el correo de asignación y en el del lunes).
 * Sin código de acceso: la liga identifica a la persona. Ve solo lo suyo,
 * comenta y marca como hecho; quien asigna se entera por push.
 */
@Component({
  selector: 'pt-mio',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BrandLogoComponent,
    DayPipe,
    TimePipe,
    FormsModule,
    FotosPendienteComponent,
    IconComponent,
    RelativePipe
  ],
  templateUrl: './mio.component.html'
})
export class MioComponent {
  private readonly http = inject(HttpClient);
  private readonly config = inject(PORTAL_CONFIG);
  private readonly token =
    inject(ActivatedRoute).snapshot.paramMap.get('token') ?? '';

  readonly priorityLabel = TASK_PRIORITY_LABEL;
  readonly funcEstadoLabel = CRM_FUNCIONALIDAD_ESTADO_LABEL;
  readonly funcPrioridadLabel = CRM_FUNCIONALIDAD_PRIORIDAD_LABEL;

  readonly persona = signal<{ name: string; role?: string } | undefined>(
    undefined
  );
  readonly pendientes = signal<TaskItem[]>([]);
  /** "tarea": la liga del correo de asignación (un solo pendiente); "todos": la de estatus. */
  readonly alcance = signal<'tarea' | 'todos'>('todos');
  /** Los que ve por dar seguimiento, no por ser el responsable. */
  readonly seguimiento = signal<ReadonlySet<string>>(new Set());
  readonly error = signal<string | undefined>(undefined);
  readonly cargando = signal(true);
  readonly verHechos = signal(false);
  readonly borradores = signal<Record<string, string>>({});
  readonly ocupado = signal<string | undefined>(undefined);
  /** Resultado de la última acción por pendiente; `error` decide el tono. */
  readonly mensajes = signal<
    Record<string, { texto: string; error?: boolean }>
  >({});

  /** Funcionalidades asignadas del CRM nativo. */
  readonly funcionalidades = signal<FuncionalidadMio[]>([]);
  readonly verFuncionalidades = signal(true);

  readonly abiertos = computed(() =>
    [...this.pendientes()]
      .filter((t) => t.status !== 'hecho')
      .sort(
        (a, b) =>
          TASK_PRIORITY_WEIGHT[a.priority] - TASK_PRIORITY_WEIGHT[b.priority] ||
          (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9')
      )
  );
  readonly hechos = computed(() =>
    this.pendientes().filter((t) => t.status === 'hecho')
  );

  constructor() {
    this.cargar();
  }

  /** El asunto sin los "RE: RV: Fwd:" del correo. */
  titulo(t: TaskItem): string {
    return sinPrefijosDeCorreo(t.title);
  }

  /** Lo sigue, pero el responsable es otro. */
  soloSigue(t: TaskItem): boolean {
    return this.seguimiento().has(t.id);
  }

  vencido(t: TaskItem): boolean {
    return (
      !!t.dueDate && t.status !== 'hecho' && Date.parse(t.dueDate) < Date.now()
    );
  }

  cargar(): void {
    this.http
      .get<{
        persona: { name: string; role?: string };
        alcance?: 'tarea' | 'todos';
        pendientes: TaskItem[];
        seguimiento?: string[];
      }>(`${this.config.gatewayUrl}/mio/${this.token}/tasks`)
      .subscribe({
        next: (r) => {
          this.persona.set(r.persona);
          this.alcance.set(r.alcance ?? 'todos');
          this.pendientes.set(r.pendientes);
          this.seguimiento.set(new Set(r.seguimiento ?? []));
          this.cargando.set(false);
          this.cargarFuncionalidades();
        },
        error: (e: unknown) => {
          const http = e as {
            status?: number;
            error?: { error?: string };
            message?: string;
          };
          this.error.set(
            http?.status === 410 || http?.status === 404
              ? LIGA_VENCIDA
              : (http?.error?.error ?? http?.message ?? 'No se pudo cargar.')
          );
          this.cargando.set(false);
        }
      });
  }

  cargarFuncionalidades(): void {
    this.http
      .get<FuncionalidadMio[]>(
        `${this.config.gatewayUrl}/mio/${this.token}/funcionalidades`
      )
      .subscribe({
        next: (funcs) => this.funcionalidades.set(funcs),
        error: () => this.funcionalidades.set([])
      });
  }

  readonly funcionalidadesAbiertas = computed(() =>
    this.funcionalidades().filter((f) => f.estado !== 'hecho')
  );

  funcVencida(fecha: string | undefined): boolean {
    if (!fecha) return false;
    return new Date(fecha) < new Date();
  }

  borrador(id: string): string {
    return this.borradores()[id] ?? '';
  }

  escribir(id: string, texto: string): void {
    this.borradores.update((b) => ({ ...b, [id]: texto }));
  }

  comentar(t: TaskItem): void {
    const texto = this.borrador(t.id).trim();
    if (!texto) {
      return;
    }
    this.anotar(t, { comentario: texto }, () => this.escribir(t.id, ''));
  }

  /** Qué pendiente tiene abierto el formulario de "no tengo tiempo". */
  readonly pidiendo = signal<string | undefined>(undefined);
  readonly motivo = signal('');

  pedirReasignacion(t: TaskItem): void {
    this.ocupado.set(t.id);
    this.http
      .post<{ ok: boolean }>(
        `${this.config.gatewayUrl}/mio/${this.token}/reasignar`,
        { id: t.id, motivo: this.motivo().trim() || undefined }
      )
      .subscribe({
        next: () => {
          this.ocupado.set(undefined);
          this.pidiendo.set(undefined);
          this.motivo.set('');
          this.mensajes.update((m) => ({
            ...m,
            [t.id]: {
              texto:
                'Solicitud enviada. En cuanto Carlos decida te llega un correo.'
            }
          }));
          this.cargar();
        },
        error: (e: unknown) => {
          const http = e as { error?: { error?: string }; message?: string };
          this.ocupado.set(undefined);
          this.mensajes.update((m) => ({
            ...m,
            [t.id]: {
              texto:
                http?.error?.error ?? http?.message ?? 'No se pudo mandar.',
              error: true
            }
          }));
        }
      });
  }

  marcar(t: TaskItem, hecho: boolean): void {
    this.anotar(t, { hecho });
  }

  cambiarEstado(t: TaskItem, estado: TaskStatus): void {
    if (estado !== t.status) {
      this.anotar(t, { estado });
    }
  }

  readonly estados: TaskStatus[] = [
    'pendiente',
    'en_progreso',
    'bloqueado',
    'hecho'
  ];
  readonly statusLabel = TASK_STATUS_LABEL;

  historial(t: TaskItem) {
    return [...(t.history ?? [])].sort((a, b) => b.at.localeCompare(a.at));
  }

  private anotar(
    t: TaskItem,
    cambio: { comentario?: string; hecho?: boolean; estado?: TaskStatus },
    luego?: () => void
  ): void {
    this.ocupado.set(t.id);
    this.http
      .post<{ ok: boolean }>(
        `${this.config.gatewayUrl}/mio/${this.token}/anotar`,
        {
          id: t.id,
          ...cambio
        }
      )
      .subscribe({
        next: () => {
          this.ocupado.set(undefined);
          this.mensajes.update((m) => ({
            ...m,
            [t.id]: { texto: 'Guardado.' }
          }));
          luego?.();
          this.cargar();
        },
        error: (e: unknown) => {
          const http = e as { error?: { error?: string }; message?: string };
          this.ocupado.set(undefined);
          this.mensajes.update((m) => ({
            ...m,
            [t.id]: {
              texto:
                http?.error?.error ?? http?.message ?? 'No se pudo guardar.',
              error: true
            }
          }));
        }
      });
  }
}
