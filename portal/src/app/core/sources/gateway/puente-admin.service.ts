import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { PORTAL_CONFIG } from '../../config/portal-config.token';
import { Empresa, Person, SourceKind, TaskItem } from '../../models';

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

/** La última corrida de una integración, tal como la sirve el puente. */
export interface Ejecucion {
  clave: string;
  integracion: string;
  nombre: string;
  emisor: string;
  resultado: 'ok' | 'aviso' | 'error';
  /** Lo que se muestra: el resultado, o "atrasada" si ya debía haber corrido. */
  estado: 'ok' | 'aviso' | 'error' | 'atrasada';
  mensaje?: string;
  detalle?: string;
  duracionMs?: number;
  empezoEn?: string;
  terminoEn: string;
  recibidoEn: string;
  cadaMinutos?: number;
  corridas: number;
  ultimoOkEn?: string;
  ultimoErrorEn?: string;
  erroresSeguidos: number;
}

/** Un servidor (VPS) con su Prometheus, tal como lo enseña el puente (sin secretos). */
export interface ServidorVps {
  id: string;
  etiqueta: string;
  url: string;
  usuario?: string;
  conContrasena: boolean;
  conToken: boolean;
  etiquetaNombre?: string;
  actualizadoEn: string;
}

/** Lo que se manda al guardar; contraseña y token solo si se cambian. */
export interface ServidorVpsEdicion {
  id?: string;
  etiqueta: string;
  url: string;
  usuario?: string;
  contrasena?: string;
  token?: string;
  etiquetaNombre?: string;
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

/** Un pendiente que el barrido dejó con responsable o con propuesta. */
export interface PendienteAtendido {
  id: string;
  titulo: string;
  responsable: string;
}

/** Lo que lleva o dejó un barrido de autoasignación. */
export interface ResumenAutoasignacion {
  revisados: number;
  asignadosPorRegla: PendienteAtendido[];
  asignadosPorIa: PendienteAtendido[];
  sugeridos: PendienteAtendido[];
  sinPropuesta: number;
  /** Quedaron para otra vez: sin IA o se acabaron las consultas. */
  omitidos: number;
  consultas: number;
}

/**
 * Cómo va (o cómo quedó) el último barrido. El puente lo tiene en memoria:
 * si reinició, viene `enCurso: false` sin nada más.
 */
export interface EstadoBarrido {
  enCurso: boolean;
  iniciadoEn?: string;
  terminadoEn?: string;
  /** Parcial mientras corre; final al terminar. */
  resumen?: ResumenAutoasignacion;
  error?: string;
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

  /** La liga personal de alguien del equipo; con `enviar` también va por correo. */
  ligaDe(
    id: string,
    enviar: boolean
  ): Observable<{ url: string; vence: string; aviso?: string }> {
    return this.http.post<{ url: string; vence: string; aviso?: string }>(
      this.url(`/equipo/${encodeURIComponent(id)}/liga`),
      { enviar },
      { headers: this.headers() }
    );
  }

  estatusConfig(): Observable<{ dias: number[]; hora: number }> {
    return this.http.get<{ dias: number[]; hora: number }>(
      this.url('/equipo/estatus-config')
    );
  }

  guardarEstatusConfig(config: {
    dias: number[];
    hora: number;
  }): Observable<{ dias: number[]; hora: number }> {
    return this.http.post<{ dias: number[]; hora: number }>(
      this.url('/equipo/estatus-config'),
      config,
      { headers: this.headers() }
    );
  }

  solicitarEstatus(
    ids?: string[]
  ): Observable<{ enviados: string[]; errores: string[] }> {
    return this.http.post<{ enviados: string[]; errores: string[] }>(
      this.url('/equipo/solicitar-estatus'),
      { ids },
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

  /** Decide una solicitud de reasignación: aprobar (y a quién) o rechazar. */
  decidirReasignacion(datos: {
    id: string;
    decision: 'aprobar' | 'rechazar';
    asignarA?: string;
    nota?: string;
    tarea?: Partial<TaskItem>;
  }): Observable<{ ok: boolean; aviso?: string }> {
    return this.http.post<{ ok: boolean; aviso?: string }>(
      this.url('/pendientes/reasignacion'),
      datos,
      { headers: this.headers() }
    );
  }

  /**
   * Arranca el barrido de autoasignación: el puente recorre en segundo plano
   * todos los pendientes de correo sin responsable e intenta asignarlos
   * (regla aprendida o IA). Contesta al instante; cómo va se pregunta con
   * `estadoAutoasignacion()`. Si ya hay uno en curso, no arranca otro.
   */
  autoasignar(opciones: {
    maximoConsultas?: number;
    reintentar?: boolean;
    soloCuenta?: string;
  }): Observable<{ enCurso: boolean; iniciadoEn?: string }> {
    return this.http.post<{ enCurso: boolean; iniciadoEn?: string }>(
      this.url('/pendientes/autoasignar'),
      opciones,
      { headers: this.headers() }
    );
  }

  estadoAutoasignacion(): Observable<EstadoBarrido> {
    return this.http.get<EstadoBarrido>(
      this.url('/pendientes/autoasignar/estado'),
      { headers: this.headers() }
    );
  }

  /** Alguien abrió el pendiente: la novedad por correo ya se vio. */
  marcarVisto(id: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(
      this.url('/pendientes/visto'),
      { id },
      { headers: this.headers() }
    );
  }

  /** El catálogo de empresas del grupo, activas e inactivas. */
  empresas(): Observable<Empresa[]> {
    return this.http.get<Empresa[]>(this.url('/empresas'));
  }

  /** Guarda el catálogo completo; renombrar reetiqueta lo ya guardado. */
  guardarEmpresas(
    empresas: (Omit<Empresa, 'id' | 'orden' | 'actualizadoEn'> & {
      id?: string;
    })[]
  ): Observable<Empresa[]> {
    return this.http.post<Empresa[]>(
      this.url('/empresas/guardar'),
      { empresas },
      { headers: this.headers() }
    );
  }

  /** Los servidores (VPS) vigilados, sin secretos. */
  servidores(): Observable<ServidorVps[]> {
    return this.http.get<ServidorVps[]>(this.url('/vps/servidores'));
  }

  /** Guarda la lista completa; contraseña/token vacíos conservan los que había. */
  guardarServidores(
    servidores: ServidorVpsEdicion[]
  ): Observable<ServidorVps[]> {
    return this.http.post<ServidorVps[]>(
      this.url('/vps/servidores/guardar'),
      { servidores },
      { headers: this.headers() }
    );
  }

  borrarServidor(id: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(
      this.url('/vps/servidores/borrar'),
      { id },
      { headers: this.headers() }
    );
  }

  probarServidor(id: string): Observable<ResultadoPrueba> {
    return this.http.post<ResultadoPrueba>(
      this.url('/vps/servidores/probar'),
      { id },
      { headers: this.headers() }
    );
  }

  /** Todo lo que guarda el puente, para descargarlo como respaldo. */
  respaldo(): Observable<{
    generadoEn: string;
    origen: string;
    colecciones: Record<string, Record<string, unknown>>;
  }> {
    return this.http.get<{
      generadoEn: string;
      origen: string;
      colecciones: Record<string, Record<string, unknown>>;
    }>(this.url('/respaldo'), { headers: this.headers() });
  }

  /** La última corrida de cada integración, las que están mal primero. */
  ejecuciones(): Observable<Ejecucion[]> {
    return this.http.get<Ejecucion[]>(this.url('/ejecuciones'));
  }

  borrarEjecucion(clave: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(
      this.url('/ejecuciones/borrar'),
      { clave },
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
