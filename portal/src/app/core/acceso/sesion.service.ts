import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { PORTAL_CONFIG } from '../config/portal-config.token';

const TOKEN_KEY = 'ds-monitor.sesion';

export interface EstadoAcceso {
  requerido: boolean;
  sesion?: { correo: string; vence: string };
}

/**
 * La sesión con el puente.
 *
 * Se entra con un código que llega por correo; a cambio el puente da un token
 * que se guarda en este navegador y viaja en cada petición. El portal no sabe
 * de contraseñas: solo guarda el token y lo suelta al salir.
 */
@Injectable({ providedIn: 'root' })
export class SesionService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(PORTAL_CONFIG);

  readonly token = signal(readToken());
  readonly correo = signal<string | undefined>(undefined);
  /** True cuando el puente contestó 401: hay que ir a la pantalla de acceso. */
  readonly requerida = signal(false);

  get disponible(): boolean {
    return !!this.config.gatewayUrl;
  }

  estado(): Observable<EstadoAcceso> {
    return this.http
      .get<EstadoAcceso>(`${this.config.gatewayUrl}/acceso/estado`)
      .pipe(tap((estado) => this.correo.set(estado.sesion?.correo)));
  }

  pedirCodigo(
    correo: string
  ): Observable<{ enviado: boolean; mensaje: string }> {
    return this.http.post<{ enviado: boolean; mensaje: string }>(
      `${this.config.gatewayUrl}/acceso/codigo`,
      { correo }
    );
  }

  entrar(
    correo: string,
    codigo: string
  ): Observable<{ token: string; correo: string }> {
    return this.http
      .post<{ token: string; correo: string; vence: string }>(
        `${this.config.gatewayUrl}/acceso/entrar`,
        { correo, codigo }
      )
      .pipe(
        tap((sesion) => {
          this.setToken(sesion.token);
          this.correo.set(sesion.correo);
          this.requerida.set(false);
        })
      );
  }

  salir(): void {
    const token = this.token();
    if (token && this.disponible) {
      this.http
        .post(`${this.config.gatewayUrl}/acceso/salir`, {})
        .subscribe({ error: () => undefined });
    }
    this.setToken('');
    this.correo.set(undefined);
  }

  private setToken(token: string): void {
    this.token.set(token);
    try {
      if (token) {
        localStorage.setItem(TOKEN_KEY, token);
      } else {
        localStorage.removeItem(TOKEN_KEY);
      }
    } catch {
      // Sin almacenamiento la sesión dura lo que dure la pestaña.
    }
  }
}

function readToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}
