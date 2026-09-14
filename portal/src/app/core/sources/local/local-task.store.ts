import { Injectable, computed, signal } from '@angular/core';
import { Observable, of } from 'rxjs';
import { TaskItem, TaskPriority } from '../../models';
import { demoLocalTasks } from '../demo/demo-tasks';
import { SourceKind } from '../../models';
import { TaskSource } from '../source.contracts';

const STORAGE_KEY = 'portal.pendientes-locales.v1';

/** Datos que pide el formulario de alta rapida. */
export interface NewLocalTask {
  title: string;
  priority: TaskPriority;
  dueDate?: string;
  project?: string;
}

/**
 * Pendientes capturados en el portal mismo.
 *
 * Viven en localStorage porque todavía no hay backend; cuando lo haya, esta
 * clase es lo único que cambia: el resto del portal la consume como cualquier
 * otra `TaskSource`.
 */
@Injectable({ providedIn: 'root' })
export class LocalTaskStore implements TaskSource {
  readonly id = 'pendientes-locales';
  readonly label = 'Pendientes propios';
  readonly kind: SourceKind = 'local';
  readonly demo = false;

  private readonly accountId = 'mios';
  private readonly tasksSignal = signal<TaskItem[]>(this.load());

  readonly tasks = this.tasksSignal.asReadonly();
  readonly openCount = computed(
    () => this.tasksSignal().filter((t) => t.status !== 'hecho').length
  );

  fetchTasks(): Observable<TaskItem[]> {
    return of(this.tasksSignal());
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

  private commit(tasks: TaskItem[]): void {
    this.tasksSignal.set(tasks);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch {
      // Modo privado o almacenamiento lleno: la sesión sigue, solo no persiste.
    }
  }

  private load(): TaskItem[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed as TaskItem[];
        }
      }
    } catch {
      // Si lo guardado quedó corrupto se arranca con la semilla de ejemplo.
    }
    return demoLocalTasks(this.accountId);
  }
}
