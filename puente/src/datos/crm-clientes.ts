import type {
  CrmActividadCliente,
  CrmActividadClienteTipo,
  CrmCliente,
  CrmClienteTipo,
  CrmContacto,
  CrmCotizacion,
  CrmCotizacionEstatus,
  CrmEsquemaCobro,
  CrmFuncionalidad,
  CrmFuncionalidadEstado,
  CrmFuncionalidadPrioridad,
  CrmPagoEstatus,
  CrmPagoProgramado,
  CrmProximoPaso,
  CrmProyecto,
  CrmProyectoEstado,
  Person
} from '../nucleo/contrato.js';

export type {
  CrmActividadCliente,
  CrmCliente,
  CrmContacto,
  CrmCotizacion,
  CrmFuncionalidad,
  CrmPagoProgramado,
  CrmProyecto
};

/**
 * CRM nativo: clientes, contactos, proyectos, cotizaciones, pagos,
 * actividades y funcionalidades propios del grupo.
 * NO depende de Odoo ni de ningun emisor externo.
 *
 * Empresas: TechCorp, InnovateLabs, CloudWorks, DevHub.
 * (Itech Dev se maneja aparte, solo si Carlos lo pide.)
 */

// --- Constantes ---

export const TIPOS_CLIENTE: CrmClienteTipo[] = [
  'directo',
  'intermediario',
  'final'
];

export const ESTADOS_PROYECTO: CrmProyectoEstado[] = [
  'prospecto',
  'en_cotizacion',
  'aprobado',
  'en_desarrollo',
  'en_pruebas',
  'entregado',
  'en_soporte',
  'pausado',
  'cancelado'
];

export const ESQUEMAS_COBRO: CrmEsquemaCobro[] = [
  'unico',
  'parcialidades',
  'mensual'
];

export const ESTATUS_COTIZACION: CrmCotizacionEstatus[] = [
  'borrador',
  'enviada',
  'aprobada',
  'rechazada',
  'vencida',
  'obsoleta',
  'desconocido'
];

export const ESTATUS_PAGO: CrmPagoEstatus[] = [
  'por_facturar',
  'facturado',
  'pagado',
  'vencido'
];

export const TIPOS_ACTIVIDAD: CrmActividadClienteTipo[] = [
  'llamada',
  'junta',
  'correo',
  'nota'
];

export const ESTADOS_FUNCIONALIDAD: CrmFuncionalidadEstado[] = [
  'por_hacer',
  'en_progreso',
  'en_revision',
  'hecho',
  'bloqueado'
];

export const PRIORIDADES_FUNCIONALIDAD: CrmFuncionalidadPrioridad[] = [
  'baja',
  'media',
  'alta',
  'urgente'
];

// --- Utilidades ---

