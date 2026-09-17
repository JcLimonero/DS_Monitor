import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, of, tap } from 'rxjs';
import { PORTAL_CONFIG } from '../../config/portal-config.token';
import { SourceKind, TaskItem, TaskPriority } from '../../models';
import { TaskSource } from '../source.contracts';

/** Datos que pide el formulario de alta rapida. */
export interface NewLocalTask {
  title: string;
  priority: TaskPriority;
  dueDate?: string;
  project?: string;
  company?: string;
  description?: string;
  /** Personal (no del negocio): solo se ve en Personales. */
  personal?: boolean;
}

/**
 * Pendientes personales: los que uno se apunta en el portal mismo.
 *
 * Viven en el servidor (`/personales`), para que el monitor de la oficina y
 * la computadora vean lo mismo. Cada cambio manda la lista completa: son
 * decenas de renglones, no miles. Sin servidor (desarrollo sin backend) la
 * lista vive solo en memoria y arranca vacía: aquí no hay datos inventados.
 */
@Injectable({ providedIn: 'root' })
export class LocalTaskStore implements TaskSource {
  readonly id = 'pendientes-locales';
  readonly label = 'Pendientes propios';
  readonly kind: SourceKind = 'local';
  readonly demo = false;

  private readonly http = inject(HttpClient);
  private readonly config = inject(PORTAL_CONFIG);
  private readonly accountId = 'mios';
  private readonly tasksSignal = signal<TaskItem[]>([]);
  /** Ya se leyó del servidor: de ahí en adelante manda la copia local. */
  private cargado = false;

  readonly tasks = this.tasksSignal.asReadonly();
  readonly openCount = computed(
    () => this.tasksSignal().filter((t) => t.status !== 'hecho').length
  );
  /** Qué pasó con el último guardado, para que la vista lo diga si falló. */
  readonly error = signal<string | undefined>(undefined);

  private get remoto(): boolean {
    return !!this.config.gatewayUrl;
  }

  fetchTasks(): Observable<TaskItem[]> {
    // Después de la primera lectura se sirve la copia en memoria: si no, un
    // refresco justo después de agregar traería la lista vieja del servidor
    // antes de que termine el guardado.
    if (!this.remoto || this.cargado) {
      return of(this.tasksSignal());
    }
    return this.http
      .get<TaskItem[]>(`${this.config.gatewayUrl}/personales/tasks`)
      .pipe(
        tap((tasks) => {
          this.tasksSignal.set(tasks);
          this.cargado = true;
        })
      );
  }

  add(input: NewLocalTask): TaskItem {
    const now = new Date().toISOString();
    const task: TaskItem = {
      id: `local-${crypto.randomUUID()}`,
      title: input.title.trim(),
      status: 'pendiente',
      priority: input.priority,
      dueDate: input.dueDate,
      accountId: this.accountId,
      origin: 'local',
      project: input.project?.trim() || undefined,
      company: input.company?.trim() || undefined,
      personal: input.personal ? true : undefined,
      description: input.description?.trim() || undefined,
      tags: [],
      updatedAt: now
    };
    this.commit([task, ...this.tasksSignal()]);
    return task;
  }

  /** Alterna entre hecho y pendiente. Es la única edición de estado que hay. */
  toggleDone(id: string): void {
    this.commit(
      this.tasksSignal().map((task) =>
        task.id === id
          ? {
              ...task,
              status: task.status === 'hecho' ? 'pendiente' : 'hecho',
              updatedAt: new Date().toISOString()
            }
          : task
      )
    );
  }

  remove(id: string): void {
    this.commit(this.tasksSignal().filter((task) => task.id !== id));
  }

  /** La siguiente lectura vuelve al servidor (algo cambió allá: una anotación). */
  invalidar(): void {
    this.cargado = false;
  }

  private commit(tasks: TaskItem[]): void {
    this.tasksSignal.set(tasks);
    if (!this.remoto) {
      return;
    }
    this.http
      .post<TaskItem[]>(`${this.config.gatewayUrl}/personales/guardar`, {
        pendientes: tasks
      })
      .subscribe({
        next: (guardados) => {
          this.tasksSignal.set(guardados);
          this.error.set(undefined);
        },
        error: (error: unknown) => {
          const http = error as {
            error?: { error?: string };
            message?: string;
          };
          this.error.set(
            http?.error?.error ?? http?.message ?? 'No se pudo guardar.'
          );
        }
      });
  }
}
