import { HttpClient } from '@angular/common/http';
import {
  Injectable,
  Signal,
  computed,
  inject,
  signal,
  type WritableSignal
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Observable, catchError, map, of, shareReplay, tap } from 'rxjs';
import { SesionService } from '../../acceso/sesion.service';
import { PORTAL_CONFIG } from '../../config/portal-config.token';
import type {
  AreaPermiso,
  CrmActividadCliente,
  CrmCliente,
  CrmContacto,
  CrmCotizacion,
  CrmFuncionalidad,
  CrmPagoProgramado,
  CrmProyecto,
  NivelAcceso,
  RolCrm,
  UsuarioCrm
} from '../../models/crm-nativo.model';

/** Los permisos efectivos del usuario actual. */
export interface PermisosCrm {
  usuario: { id: string; correo: string; nombre: string };
  roles: string[];
  permisos: Record<AreaPermiso, NivelAcceso>;
  esDirector: boolean;
  esDelDueno: boolean;
  alcance?: {
    proyectos?: string[];
    clientes?: string[];
    empresas?: string[];
  };
}

/** Respuesta de responsable de proyecto. */
export interface ResponsableProyecto {
  nombre: string;
  correo?: string;
  puesto?: string;
}

/**
 * Servicio para comunicarse con el CRM nativo del puente.
 *
 * Obtiene los permisos del usuario al inicializar y expone signals reactivos
 * para consultar los datos según el rol del usuario.
 */
