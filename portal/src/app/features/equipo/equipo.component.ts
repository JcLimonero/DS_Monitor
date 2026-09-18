import { RouterLink } from '@angular/router';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal
} from '@angular/core';
import { Person, TaskItem } from '../../core/models';
import { PuenteAdminService } from '../../core/sources/gateway/puente-admin.service';
import { TeamLoad, teamWorkload } from '../../core/state/portal.selectors';
import { PortalStore } from '../../core/state/portal.store';
import { plural } from '../../core/util/text.util';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { PageHeaderComponent } from '../../ui/page-header.component';
import { TaskCardComponent } from '../../ui/task-card.component';

@Component({
  selector: 'pt-equipo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    EmptyStateComponent,
    PageHeaderComponent,
    TaskCardComponent
  ],
  templateUrl: './equipo.component.html'
})
export class EquipoComponent {
  private readonly store = inject(PortalStore);
  private readonly admin = inject(PuenteAdminService);

  /** Persona cuyo detalle está abierto. Solo una a la vez. */
  readonly expanded = signal<string | undefined>(undefined);
  readonly ligaOcupada = signal<string | undefined>(undefined);
  readonly ligaMensaje = signal<Record<string, string>>({});

  /** Genera la liga de la persona y la deja en el portapapeles (WhatsApp, etc.). */
  copiarLiga(id: string): void {
    this.ligaOcupada.set(id);
    this.admin.ligaDe(id, false).subscribe({
      next: (r) => {
        void navigator.clipboard?.writeText(r.url);
        this.ligaOcupada.set(undefined);
        this.ligaMensaje.update((m) => ({
          ...m,
          [id]: 'Liga copiada; vale hasta las 3 pm.'
        }));
      },
      error: (e: unknown) => {
        this.ligaOcupada.set(undefined);
        this.ligaMensaje.update((m) => ({ ...m, [id]: describeHttp(e) }));
      }
    });
  }

  mandarLiga(id: string): void {
    this.ligaOcupada.set(id);
    this.admin.ligaDe(id, true).subscribe({
      next: (r) => {
        this.ligaOcupada.set(undefined);
        this.ligaMensaje.update((m) => ({ ...m, [id]: r.aviso ?? 'Enviada.' }));
      },
      error: (e: unknown) => {
        this.ligaOcupada.set(undefined);
        this.ligaMensaje.update((m) => ({ ...m, [id]: describeHttp(e) }));
      }
    });
  }

  /** El equipo tal como se administra en Ajustes, si hay puente. */
  readonly roster = signal<Person[]>([]);

  constructor() {
    if (this.admin.disponible) {
      this.admin.equipo().subscribe({
        next: (personas) => this.roster.set(personas),
        error: () => this.roster.set([])
      });
    }
  }

  /**
   * La carga por persona, con el equipo de Ajustes encima: quien esté en la
   * lista aparece aunque no tenga pendientes, y su rol es el de la lista. Los
   * pendientes se cuelgan por correo o por identificador.
   */
  readonly loads = computed(() => {
    const cargas = teamWorkload(this.store.tasks());
    const porClave = new Map(
      cargas.flatMap((carga) =>
        [carga.person.id, carga.person.email?.toLowerCase()]
          .filter((k): k is string => !!k)
          .map((k) => [k, carga] as const)
      )
    );
    const vistas = new Set<(typeof cargas)[number]>();
    const resultado: TeamLoad[] = this.roster().map((persona) => {
      const carga =
        porClave.get(persona.id) ??
        porClave.get(persona.email?.toLowerCase() ?? '');
      if (carga) {
        vistas.add(carga);
        return {
          ...carga,
          person: { ...carga.person, name: persona.name, role: persona.role }
        };
      }
      return {
        person: persona,
        open: 0,
        overdue: 0,
        dueToday: 0,
        blocked: 0,
        tasks: []
      };
    });
    for (const carga of cargas) {
      if (!vistas.has(carga)) {
        resultado.push(carga);
      }
    }
    return resultado.sort(
      (a, b) => b.open - a.open || a.person.name.localeCompare(b.person.name)
    );
  });

  readonly unassigned = computed<TaskItem[]>(() =>
    this.store
      .tasks()
      .filter((task) => !task.assignee && task.status !== 'hecho')
  );

  /** La carga más alta del equipo; sirve de escala para las barras. */
  readonly subtitle = computed(
    () =>
      `${plural(this.loads().length, 'persona')} · ${
        this.loads().filter((l) => l.open > 0).length
      } con pendientes abiertos`
  );

  private readonly maxOpen = computed(() =>
    Math.max(1, ...this.loads().map((load) => load.open))
  );

  readonly unassignedHint = computed(
    () =>
      `${plural(this.unassigned().length, 'pendiente')} abiertos que nadie tiene a su nombre`
  );

  barWidth(open: number): number {
    return Math.round((open / this.maxOpen()) * 100);
  }

  toggle(personId: string): void {
    this.expanded.update((current) =>
      current === personId ? undefined : personId
    );
  }

  openTasksOf(personId: string): TaskItem[] {
    return (
      this.loads()
        .find((load) => load.person.id === personId)
        ?.tasks.filter((task) => task.status !== 'hecho') ?? []
    );
  }

  initials(name: string): string {
    return name
      .split(' ')
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('');
  }
}

function describeHttp(error: unknown): string {
  const http = error as { error?: { error?: string }; message?: string };
  return http?.error?.error ?? http?.message ?? String(error);
}
