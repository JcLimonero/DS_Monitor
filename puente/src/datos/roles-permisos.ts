import type {
  AreaPermiso,
  NivelAcceso,
  RolCrm,
  UsuarioCrm
} from '../nucleo/contrato.js';

export type { AreaPermiso, NivelAcceso, RolCrm, UsuarioCrm };

/**
 * Sistema de control de acceso por roles para el CRM.
 *
 * - Carlos (Director) ve todo.
 * - Los demas usuarios ven segun sus roles y alcance.
 * - El filtrado se hace en el puente: las rutas no devuelven campos ni
 *   registros fuera del permiso.
 *
 * Areas personales de Carlos (solo Director):
 * licencias, correo, servidores, integraciones, configuracion.
 */

// --- Constantes ---

export const AREAS_PERMISO: AreaPermiso[] = [
  'clientes',
  'proyectos',
  'cotizaciones',
  'cobranza',
  'costos',
  'desarrollo',
  'actividades',
  'equipo',
  'licencias',
  'correo',
  'servidores',
  'integraciones',
  'configuracion'
];

/** Areas que solo el Director puede ver. */
export const AREAS_SOLO_DIRECTOR: AreaPermiso[] = [
  'licencias',
  'correo',
  'servidores',
  'integraciones',
  'configuracion'
];

export const NIVELES_ACCESO: NivelAcceso[] = [
  'ninguno',
  'lectura',
  'escritura'
];

// --- Roles de fabrica ---

const AHORA_INICIAL = '2026-01-01T00:00:00.000Z';

export const ROL_DIRECTOR: RolCrm = {
  id: 'director',
  nombre: 'Director',
  descripcion: 'Acceso completo a todo el sistema',
  permisos: {
    clientes: 'escritura',
    proyectos: 'escritura',
    cotizaciones: 'escritura',
    cobranza: 'escritura',
    costos: 'escritura',
    desarrollo: 'escritura',
    actividades: 'escritura',
    equipo: 'escritura',
    licencias: 'escritura',
    correo: 'escritura',
    servidores: 'escritura',
    integraciones: 'escritura',
    configuracion: 'escritura'
  },
  esSistema: true,
  actualizadoEn: AHORA_INICIAL
};

export const ROL_FINANZAS: RolCrm = {
  id: 'finanzas',
  nombre: 'Finanzas',
  descripcion: 'Cotizaciones, importes, costos, márgenes, pagos y cobranza',
  permisos: {
    clientes: 'lectura',
    proyectos: 'lectura',
    cotizaciones: 'lectura',
    cobranza: 'escritura',
    costos: 'lectura'
  },
  esSistema: true,
  actualizadoEn: AHORA_INICIAL
};

export const ROL_COMERCIAL: RolCrm = {
  id: 'comercial',
  nombre: 'Comercial',
  descripcion:
    'Clientes, contactos, proyectos, pipeline de cotizaciones y actividades (sin costos ni márgenes)',
  permisos: {
    clientes: 'escritura',
    proyectos: 'lectura',
    cotizaciones: 'lectura',
    actividades: 'escritura'
  },
  esSistema: true,
  actualizadoEn: AHORA_INICIAL
};

export const ROL_DESARROLLO: RolCrm = {
  id: 'desarrollo',
  nombre: 'Desarrollo',
  descripcion:
    'Funcionalidades y avance de los proyectos asignados (sin importes)',
  permisos: {
    proyectos: 'lectura',
    desarrollo: 'escritura'
  },
  esSistema: true,
  actualizadoEn: AHORA_INICIAL
};

export const ROLES_FABRICA: RolCrm[] = [
  ROL_DIRECTOR,
  ROL_FINANZAS,
  ROL_COMERCIAL,
  ROL_DESARROLLO
];

// --- Utilidades ---