function sinAcentos(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function claveNombre(nombre: string): string {
  return sinAcentos(nombre).replace(/\s+/g, ' ').trim();
}

export function idDeTexto(texto: string): string {
  return (
    sinAcentos(texto)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'item'
  );
}

function texto(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function fechaValida(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

function numero(v: unknown, defecto = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : defecto;
}

function entero(v: unknown, defecto = 0): number {
  return typeof v === 'number' && Number.isInteger(v) ? v : defecto;
}

// --- Validacion de Cliente ---

export function validarCliente(
  crudo: unknown,
  previo: CrmCliente | undefined,
  ahora: string
): CrmCliente {
  const c = (crudo ?? {}) as Record<string, unknown>;
  const nombre = texto(c['nombre']);
  if (!nombre) {
    throw new Error('Cada cliente necesita un nombre.');
  }
  const tipo = texto(c['tipo']) as CrmClienteTipo | undefined;
  if (tipo && !TIPOS_CLIENTE.includes(tipo)) {
    throw new Error(
      `El tipo "${tipo}" no es válido. Usa: ${TIPOS_CLIENTE.join(', ')}.`
    );
  }
  return {
    id: texto(c['id']) ?? previo?.id ?? idDeTexto(nombre),
    nombre: nombre.slice(0, 120),
    razonSocial: texto(c['razonSocial'])?.slice(0, 200),
    rfc: texto(c['rfc'])?.slice(0, 20),
    tipo: tipo ?? previo?.tipo ?? 'directo',
    clienteFacturacionId: texto(c['clienteFacturacionId']),
    driveFolderUrl: texto(c['driveFolderUrl'])?.slice(0, 500),
    notas: texto(c['notas'])?.slice(0, 4000),
    actualizadoEn: ahora
  };
}

export function validarCatalogoClientes(
  crudos: unknown[],
  previos: CrmCliente[],
  ahora: string
): CrmCliente[] {
  const limpios = crudos.map((crudo) => {
    const id = (crudo as { id?: unknown } | null)?.id;
    const previo =
      typeof id === 'string' ? previos.find((p) => p.id === id) : undefined;
    return validarCliente(crudo, previo, ahora);
  });
  const ids = new Set<string>();
  const nombres = new Map<string, string>();
  for (const c of limpios) {
    while (ids.has(c.id)) {
      c.id = `${c.id}-2`;
    }
    ids.add(c.id);
    const clave = claveNombre(c.nombre);
    const repetido = nombres.get(clave);
    if (repetido) {
      throw new Error(
        `"${c.nombre}" y "${repetido}" son el mismo cliente: cada uno necesita un nombre distinto.`
      );
    }
    nombres.set(clave, c.nombre);
  }
  return limpios;
}

// --- Validacion de Contacto ---

export function validarContacto(
  crudo: unknown,
  previo: CrmContacto | undefined,
  ahora: string
): CrmContacto {
  const c = (crudo ?? {}) as Record<string, unknown>;
  const nombre = texto(c['nombre']);
  const clienteId = texto(c['clienteId']);
  if (!nombre) {
    throw new Error('Cada contacto necesita un nombre.');
  }
  if (!clienteId) {
    throw new Error('Cada contacto necesita un clienteId.');
  }
  const correo = texto(c['correo'])?.slice(0, 120);
  if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
    throw new Error(`El correo "${correo}" no es válido.`);
  }
  return {
    id: texto(c['id']) ?? previo?.id ?? idDeTexto(`${clienteId}-${nombre}`),
    clienteId,
    nombre: nombre.slice(0, 120),
    puesto: texto(c['puesto'])?.slice(0, 100),
    correo,
    telefono: texto(c['telefono'])?.slice(0, 30),
    esResponsableProyecto: c['esResponsableProyecto'] === true,
    actualizadoEn: ahora
  };
}

// --- Validacion de Proyecto ---

function validarPersona(crudo: unknown): Person | undefined {
  if (!crudo || typeof crudo !== 'object') return undefined;
  const v = crudo as Record<string, unknown>;
  const nombre = texto(v['name']) ?? texto(v['nombre']);
  if (!nombre) return undefined;
  return {
    id: texto(v['id']) ?? idDeTexto(nombre),
    name: nombre.slice(0, 120),
    email: texto(v['email']) ?? texto(v['correo'])
  };
}

export function validarProyecto(
  crudo: unknown,
  previo: CrmProyecto | undefined,
  ahora: string
): CrmProyecto {
  const p = (crudo ?? {}) as Record<string, unknown>;
  const nombre = texto(p['nombre']);
  const clienteId = texto(p['clienteId']);
  if (!nombre) {
    throw new Error('Cada proyecto necesita un nombre.');
  }
  if (!clienteId) {
    throw new Error('Cada proyecto necesita un clienteId.');
  }
  const estado = texto(p['estado']) as CrmProyectoEstado | undefined;
  if (estado && !ESTADOS_PROYECTO.includes(estado)) {
    throw new Error(
      `El estado "${estado}" no es válido. Usa: ${ESTADOS_PROYECTO.join(', ')}.`
    );
  }
  const repos = Array.isArray(p['repos'])
    ? (p['repos'] as unknown[]).map(String).filter(Boolean).slice(0, 20)
    : previo?.repos;
  const avancePct = numero(p['avancePct'], previo?.avancePct ?? 0);
  return {
    id: texto(p['id']) ?? previo?.id ?? idDeTexto(`${clienteId}-${nombre}`),
    clienteId,
    clienteFinalId: texto(p['clienteFinalId']),
    empresaAtiendeId: texto(p['empresaAtiendeId']),
    nombre: nombre.slice(0, 200),
    alcance: texto(p['alcance'])?.slice(0, 4000),
    responsableInterno: validarPersona(p['responsableInterno']),
    responsableClienteId: texto(p['responsableClienteId']),
    fechaInicio: fechaValida(p['fechaInicio']),
    fechaFinEstimada: fechaValida(p['fechaFinEstimada']),
    estado: estado ?? previo?.estado ?? 'prospecto',
    avancePct: Math.max(0, Math.min(100, avancePct)),
    driveUrl: texto(p['driveUrl'])?.slice(0, 500),
    repos,
    notas: texto(p['notas'])?.slice(0, 4000),
    actualizadoEn: ahora
  };
}

// --- Validacion de Cotizacion ---

export function validarCotizacion(
  crudo: unknown,
  previa: CrmCotizacion | undefined,
  ahora: string
): CrmCotizacion {
  const c = (crudo ?? {}) as Record<string, unknown>;
  const nombre = texto(c['nombre']);
  const proyectoId = texto(c['proyectoId']);
  if (!nombre) {
    throw new Error('Cada cotización necesita un nombre.');
  }
  if (!proyectoId) {
    throw new Error('Cada cotización necesita un proyectoId.');
  }
  const estatus = texto(c['estatus']) as CrmCotizacionEstatus | undefined;
  if (estatus && !ESTATUS_COTIZACION.includes(estatus)) {
    throw new Error(
      `El estatus "${estatus}" no es válido. Usa: ${ESTATUS_COTIZACION.join(', ')}.`
    );
  }
  const esquemaCobro = texto(c['esquemaCobro']) as CrmEsquemaCobro | undefined;
  if (esquemaCobro && !ESQUEMAS_COBRO.includes(esquemaCobro)) {
    throw new Error(
      `El esquema de cobro "${esquemaCobro}" no es válido. Usa: ${ESQUEMAS_COBRO.join(', ')}.`
    );
  }
  const subtotal = numero(c['subtotal'], previa?.subtotal ?? 0);
  const iva = numero(c['iva'], previa?.iva ?? 0);
  const total = numero(c['total'], previa?.total ?? subtotal + iva);
  return {
    id: texto(c['id']) ?? previa?.id ?? idDeTexto(`cot-${nombre}`),
    proyectoId,
    folio: texto(c['folio'])?.slice(0, 40),
    version: entero(c['version'], previa?.version),
    empresaFacturaId: texto(c['empresaFacturaId']),
    nombre: nombre.slice(0, 200),
    fechaEmision: fechaValida(c['fechaEmision']),
    vigenciaDias: entero(c['vigenciaDias'], previa?.vigenciaDias),
    fechaVencimiento: fechaValida(c['fechaVencimiento']),
    subtotal,
    iva,
    total,
    moneda: texto(c['moneda'])?.slice(0, 10) ?? previa?.moneda ?? 'MXN',
    esquemaCobro: esquemaCobro ?? previa?.esquemaCobro ?? 'unico',
    estatus: estatus ?? previa?.estatus ?? 'borrador',
    fechaEnvio: fechaValida(c['fechaEnvio']),
    enviadaAId: texto(c['enviadaAId']),
    autorizadaPorCarlosEn: fechaValida(c['autorizadaPorCarlosEn']),
    fechaAprobacion: fechaValida(c['fechaAprobacion']),
    aprobadoPor: texto(c['aprobadoPor'])?.slice(0, 120),
    ordenCompra: texto(c['ordenCompra'])?.slice(0, 60),
    pdfUrl: texto(c['pdfUrl'])?.slice(0, 500),
    cotizacionExternaId: texto(c['cotizacionExternaId']),
    actualizadoEn: ahora
  };
}

// --- Validacion de Pago Programado ---

export function validarPagoProgramado(
  crudo: unknown,
  previo: CrmPagoProgramado | undefined,
  ahora: string
): CrmPagoProgramado {
  const p = (crudo ?? {}) as Record<string, unknown>;
  const cotizacionId = texto(p['cotizacionId']);
  if (!cotizacionId) {
    throw new Error('Cada pago programado necesita un cotizacionId.');
  }
  const estatus = texto(p['estatus']) as CrmPagoEstatus | undefined;
  if (estatus && !ESTATUS_PAGO.includes(estatus)) {
    throw new Error(
      `El estatus "${estatus}" no es válido. Usa: ${ESTATUS_PAGO.join(', ')}.`
    );
  }
  const fechaEsperada = fechaValida(p['fechaEsperada']);
  if (!fechaEsperada && !previo?.fechaEsperada) {
    throw new Error('Cada pago programado necesita una fechaEsperada.');
  }
  const numero_ = entero(p['numero'], previo?.numero ?? 1);
  const totalPagos = entero(p['totalPagos'], previo?.totalPagos ?? 1);
  return {
    id:
      texto(p['id']) ??
      previo?.id ??
      idDeTexto(`pago-${cotizacionId}-${numero_}`),
    cotizacionId,
    numero: numero_,
    totalPagos,
    monto: numero(p['monto'], previo?.monto ?? 0),
    moneda: texto(p['moneda'])?.slice(0, 10) ?? previo?.moneda ?? 'MXN',
    fechaEsperada: fechaEsperada ?? previo!.fechaEsperada,
    estatus: estatus ?? previo?.estatus ?? 'por_facturar',
    fechaPagoReal: fechaValida(p['fechaPagoReal']),
    nota: texto(p['nota'])?.slice(0, 200),
    actualizadoEn: ahora
  };
}

// --- Validacion de Actividad ---

function validarProximoPaso(crudo: unknown): CrmProximoPaso | undefined {
  if (!crudo || typeof crudo !== 'object') return undefined;
  const p = crudo as Record<string, unknown>;
  const descripcion = texto(p['descripcion']);
  const fecha = fechaValida(p['fecha']);
  if (!descripcion || !fecha) return undefined;
  return { descripcion: descripcion.slice(0, 500), fecha };
}

export function validarActividad(
  crudo: unknown,
  previa: CrmActividadCliente | undefined,
  ahora: string
): CrmActividadCliente {
  const a = (crudo ?? {}) as Record<string, unknown>;
  const resumen = texto(a['resumen']);
  const clienteId = texto(a['clienteId']);
  if (!resumen) {
    throw new Error('Cada actividad necesita un resumen.');
  }
  if (!clienteId) {
    throw new Error('Cada actividad necesita un clienteId.');
  }
  const tipo = texto(a['tipo']) as CrmActividadClienteTipo | undefined;
  if (tipo && !TIPOS_ACTIVIDAD.includes(tipo)) {
    throw new Error(
      `El tipo "${tipo}" no es válido. Usa: ${TIPOS_ACTIVIDAD.join(', ')}.`
    );
  }
  const fecha = fechaValida(a['fecha']) ?? ahora;
  return {
    id: texto(a['id']) ?? previa?.id ?? idDeTexto(`act-${Date.now()}`),
    clienteId,
    proyectoId: texto(a['proyectoId']),
    cotizacionId: texto(a['cotizacionId']),
    tipo: tipo ?? previa?.tipo ?? 'nota',
    resumen: resumen.slice(0, 1000),
    fecha,
    proximoPaso: validarProximoPaso(a['proximoPaso']),
    responsable: validarPersona(a['responsable']),
    actualizadoEn: ahora
  };
}

// --- Validacion de Funcionalidad ---

export function validarFuncionalidad(
  crudo: unknown,
  previa: CrmFuncionalidad | undefined,
  ahora: string
): CrmFuncionalidad {
  const f = (crudo ?? {}) as Record<string, unknown>;
  const titulo = texto(f['titulo']);
  const proyectoId = texto(f['proyectoId']);
  if (!titulo) {
    throw new Error('Cada funcionalidad necesita un título.');
  }
  if (!proyectoId) {
    throw new Error('Cada funcionalidad necesita un proyectoId.');
  }
  const estado = texto(f['estado']) as CrmFuncionalidadEstado | undefined;
  if (estado && !ESTADOS_FUNCIONALIDAD.includes(estado)) {
    throw new Error(
      `El estado "${estado}" no es válido. Usa: ${ESTADOS_FUNCIONALIDAD.join(', ')}.`
    );
  }
  const prioridad = texto(f['prioridad']) as
    CrmFuncionalidadPrioridad | undefined;
  if (prioridad && !PRIORIDADES_FUNCIONALIDAD.includes(prioridad)) {
    throw new Error(
      `La prioridad "${prioridad}" no es válida. Usa: ${PRIORIDADES_FUNCIONALIDAD.join(', ')}.`
    );
  }
  return {
    id: texto(f['id']) ?? previa?.id ?? idDeTexto(`func-${titulo}`),
    proyectoId,
    titulo: titulo.slice(0, 200),
    descripcion: texto(f['descripcion'])?.slice(0, 2000),
    estado: estado ?? previa?.estado ?? 'por_hacer',
    responsableId: texto(f['responsableId']),
    prioridad: prioridad ?? previa?.prioridad ?? 'media',
    fechaCompromiso: fechaValida(f['fechaCompromiso']),
    enlace: texto(f['enlace'])?.slice(0, 500),
    pendienteId: texto(f['pendienteId']),
    orden: entero(f['orden'], previa?.orden),
    actualizadoEn: ahora
  };
}

// --- Consultas utiles ---

/** Busca un cliente por id o por nombre. */
export function buscarCliente(
  clientes: CrmCliente[],
  busqueda: string
): CrmCliente | undefined {
  const clave = claveNombre(busqueda);
  return (
    clientes.find((c) => c.id === busqueda) ??
    clientes.find((c) => claveNombre(c.nombre) === clave)
  );
}

/** El responsable de un proyecto (del lado del cliente). */
export function responsableDeProyecto(
  proyecto: CrmProyecto,
  contactos: CrmContacto[]
): CrmContacto | undefined {
  if (!proyecto.responsableClienteId) return undefined;
  return contactos.find((c) => c.id === proyecto.responsableClienteId);
}

/** El responsable por omision de un cliente: el contacto marcado. */
export function responsableDeCliente(
  clienteId: string,
  contactos: CrmContacto[]
): CrmContacto | undefined {
  return contactos.find(
    (c) => c.clienteId === clienteId && c.esResponsableProyecto
  );
}

/** Todos los contactos de un cliente. */
export function contactosDeCliente(
  clienteId: string,
  contactos: CrmContacto[]
): CrmContacto[] {
  return contactos.filter((c) => c.clienteId === clienteId);
}

/** Todos los proyectos de un cliente. */
export function proyectosDeCliente(
  clienteId: string,
  proyectos: CrmProyecto[]
): CrmProyecto[] {
  return proyectos.filter((p) => p.clienteId === clienteId);
}

/** Todas las cotizaciones de un proyecto. */
export function cotizacionesDeProyecto(
  proyectoId: string,
  cotizaciones: CrmCotizacion[]
): CrmCotizacion[] {
  return cotizaciones.filter((c) => c.proyectoId === proyectoId);
}

/** Todos los pagos programados de una cotizacion. */
export function pagosDeCoitzacion(
  cotizacionId: string,
  pagos: CrmPagoProgramado[]
): CrmPagoProgramado[] {
  return pagos.filter((p) => p.cotizacionId === cotizacionId);
}

/** Todas las actividades de un cliente. */
export function actividadesDeCliente(
  clienteId: string,
  actividades: CrmActividadCliente[]
): CrmActividadCliente[] {
  return actividades.filter((a) => a.clienteId === clienteId);
}

/** Todas las funcionalidades de un proyecto. */
export function funcionalidadesDeProyecto(
  proyectoId: string,
  funcionalidades: CrmFuncionalidad[]
): CrmFuncionalidad[] {
  return funcionalidades.filter((f) => f.proyectoId === proyectoId);
}

/** Funcionalidades asignadas a un miembro del equipo. */
export function funcionalidadesDePersona(
  responsableId: string,
  funcionalidades: CrmFuncionalidad[]
): CrmFuncionalidad[] {
  return funcionalidades.filter((f) => f.responsableId === responsableId);
}

/** Busca el cliente de facturacion (el que factura a este). */
export function clienteFacturacion(
  cliente: CrmCliente,
  clientes: CrmCliente[]
): CrmCliente | undefined {
  if (!cliente.clienteFacturacionId) return undefined;
  return clientes.find((c) => c.id === cliente.clienteFacturacionId);
}

/** Busca los clientes finales de un cliente de facturacion. */
export function clientesFinales(
  clienteFacturacionId: string,
  clientes: CrmCliente[]
): CrmCliente[] {
  return clientes.filter(
    (c) => c.clienteFacturacionId === clienteFacturacionId
  );
}

/** Calcula el avance de un proyecto segun sus funcionalidades. */
export function calcularAvanceProyecto(
  proyectoId: string,
  funcionalidades: CrmFuncionalidad[]
): number {
  const del = funcionalidadesDeProyecto(proyectoId, funcionalidades);
  if (del.length === 0) return 0;
  const hechas = del.filter((f) => f.estado === 'hecho').length;
  return Math.round((hechas / del.length) * 100);
}

/** Total por cobrar de una cotizacion (pagos no pagados). */
export function porCobrarDeCotizacion(
  cotizacionId: string,
  pagos: CrmPagoProgramado[]
): number {
  return pagosDeCoitzacion(cotizacionId, pagos)
    .filter((p) => p.estatus !== 'pagado')
    .reduce((sum, p) => sum + p.monto, 0);
}

/** Total cobrado de una cotizacion (pagos pagados). */
export function cobradoDeCotizacion(
  cotizacionId: string,
  pagos: CrmPagoProgramado[]
): number {
  return pagosDeCoitzacion(cotizacionId, pagos)
    .filter((p) => p.estatus === 'pagado')
    .reduce((sum, p) => sum + p.monto, 0);
}

/** Pagos vencidos (fecha esperada pasada y no pagados). */
export function pagosVencidos(
  pagos: CrmPagoProgramado[],
  ahora = new Date()
): CrmPagoProgramado[] {
  return pagos.filter(
    (p) =>
      p.estatus !== 'pagado' && Date.parse(p.fechaEsperada) < ahora.getTime()
  );
}

/** Pagos proximos a vencer (en los proximos N dias). */
export function pagosPorVencer(
  pagos: CrmPagoProgramado[],
  dias: number,
  ahora = new Date()
): CrmPagoProgramado[] {
  const limite = ahora.getTime() + dias * 86_400_000;
  return pagos.filter(
    (p) =>
      p.estatus !== 'pagado' &&
      Date.parse(p.fechaEsperada) >= ahora.getTime() &&
      Date.parse(p.fechaEsperada) <= limite
  );
}
