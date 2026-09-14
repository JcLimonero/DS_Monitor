import { Injectable, signal } from '@angular/core';

export type Theme = 'claro' | 'oscuro';

const STORAGE_KEY = 'portal.tema';

/**
 * Tema claro u oscuro.
 *
 * El valor inicial lo aplica un script en index.html antes de pintar, para que
 * no haya destello blanco; aquí solo se lee la clase que ese script ya dejo
 * puesta y se mantiene sincronizada a partir de ahí.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly themeSignal = signal<Theme>(
    document.documentElement.classList.contains('dark') ? 'oscuro' : 'claro'
  );

  readonly theme = this.themeSignal.asReadonly();

  toggle(): void {
    this.set(this.themeSignal() === 'oscuro' ? 'claro' : 'oscuro');
  }

  set(theme: Theme): void {
    this.themeSignal.set(theme);
    document.documentElement.classList.toggle('dark', theme === 'oscuro');
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Sin almacenamiento el tema dura lo que dure la sesión.
    }
  }
}