@Injectable({ providedIn: 'root' })
export class CrmService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(PORTAL_CONFIG);
  private readonly sesion = inject(SesionService);

  private readonly _permisos: WritableSignal<PermisosCrm | null> = signal(null);
  private readonly _cargando = signal(true);
  private readonly _error = signal<string | null>(null);

  /** Permisos del usuario actual o null si no tiene acceso. */
  readonly permisos: Signal<PermisosCrm | null> = this._permisos.asReadonly();

  /** Si está cargando los permisos. */
  readonly cargando = this._cargando.asReadonly();

  /** Error al cargar permisos. */
  readonly error = this._error.asReadonly();

  /** Si el usuario es Director (acceso total). */
  readonly esDirector = computed(() => this._permisos()?.esDirector ?? false);

  /** Si el usuario tiene acceso al CRM. */
  readonly tieneAcceso = computed(() => this._permisos() !== null);

  /** Si puede ver clientes. */
  readonly puedeVerClientes = computed(() =>
    this.tienePermiso('clientes', 'lectura')
  );

  /** Si puede editar clientes. */
  readonly puedeEditarClientes = computed(() =>
    this.tienePermiso('clientes', 'escritura')
  );

  /** Si puede ver proyectos. */
  readonly puedeVerProyectos = computed(() =>
    this.tienePermiso('proyectos', 'lectura')
  );

  /** Si puede ver cotizaciones. */
  readonly puedeVerCotizaciones = computed(() =>
    this.tienePermiso('cotizaciones', 'lectura')
  );

  /** Si puede ver cobranza. */
  readonly puedeVerCobranza = computed(() =>
    this.tienePermiso('cobranza', 'lectura')
  );

  /** Si puede editar cobranza. */
  readonly puedeEditarCobranza = computed(() =>
    this.tienePermiso('cobranza', 'escritura')
  );

  /** Si puede ver desarrollo. */
  readonly puedeVerDesarrollo = computed(() =>
    this.tienePermiso('desarrollo', 'lectura')
  );

  /** Si puede editar desarrollo. */
  readonly puedeEditarDesarrollo = computed(() =>
    this.tienePermiso('desarrollo', 'escritura')
  );

  constructor() {
    this.cargarPermisos();
  }

  private get baseUrl(): string {
    return this.config.gatewayUrl;
  }

  private get headers(): Record<string, string> {
    const token = this.sesion.token();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  private tienePermiso(
    area: AreaPermiso,
    nivel: 'lectura' | 'escritura'
  ): boolean {
    const permisos = this._permisos();
    if (!permisos) return false;
    const nivelArea = permisos.permisos[area];
    if (nivel === 'lectura') {
      return nivelArea === 'lectura' || nivelArea === 'escritura';
    }
    return nivelArea === 'escritura';
  }

  /** Carga los permisos del usuario actual. */
  cargarPermisos(): void {
    if (!this.sesion.token()) {
      this._permisos.set(null);
      this._cargando.set(false);
      return;
    }

    this._cargando.set(true);
    this._error.set(null);

    this.http
      .get<PermisosCrm>(`${this.baseUrl}/crm/mis-permisos`, {
        headers: this.headers
      })
      .pipe(
        tap((permisos) => {
          this._permisos.set(permisos);
          this._cargando.set(false);
        }),
        catchError((err) => {
          this._permisos.set(null);
          this._cargando.set(false);
          if (err.status === 401 || err.status === 403) {
            this._error.set('Sin acceso al CRM');
          } else {
            this._error.set(err.message || 'Error al cargar permisos');
          }
          return of(null);
        })
      )
      .subscribe();
  }

  // --- Clientes ---

  obtenerClientes(): Observable<CrmCliente[]> {
    return this.http.get<CrmCliente[]>(`${this.baseUrl}/crm/clientes`, {
      headers: this.headers
    });
  }

  obtenerCliente(id: string): Observable<CrmCliente> {
    return this.http.get<CrmCliente>(
      `${this.baseUrl}/crm/clientes/${encodeURIComponent(id)}`,
      { headers: this.headers }
    );
  }

  guardarCliente(cliente: Partial<CrmCliente>): Observable<CrmCliente> {
    return this.http.post<CrmCliente>(
      `${this.baseUrl}/crm/clientes/guardar`,
      cliente,
      { headers: this.headers }
    );
  }

  // --- Contactos ---

  obtenerContactos(clienteId?: string): Observable<CrmContacto[]> {
    const params = clienteId
      ? `?clienteId=${encodeURIComponent(clienteId)}`
      : '';
    return this.http.get<CrmContacto[]>(
      `${this.baseUrl}/crm/contactos${params}`,
      { headers: this.headers }
    );
  }

  guardarContacto(contacto: Partial<CrmContacto>): Observable<CrmContacto> {
    return this.http.post<CrmContacto>(
      `${this.baseUrl}/crm/contactos/guardar`,
      contacto,
      { headers: this.headers }
    );
  }

  // --- Proyectos ---

  obtenerProyectos(): Observable<CrmProyecto[]> {
    return this.http.get<CrmProyecto[]>(`${this.baseUrl}/crm/proyectos`, {
      headers: this.headers
    });
  }

  obtenerProyecto(id: string): Observable<CrmProyecto> {
    return this.http.get<CrmProyecto>(
      `${this.baseUrl}/crm/proyectos/${encodeURIComponent(id)}`,
      { headers: this.headers }
    );
  }

  obtenerResponsableProyecto(
    id: string
  ): Observable<ResponsableProyecto | null> {
    return this.http.get<ResponsableProyecto | null>(
      `${this.baseUrl}/crm/proyectos/${encodeURIComponent(id)}/responsable`,
      { headers: this.headers }
    );
  }

  guardarProyecto(proyecto: Partial<CrmProyecto>): Observable<CrmProyecto> {
    return this.http.post<CrmProyecto>(
      `${this.baseUrl}/crm/proyectos/guardar`,
      proyecto,
      { headers: this.headers }
    );
  }

  // --- Cotizaciones ---

  obtenerCotizaciones(proyectoId?: string): Observable<CrmCotizacion[]> {
    const params = proyectoId
      ? `?proyectoId=${encodeURIComponent(proyectoId)}`
      : '';
    return this.http.get<CrmCotizacion[]>(
      `${this.baseUrl}/crm/cotizaciones${params}`,
      { headers: this.headers }
    );
  }

  guardarCotizacion(
    cotizacion: Partial<CrmCotizacion>
  ): Observable<CrmCotizacion> {
    return this.http.post<CrmCotizacion>(
      `${this.baseUrl}/crm/cotizaciones/guardar`,
      cotizacion,
      { headers: this.headers }
    );
  }

  autorizarCotizacion(id: string): Observable<CrmCotizacion> {
    return this.http.post<CrmCotizacion>(
      `${this.baseUrl}/crm/cotizaciones/${encodeURIComponent(id)}/autorizar`,
      {},
      { headers: this.headers }
    );
  }

  registrarEnvioCotizacion(
    id: string,
    enviadaA: { nombre?: string; correo?: string },
    fechaEnvio?: string
  ): Observable<CrmCotizacion> {
    return this.http.post<CrmCotizacion>(
      `${this.baseUrl}/crm/cotizaciones/${encodeURIComponent(id)}/envio`,
      { enviadaA, fechaEnvio },
      { headers: this.headers }
    );
  }

  // --- Pagos ---

  obtenerPagos(cotizacionId?: string): Observable<CrmPagoProgramado[]> {
    const params = cotizacionId
      ? `?cotizacionId=${encodeURIComponent(cotizacionId)}`
      : '';
    return this.http.get<CrmPagoProgramado[]>(
      `${this.baseUrl}/crm/pagos${params}`,
      { headers: this.headers }
    );
  }

  guardarPago(pago: Partial<CrmPagoProgramado>): Observable<CrmPagoProgramado> {
    return this.http.post<CrmPagoProgramado>(
      `${this.baseUrl}/crm/pagos/guardar`,
      pago,
      { headers: this.headers }
    );
  }

  // --- Actividades ---

  obtenerActividades(
    clienteId?: string,
    proyectoId?: string
  ): Observable<CrmActividadCliente[]> {
    const params = new URLSearchParams();
    if (clienteId) params.set('clienteId', clienteId);
    if (proyectoId) params.set('proyectoId', proyectoId);
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<CrmActividadCliente[]>(
      `${this.baseUrl}/crm/actividades${query}`,
      { headers: this.headers }
    );
  }

  guardarActividad(
    actividad: Partial<CrmActividadCliente>
  ): Observable<CrmActividadCliente> {
    return this.http.post<CrmActividadCliente>(
      `${this.baseUrl}/crm/actividades/guardar`,
      actividad,
      { headers: this.headers }
    );
  }

  // --- Funcionalidades ---

  obtenerFuncionalidades(
    proyectoId?: string,
    responsableId?: string
  ): Observable<CrmFuncionalidad[]> {
    const params = new URLSearchParams();
    if (proyectoId) params.set('proyectoId', proyectoId);
    if (responsableId) params.set('responsableId', responsableId);
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<CrmFuncionalidad[]>(
      `${this.baseUrl}/crm/funcionalidades${query}`,
      { headers: this.headers }
    );
  }

  guardarFuncionalidad(
    funcionalidad: Partial<CrmFuncionalidad>
  ): Observable<CrmFuncionalidad> {
    return this.http.post<CrmFuncionalidad>(
      `${this.baseUrl}/crm/funcionalidades/guardar`,
      funcionalidad,
      { headers: this.headers }
    );
  }

  // --- Roles (solo Director) ---

  obtenerRoles(): Observable<RolCrm[]> {
    return this.http.get<RolCrm[]>(`${this.baseUrl}/crm/roles`, {
      headers: this.headers
    });
  }

  guardarRol(rol: Partial<RolCrm>): Observable<RolCrm> {
    return this.http.post<RolCrm>(`${this.baseUrl}/crm/roles/guardar`, rol, {
      headers: this.headers
    });
  }

  // --- Usuarios (solo Director) ---

  obtenerUsuarios(): Observable<UsuarioCrm[]> {
    return this.http.get<UsuarioCrm[]>(`${this.baseUrl}/crm/usuarios`, {
      headers: this.headers
    });
  }

  guardarUsuario(usuario: Partial<UsuarioCrm>): Observable<UsuarioCrm> {
    return this.http.post<UsuarioCrm>(
      `${this.baseUrl}/crm/usuarios/guardar`,
      usuario,
      { headers: this.headers }
    );
  }
}
