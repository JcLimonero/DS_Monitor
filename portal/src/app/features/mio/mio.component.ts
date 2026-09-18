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
  TaskItem
} from '../../core/models';
import { BrandLogoComponent } from '../../ui/brand-logo.component';
import { IconComponent } from '../../ui/icon.component';
import { DayPipe, RelativePipe } from '../../ui/portal.pipes';

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
    FormsModule,
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
  readonly persona = signal<{ name: string; role?: string } | undefined>(
    undefined
  );
  readonly pendientes = signal<TaskItem[]>([]);
  readonly error = signal<string | undefined>(undefined);
  readonly cargando = signal(true);
  readonly verHechos = signal(false);
  readonly borradores = signal<Record<string, string>>({});
  readonly ocupado = signal<string | undefined>(undefined);
  readonly mensajes = signal<Record<string, string>>({});

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

  vencido(t: TaskItem): boolean {
    return (
      !!t.dueDate && t.status !== 'hecho' && Date.parse(t.dueDate) < Date.now()
    );
  }

  cargar(): void {
    this.http
      .get<{
        persona: { name: string; role?: string };
        pendientes: TaskItem[];
      }>(`${this.config.gatewayUrl}/mio/${this.token}/tasks`)
      .subscribe({
        next: (r) => {
          this.persona.set(r.persona);
          this.pendientes.set(r.pendientes);
          this.cargando.set(false);
        },
        error: (e: unknown) => {
          const http = e as { error?: { error?: string }; message?: string };
          this.error.set(
            http?.error?.error ?? http?.message ?? 'No se pudo cargar.'
          );
          this.cargando.set(false);
        }
      });
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

  marcar(t: TaskItem, hecho: boolean): void {
    this.anotar(t, { hecho });
  }

  private anotar(
    t: TaskItem,
    cambio: { comentario?: string; hecho?: boolean },
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
          this.mensajes.update((m) => ({ ...m, [t.id]: 'Guardado.' }));
          luego?.();
          this.cargar();
        },
        error: (e: unknown) => {
          const http = e as { error?: { error?: string }; message?: string };
          this.ocupado.set(undefined);
          this.mensajes.update((m) => ({
            ...m,
            [t.id]: http?.error?.error ?? http?.message ?? 'No se pudo guardar.'
          }));
        }
      });
  }
}
