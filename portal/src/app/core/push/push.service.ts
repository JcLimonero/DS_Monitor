import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PORTAL_CONFIG } from '../config/portal-config.token';
import { PuenteAdminService } from '../sources/gateway/puente-admin.service';

export type EstadoPush =
  'no_soportado' | 'sin_permiso' | 'bloqueado' | 'activo' | 'ocupado';

/**
 * Avisos push en este dispositivo: registra el service worker, pide permiso,
 * se suscribe con la clave VAPID del puente y le manda el endpoint. El puente
 * avisa cuando te asignan algo, cuando un pendiente vence hoy y cuando un
 * sitio se cae.
 *
 * En iPhone solo funciona con la aplicación agregada a la pantalla de inicio
 * (iOS 16.4 o más), no desde Safari suelto.
 */
@Injectable({ providedIn: 'root' })
export class PushService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(PORTAL_CONFIG);
  private readonly admin = inject(PuenteAdminService);

  readonly estado = signal<EstadoPush>(this.estadoInicial());
  readonly mensaje = signal<string | undefined>(undefined);

  get soportado(): boolean {
    return (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    );
  }

  /** iOS exige la app instalada; ahí avisar antes de pedir permiso ayuda. */
  get necesitaInstalar(): boolean {
    const ua = navigator.userAgent;
    const esIos = /iPhone|iPad|iPod/.test(ua);
    const instalada =
      (navigator as unknown as { standalone?: boolean }).standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches;
    return esIos && !instalada;
  }

  async revisar(): Promise<void> {
    if (!this.soportado || !this.config.gatewayUrl) {
      this.estado.set('no_soportado');
      return;
    }
    if (Notification.permission === 'denied') {
      this.estado.set('bloqueado');
      return;
    }
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    this.estado.set(sub ? 'activo' : 'sin_permiso');
  }

  async activar(): Promise<void> {
    if (!this.soportado) {
      this.estado.set('no_soportado');
      return;
    }
    this.estado.set('ocupado');
    this.mensaje.set(undefined);
    try {
      const reg = await navigator.serviceWorker.register(
        `/sw.js?api=${encodeURIComponent(this.config.gatewayUrl)}`,
        { scope: '/' }
      );
      await navigator.serviceWorker.ready;
      const permiso = await Notification.requestPermission();
      if (permiso !== 'granted') {
        this.estado.set(permiso === 'denied' ? 'bloqueado' : 'sin_permiso');
        this.mensaje.set('No se dio permiso para avisos.');
        return;
      }
      const { clave } = await firstValueFrom(
        this.http.get<{ clave: string }>(this.url('/push/clave'))
      );
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64aBytes(clave)
        }));
      const r = await firstValueFrom(
        this.http.post<{ ok: boolean; correo?: string }>(
          this.url('/push/suscribir'),
          { endpoint: sub.endpoint },
          { headers: this.headers() }
        )
      );
      this.estado.set('activo');
      this.mensaje.set(
        r.correo
          ? `Avisos activos para ${r.correo} en este dispositivo.`
          : 'Avisos activos en este dispositivo.'
      );
    } catch (error) {
      this.estado.set('sin_permiso');
      const http = error as { error?: { error?: string }; message?: string };
      this.mensaje.set(http?.error?.error ?? http?.message ?? String(error));
    }
  }

  async desactivar(): Promise<void> {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await firstValueFrom(
        this.http.post(this.url('/push/olvidar'), { endpoint: sub.endpoint })
      ).catch(() => undefined);
      await sub.unsubscribe();
    }
    this.estado.set('sin_permiso');
    this.mensaje.set('Avisos apagados en este dispositivo.');
  }

  async probar(): Promise<void> {
    try {
      const r = await firstValueFrom(
        this.http.post<{ ok: boolean; mensaje: string }>(
          this.url('/push/probar'),
          {},
          { headers: this.headers() }
        )
      );
      this.mensaje.set(r.mensaje);
    } catch (error) {
      const http = error as { error?: { error?: string }; message?: string };
      this.mensaje.set(http?.error?.error ?? http?.message ?? String(error));
    }
  }

  private estadoInicial(): EstadoPush {
    if (!this.soportado) {
      return 'no_soportado';
    }
    return Notification.permission === 'denied' ? 'bloqueado' : 'sin_permiso';
  }

  private url(path: string): string {
    return `${this.config.gatewayUrl}${path}`;
  }

  private headers(): Record<string, string> {
    const token = this.admin.token();
    return token ? { authorization: `Bearer ${token}` } : {};
  }
}

function base64aBytes(base64url: string): ArrayBuffer {
  const relleno = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + relleno).replace(/-/g, '+').replace(/_/g, '/');
  const crudo = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(crudo.length));
  for (let i = 0; i < crudo.length; i++) {
    bytes[i] = crudo.charCodeAt(i);
  }
  return bytes.buffer;
}