function texto(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function idDeTexto(texto: string): string {
  return (
    texto
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'item'
  );
}

// --- Validacion ---

export function validarRol(
  crudo: unknown,
  previo: RolCrm | undefined,
  ahora: string
): RolCrm {
  const r = (crudo ?? {}) as Record<string, unknown>;
  const nombre = texto(r['nombre']);
  if (!nombre) {
    throw new Error('Cada rol necesita un nombre.');
  }
  const permisos: Partial<Record<AreaPermiso, NivelAcceso>> = {};
  const crudoPermisos = r['permisos'];
  if (crudoPermisos && typeof crudoPermisos === 'object') {
    for (const [area, nivel] of Object.entries(crudoPermisos)) {
      if (!AREAS_PERMISO.includes(area as AreaPermiso)) {
        throw new Error(`El área "${area}" no es válida.`);
      }
      if (!NIVELES_ACCESO.includes(nivel as NivelAcceso)) {
        throw new Error(`El nivel de acceso "${nivel}" no es válido.`);
      }
      if (nivel !== 'ninguno') {
        permisos[area as AreaPermiso] = nivel as NivelAcceso;
      }
    }
  }
  const id = texto(r['id']) ?? previo?.id ?? idDeTexto(nombre);
  const esSistema = previo?.esSistema ?? false;
  if (esSistema && ROLES_FABRICA.some((rf) => rf.id === id)) {
    throw new Error(
      `El rol "${nombre}" es de fábrica y no se puede modificar.`
    );
  }
  return {
    id,
    nombre: nombre.slice(0, 60),
    descripcion: texto(r['descripcion'])?.slice(0, 300),
    permisos,
    esSistema,
    actualizadoEn: ahora
  };
}

export function validarUsuarioCrm(
  crudo: unknown,
  previo: UsuarioCrm | undefined,
  ahora: string
): UsuarioCrm {
  const u = (crudo ?? {}) as Record<string, unknown>;
  const correo = texto(u['correo'])?.toLowerCase();
  const nombre = texto(u['nombre']);
  if (!correo) {
    throw new Error('Cada usuario necesita un correo.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
    throw new Error(`El correo "${correo}" no es válido.`);
  }
  if (!nombre) {
    throw new Error('Cada usuario necesita un nombre.');
  }
  const roles = Array.isArray(u['roles'])
    ? [...new Set((u['roles'] as unknown[]).map(String).filter(Boolean))]
    : (previo?.roles ?? []);
  let alcance: UsuarioCrm['alcance'];
  if (u['alcance'] && typeof u['alcance'] === 'object') {
    const a = u['alcance'] as Record<string, unknown>;
    alcance = {};
    if (Array.isArray(a['empresas'])) {
      alcance.empresas = (a['empresas'] as unknown[])
        .map(String)
        .filter(Boolean);
    }
    if (Array.isArray(a['clientes'])) {
      alcance.clientes = (a['clientes'] as unknown[])
        .map(String)
        .filter(Boolean);
    }
    if (Array.isArray(a['proyectos'])) {
      alcance.proyectos = (a['proyectos'] as unknown[])
        .map(String)
        .filter(Boolean);
    }
    if (
      !alcance.empresas?.length &&
      !alcance.clientes?.length &&
      !alcance.proyectos?.length
    ) {
      alcance = undefined;
    }
  }
  return {
    id: texto(u['id']) ?? previo?.id ?? idDeTexto(correo),
    correo,
    nombre: nombre.slice(0, 120),
    roles,
    alcance,
    activo: u['activo'] !== false,
    actualizadoEn: ahora
  };
}

// --- Calculo de permisos efectivos ---

/**
 * Calcula los permisos efectivos de un usuario combinando todos sus roles.
 * Si tiene varios roles, toma el nivel mas alto por area.
 */
export function permisosEfectivos(
  usuario: UsuarioCrm,
  roles: RolCrm[]
): Record<AreaPermiso, NivelAcceso> {
  const resultado: Record<AreaPermiso, NivelAcceso> = {} as Record<
    AreaPermiso,
    NivelAcceso
  >;
  for (const area of AREAS_PERMISO) {
    resultado[area] = 'ninguno';
  }
  if (!usuario.activo) {
    return resultado;
  }
  const rolesDelUsuario = roles.filter((r) => usuario.roles.includes(r.id));
  for (const rol of rolesDelUsuario) {
    for (const [area, nivel] of Object.entries(rol.permisos)) {
      const actual = resultado[area as AreaPermiso];
      if (nivel === 'escritura') {
        resultado[area as AreaPermiso] = 'escritura';
      } else if (nivel === 'lectura' && actual === 'ninguno') {
        resultado[area as AreaPermiso] = 'lectura';
      }
    }
  }
  return resultado;
}

/** Verifica si un usuario tiene al menos el nivel requerido en un area. */
export function tienePermiso(
  permisos: Record<AreaPermiso, NivelAcceso>,
  area: AreaPermiso,
  requerido: NivelAcceso
): boolean {
  const tiene = permisos[area];
  if (requerido === 'ninguno') return true;
  if (requerido === 'lectura')
    return tiene === 'lectura' || tiene === 'escritura';
  if (requerido === 'escritura') return tiene === 'escritura';
  return false;
}

/** Verifica si un usuario es Director (tiene acceso completo). */
export function esDirector(
  permisos: Record<AreaPermiso, NivelAcceso>
): boolean {
  return AREAS_SOLO_DIRECTOR.every(
    (area) => permisos[area] === 'escritura' || permisos[area] === 'lectura'
  );
}

// --- Filtrado por alcance ---

/** Verifica si un proyecto esta dentro del alcance del usuario. */
export function proyectoEnAlcance(
  proyectoId: string,
  clienteId: string,
  empresaAtiendeId: string | undefined,
  alcance: UsuarioCrm['alcance']
): boolean {
  if (!alcance) return true;
  if (alcance.proyectos?.includes(proyectoId)) return true;
  if (alcance.clientes?.includes(clienteId)) return true;
  if (empresaAtiendeId && alcance.empresas?.includes(empresaAtiendeId)) {
    return true;
  }
  return false;
}

/** Verifica si un cliente esta dentro del alcance del usuario. */
export function clienteEnAlcance(
  clienteId: string,
  alcance: UsuarioCrm['alcance']
): boolean {
  if (!alcance) return true;
  if (alcance.clientes?.includes(clienteId)) return true;
  return false;
}

// --- Filtrado de campos sensibles ---

/**
 * Campos que se ocultan segun el rol:
 * - Sin permiso 'costos': subtotal, iva, total, monto, costo (en cotizaciones y pagos)
 * - Sin permiso 'cobranza': datos de facturacion y pagos
 */
export interface CamposOcultos {
  ocultarCostos: boolean;
  ocultarCobranza: boolean;
}

export function camposOcultos(
  permisos: Record<AreaPermiso, NivelAcceso>
): CamposOcultos {
  return {
    ocultarCostos: !tienePermiso(permisos, 'costos', 'lectura'),
    ocultarCobranza: !tienePermiso(permisos, 'cobranza', 'lectura')
  };
}

/** Oculta campos de costos de una cotizacion. */
export function ocultarCostosCotizacion<
  T extends { subtotal?: number; iva?: number; total?: number }
>(cotizacion: T, ocultar: CamposOcultos): T {
  if (!ocultar.ocultarCostos) return cotizacion;
  const { subtotal, iva, total, ...resto } = cotizacion;
  void [subtotal, iva, total];
  return resto as T;
}

/** Oculta campos de costos de un pago. */
export function ocultarCostosPago<T extends { monto?: number }>(
  pago: T,
  ocultar: CamposOcultos
): T {
  if (!ocultar.ocultarCostos) return pago;
  const { monto, ...resto } = pago;
  void monto;
  return resto as T;
}

// --- Buscar usuario por correo ---

export function buscarUsuarioPorCorreo(
  correo: string,
  usuarios: UsuarioCrm[]
): UsuarioCrm | undefined {
  const clave = correo.trim().toLowerCase();
  return usuarios.find((u) => u.correo === clave && u.activo);
}

/** Buscar o crear usuario virtual para el Director (Carlos). */
export function usuarioDirector(correo: string): UsuarioCrm {
  return {
    id: 'director',
    correo: correo.toLowerCase(),
    nombre: 'Director',
    roles: ['director'],
    activo: true,
    actualizadoEn: new Date().toISOString()
  };
}
