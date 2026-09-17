import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { PORTAL_CONFIG } from '../../config/portal-config.token';
import { Person, SourceKind } from '../../models';

/** Un dominio registrado, tal como lo guarda el puente. */
export interface Dominio {
  nombre: string;
  registrador?: string;
  venceEn: string;
  costo?: number;
  moneda?: string;
  automatico?: boolean;
  notas?: string;
}

/**
 * Lo que el puente dice de un buzón: qué tiene y qué le falta. No trae
 * secretos; por eso se puede pedir sin token.
 */
export interface EstadoBuzon {
  id: string;
  proveedor: 'google' | 'microsoft' | 'imap';
  usuario: string;
  host: string;
  puerto: number;
  buzones: string[];
  metodo: 'graph' | 'imap' | 'envio' | 'ninguno';
  conContrasena: boolean;
  conAplicacion: boolean;
  tenant?: string;
  clientId?: string;
  conectadaComo?: string;
  faltante?: string;
  /** La URI de regreso que hay que registrar en la aplicación de Entra ID. */
  redirectUri: string;
}

/** Lo que se manda al puente al guardar un buzón. Lo vacío no pisa nada. */
export interface CredencialesBuzon {
  proveedor?: SourceKind;
  usuario?: string;
  host?: string;
  puerto?: number;
  contrasena?: string;
  tenant?: string;
  clientId?: string;
  clientSecret?: string;
}

export interface ResultadoPrueba {
  ok: boolean;
  mensaje: string;
}

/** Una variable de una integración, tal como la describe el puente. */
export interface CampoIntegracion {
  variable: string;
  etiqueta: string;
  tipo: 'texto' | 'secreto' | 'numero' | 'fecha' | 'lista' | 'largo';
  ayuda?: string;
  obligatoria?: boolean;
  /** True si tiene valor, venga del entorno o de Ajustes. */
  definida: boolean;
  origen?: 'ajustes' | 'entorno';
  /** El valor actual; nunca viene para los secretos. */
  valor?: string;
}

export interface EstadoIntegracion {
  id: string;
  etiqueta: string;
  kind: string;
  configurada: boolean;
  faltante?: string;
  editable: boolean;
  campos: CampoIntegracion[];
}

/** Quien puede mandar datos por la API. El token nunca viene en la lista. */
export interface Emisor {
  nombre: string;
  tipos: string[];
  accountId: string;
  vigenciaSegundos: number;
  deEntorno: boolean;
  ultimoEnvio?: string;
}

const TOKEN_KEY = 'ds-monitor.puente-token';

/**
 * Las llamadas de administración al puente: guardar credenciales de un
 * buzón, probarlo y conectarlo con Microsoft.
 *
 * Van con el token de administración del puente (`PUENTE_ADMIN_TOKEN`), que
 * se captura en Ajustes → Puente y se guarda en este navegador. Las
 * credenciales viajan al puente y se quedan ahí; el portal nunca las guarda.
 */
@Injectable({ providedIn: 'root' })
export class PuenteAdminService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(PORTAL_CONFIG);

  readonly token = signal(readToken());

  get disponible(): boolean {
    return !!this.config.gatewayUrl;
  }

  setToken(token: string): void {
    const limpio = token.trim();
    this.token.set(limpio);
    try {
      if (limpio) {
        localStorage.setItem(TOKEN_KEY, limpio);
      } else {
        localStorage.removeItem(TOKEN_KEY);
      }
    } catch {
      // Sin almacenamiento el token dura lo que dure la pestaña.
    }
  }

  estado(id: string): Observable<EstadoBuzon> {
    return this.http.get<EstadoBuzon>(this.url(`/correo/${id}/estado`));
  }

  guardar(id: string, datos: CredencialesBuzon): Observable<EstadoBuzon> {
    return this.http.post<EstadoBuzon>(
      this.url(`/correo/${id}/guardar`),
      datos,
      { headers: this.headers() }
    );
  }

  borrarBuzon(id: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(
      this.url(`/correo/${id}/borrar`),
      {},
      { headers: this.headers() }
    );
  }

  probar(id: string): Observable<ResultadoPrueba> {
    return this.http.post<ResultadoPrueba>(
      this.url(`/correo/${id}/probar`),
      {},
      { headers: this.headers() }
    );
  }

  /** La URL de Microsoft a la que hay que mandar a la persona. */
  iniciarOauth(id: string, volver: string): Observable<{ url: string }> {
    return this.http.post<{ url: string }>(
      this.url(`/correo/${id}/oauth/inicio`),
      { volver },
      { headers: this.headers() }
    );
  }

  integraciones(): Observable<EstadoIntegracion[]> {
    return this.http.get<EstadoIntegracion[]>(this.url('/integraciones'));
  }

  guardarIntegracion(
    id: string,
    variables: Record<string, string>
  ): Observable<EstadoIntegracion> {
    return this.http.post<EstadoIntegracion>(
      this.url(`/integraciones/${id}/guardar`),
      { variables },
      { headers: this.headers() }
    );
  }

  probarIntegracion(id: string): Observable<ResultadoPrueba> {
    return this.http.post<ResultadoPrueba>(
      this.url(`/integraciones/${id}/probar`),
      {},
      { headers: this.headers() }
    );
  }

  equipo(): Observable<Person[]> {
    return this.http.get<Person[]>(this.url('/equipo'));
  }

  guardarEquipo(personas: Person[]): Observable<Person[]> {
    return this.http.post<Person[]>(
      this.url('/equipo/guardar'),
      { personas },
      { headers: this.headers() }
    );
  }

  dominios(): Observable<Dominio[]> {
    return this.http.get<Dominio[]>(this.url('/dominios'));
  }

  guardarDominios(dominios: Dominio[]): Observable<Dominio[]> {
    return this.http.post<Dominio[]>(
      this.url('/dominios/guardar'),
      { dominios },
      { headers: this.headers() }
    );
  }

  emisores(): Observable<Emisor[]> {
    return this.http.get<Emisor[]>(this.url('/emisores'));
  }

  /** Devuelve el emisor con su token: es la única vez que se ve. */
  crearEmisor(datos: {
    nombre: string;
    tipos: string[];
    accountId?: string;
    vigenciaSegundos?: number;
  }): Observable<Emisor & { token: string; aviso: string }> {
    return this.http.post<Emisor & { token: string; aviso: string }>(
      this.url('/emisores/guardar'),
      datos,
      { headers: this.headers() }
    );
  }

  borrarEmisor(nombre: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(
      this.url('/emisores/borrar'),
      { nombre },
      { headers: this.headers() }
    );
  }

  /** La raíz pública de la API, para enseñar cómo mandar datos. */
  get apiUrl(): string {
    const base = this.config.gatewayUrl;
    return base.startsWith('http') ? base : `${location.origin}${base}`;
  }

  private url(path: string): string {
    return `${this.config.gatewayUrl}${path}`;
  }

  private headers(): Record<string, string> {
    const token = this.token();
    return token ? { authorization: `Bearer ${token}` } : {};
  }
}

function readToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}
