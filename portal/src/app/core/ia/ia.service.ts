import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, of, tap } from 'rxjs';
import { PORTAL_CONFIG } from '../config/portal-config.token';
import { PuenteAdminService } from '../sources/gateway/puente-admin.service';
import { Person, TaskItem, TaskStatus } from '../models';
import {
  Acuerdo,
  Alerta,
  Borrador,
  Diagnostico,
  EstadoIa,
  CambiosPendiente,
  JuntaParaAcuerdos,
  NuevaJunta,
  Propuesta,
  ResumenDia,
  ResumenRepos,
  SugerenciaCrm,
  VistaSemana
} from './ia.models';

/**
 * Lo que el puente resuelve con inteligencia artificial, y las anotaciones
 * de pendientes (comentar, marcar hecho, asignar) que viven en el servidor.
 *
 * Sin puente (modo demostración) todo responde vacío y las pantallas no
 * enseñan nada de IA. El puente guarda cada resultado, así que pedirlo dos
 * veces no cuesta.
 */
@Injectable({ providedIn: 'root' })
export class IaService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(PORTAL_CONFIG);
  private readonly admin = inject(PuenteAdminService);

  /** Si el puente tiene la API key. Se sabe tras la primera consulta. */
  readonly activa = signal<boolean | undefined>(undefined);
  /** El equipo, para asignar. Se pide una vez. */
  readonly equipo = signal<Person[]>([]);
  /** Buzones donde se pueden crear juntas. */
  readonly calendarios = signal<{ id: string; usuario: string }[]>([]);
  readonly fireflies = signal(false);

  get disponible(): boolean {
    return !!this.config.gatewayUrl;
  }

  estado(): Observable<EstadoIa | undefined> {
    if (!this.disponible) {
      return of(undefined);
    }
    return this.http.get<EstadoIa>(this.url('/ia/estado')).pipe(
      tap((e) => {
        this.activa.set(e.activa);
        this.calendarios.set(e.calendarios ?? []);
        this.fireflies.set(!!e.fireflies);
      })
    );
  }

  cargarEquipo(): void {
    if (!this.disponible || this.equipo().length > 0) {
      return;
    }
    this.http
      .get<Person[]>(this.url('/equipo'))
      .subscribe({ next: (p) => this.equipo.set(p), error: () => undefined });
  }

  modelos(): Observable<{
    actual?: string;
    modelos: { id: string; nota: string; entrada: number; salida: number }[];
  }> {
    return this.http.get<{
      actual?: string;
      modelos: { id: string; nota: string; entrada: number; salida: number }[];
    }>(this.url('/ia/modelos'));
  }

  resumen(): Observable<{ disponible: boolean; resumen?: ResumenDia }> {
    return this.disponible
      ? this.http.get<{ disponible: boolean; resumen?: ResumenDia }>(
          this.url('/ia/resumen')
        )
      : of({ disponible: false });
  }

  generarResumen(): Observable<{ disponible: boolean; resumen?: ResumenDia }> {
    return this.http.post<{ disponible: boolean; resumen?: ResumenDia }>(
      this.url('/ia/resumen/generar'),
      {},
      { headers: this.headers() }
    );
  }

  alertas(): Observable<Alerta[]> {
    return this.disponible
      ? this.http.get<Alerta[]>(this.url('/ia/alertas'))
      : of([]);
  }

  acuerdos(junta: JuntaParaAcuerdos): Observable<{
    acuerdos: Acuerdo[];
    notas: boolean;
    fuente?: 'fireflies' | 'invitacion' | 'ninguna';
    urlNotas?: string;
  }> {
    return this.http.post<{
      acuerdos: Acuerdo[];
      notas: boolean;
      fuente?: 'fireflies' | 'invitacion' | 'ninguna';
      urlNotas?: string;
    }>(this.url('/ia/acuerdos'), { junta }, { headers: this.headers() });
  }

  aceptarAcuerdos(
    acuerdos: Acuerdo[],
    junta: string
  ): Observable<{ agregados: number; avisos: string[] }> {
    return this.http.post<{ agregados: number; avisos: string[] }>(
      this.url('/ia/acuerdos/aceptar'),
      { acuerdos, junta },
      { headers: this.headers() }
    );
  }

  respuesta(id: string, instrucciones?: string): Observable<Borrador> {
    return this.http.post<Borrador>(
      this.url('/ia/respuesta'),
      { id, instrucciones },
      { headers: this.headers() }
    );
  }

  /** Borrador de contestación a un correo pegado tal cual. */
  responderCorreo(
    correo: string,
    instrucciones?: string
  ): Observable<Borrador> {
    return this.http.post<Borrador>(
      this.url('/ia/respuesta'),
      { correo, instrucciones },
      { headers: this.headers() }
    );
  }

  sugerenciasCrm(): Observable<SugerenciaCrm[]> {
    return this.disponible
      ? this.http.get<SugerenciaCrm[]>(this.url('/ia/crm/sugerencias'))
      : of([]);
  }

  crearEnCrm(id: string): Observable<{ ok: boolean; url: string }> {
    return this.http.post<{ ok: boolean; url: string }>(
      this.url('/ia/crm/sugerencias/crear'),
      { id },
      { headers: this.headers() }
    );
  }

  descartarDeCrm(id: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(
      this.url('/ia/crm/sugerencias/descartar'),
      { id },
      { headers: this.headers() }
    );
  }

  diagnosticos(): Observable<Diagnostico[]> {
    return this.disponible
      ? this.http.get<Diagnostico[]>(this.url('/ia/diagnosticos'))
      : of([]);
  }

  generarDiagnosticos(): Observable<Diagnostico[]> {
    return this.http.post<Diagnostico[]>(
      this.url('/ia/diagnosticos/generar'),
      {},
      { headers: this.headers() }
    );
  }

  repos(): Observable<{ disponible: boolean; resumen?: ResumenRepos }> {
    return this.disponible
      ? this.http.get<{ disponible: boolean; resumen?: ResumenRepos }>(
          this.url('/ia/repos')
        )
      : of({ disponible: false });
  }

  generarRepos(): Observable<{ disponible: boolean; resumen?: ResumenRepos }> {
    return this.http.post<{ disponible: boolean; resumen?: ResumenRepos }>(
      this.url('/ia/repos/generar'),
      {},
      { headers: this.headers() }
    );
  }

  semana(redactar: boolean): Observable<VistaSemana> {
    return this.http.get<VistaSemana>(
      this.url(`/ia/semana${redactar ? '?redactar=1' : ''}`)
    );
  }

  enviarSemana(
    solo?: string
  ): Observable<{ enviados: string[]; errores: string[] }> {
    return this.http.post<{ enviados: string[]; errores: string[] }>(
      this.url('/ia/semana/enviar'),
      { solo },
      { headers: this.headers() }
    );
  }

  dictar(
    texto: string
  ): Observable<{ propuestas: Propuesta[]; conIa: boolean }> {
    return this.http.post<{ propuestas: Propuesta[]; conIa: boolean }>(
      this.url('/ia/dictado'),
      { texto },
      { headers: this.headers() }
    );
  }

  aceptarDictado(
    propuestas: Propuesta[]
  ): Observable<{ agregados: number; avisos: string[] }> {
    return this.http.post<{ agregados: number; avisos: string[] }>(
      this.url('/ia/dictado/aceptar'),
      { propuestas },
      { headers: this.headers() }
    );
  }

  /** Crea una junta en el calendario del buzón (Microsoft). */
  agendar(
    cuentaId: string,
    junta: NuevaJunta
  ): Observable<{
    ok: boolean;
    id: string;
    webLink?: string;
    joinUrl?: string;
  }> {
    return this.http.post<{
      ok: boolean;
      id: string;
      webLink?: string;
      joinUrl?: string;
    }>(this.url(`/correo/${cuentaId}/juntas/crear`), junta, {
      headers: this.headers()
    });
  }

  /** La ventana de la IA: una conversación corta sobre el tablero. */
  preguntar(
    conversacion: { rol: 'usuario' | 'asistente'; texto: string }[]
  ): Observable<{ respuesta: string }> {
    return this.http.post<{ respuesta: string }>(
      this.url('/ia/preguntar'),
      { conversacion },
      { headers: this.headers() }
    );
  }

  /** Comentar, marcar hecho o asignar cualquier pendiente. */
  anotar(
    id: string,
    cambio: {
      comentario?: string;
      hecho?: boolean;
      estado?: TaskStatus;
      eliminar?: boolean;
      cambios?: CambiosPendiente;
      asignarA?: string;
      tarea?: Partial<TaskItem>;
    }
  ): Observable<{ ok: boolean; aviso?: string }> {
    return this.http.post<{ ok: boolean; aviso?: string }>(
      this.url('/pendientes/anotar'),
      { id, ...cambio },
      { headers: this.headers() }
    );
  }

  private url(path: string): string {
    return `${this.config.gatewayUrl}${path}`;
  }

  /** El token de administración, si se capturó; la sesión la pone el interceptor. */
  private headers(): Record<string, string> {
    const token = this.admin.token();
    return token ? { authorization: `Bearer ${token}` } : {};
  }
}

/** El mensaje de un error HTTP del puente, o lo que haya. */
export function describirError(error: unknown): string {
  const http = error as { error?: { error?: string }; message?: string };
  return http?.error?.error ?? http?.message ?? String(error);
}
