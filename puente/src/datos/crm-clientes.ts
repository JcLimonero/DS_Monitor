import type {
  CrmActividadCliente,
  CrmActividadClienteTipo,
  CrmAvanceProyecto,
  CrmCambioEtapa,
  CrmCliente,
  CrmClienteTipo,
  CrmContacto,
  CrmCotizacion,
  CrmCotizacionEstatus,
  CrmCotizacionTipo,
  CrmEsquemaCobro,
  CrmEtapaComercial,
  CrmFactura,
  CrmFuenteAvance,
  CrmFuncionalidad,
  CrmFuncionalidadEstado,
  CrmFuncionalidadPrioridad,
  CrmHito,
  CrmOrdenCompra,
  CrmPagoEstatus,
  CrmPagoProgramado,
  CrmPartida,
  CrmProximoPaso,
  CrmProyecto,
  CrmProyectoEstado,
  CrmRiesgo,
  CrmTipoRiesgo,
  Person
} from '../nucleo/contrato.js';

export type {
  CrmActividadCliente,
  CrmAvanceProyecto,
  CrmCambioEtapa,
  CrmCliente,
  CrmContacto,
  CrmCotizacion,
  CrmFactura,
  CrmFuncionalidad,
  CrmHito,
  CrmOrdenCompra,
  CrmPagoProgramado,
  CrmPartida,
  CrmProyecto,
  CrmRiesgo
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
  'cancelado',
  'por_confirmar'
];

export const ESQUEMAS_COBRO: CrmEsquemaCobro[] = [
  'unico',
  'parcialidades',
  'mensual',
  'mixto',
  'anual',
  'cuatrimestral',
  'bolsa_horas',
  'por_definir'
];

export const TIPOS_COTIZACION: CrmCotizacionTipo[] = [
  'venta',
  'interna',
  'gasto'
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
  'vencido',
  'por_confirmar'
];

export const TIPOS_ACTIVIDAD: CrmActividadClienteTipo[] = [
  'llamada',
  'junta',
  'correo',
  'nota'
];

export const ETAPAS_COMERCIALES: CrmEtapaComercial[] = [
  'prospecto',
  'en_cotizacion',
  'cotizacion_enviada',
  'negociacion',
  'ganado',
  'perdido',
  'por_confirmar'
];

export const FUENTES_AVANCE: CrmFuenteAvance[] = [
  'daily',
  'correo',
  'teams',
  'manual',
  'bot'
];

export const TIPOS_RIESGO: CrmTipoRiesgo[] = ['riesgo', 'bloqueo'];

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

function numeroNullable(
  v: unknown,
  defecto: number | null | undefined
): number | null | undefined {
  if (v === null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return defecto;
}

function entero(v: unknown, defecto = 0): number {
  return typeof v === 'number' && Number.isInteger(v) ? v : defecto;
}

function enteroOpcional(v: unknown, defecto?: number): number | undefined {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  return defecto;
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
    estado: estado ?? previo?.estado,
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
  const proyectoId = texto(c['proyectoId']) ?? previa?.proyectoId;
  const clienteId = texto(c['clienteId']) ?? previa?.clienteId;
  if (!nombre) {
    throw new Error('Cada cotización necesita un nombre.');
  }
  if (!proyectoId && !clienteId) {
    throw new Error('Cada cotización necesita un proyectoId o un clienteId.');
  }
  const estatus = texto(c['estatus']) as CrmCotizacionEstatus | undefined;
  if (estatus && !ESTATUS_COTIZACION.includes(estatus)) {
    throw new Error(
      `El estatus "${estatus}" no es válido. Usa: ${ESTATUS_COTIZACION.join(', ')}.`
    );
  }
  const esquemaCobroTexto = texto(c['esquemaCobro']);
  const esquemaCobro =
    esquemaCobroTexto === null
      ? null
      : (esquemaCobroTexto as CrmEsquemaCobro | undefined);
  if (esquemaCobro && !ESQUEMAS_COBRO.includes(esquemaCobro)) {
    throw new Error(
      `El esquema de cobro "${esquemaCobro}" no es válido. Usa: ${ESQUEMAS_COBRO.join(', ')}.`
    );
  }
  const tipo = texto(c['tipo']) as CrmCotizacionTipo | undefined;
  if (tipo && !TIPOS_COTIZACION.includes(tipo)) {
    throw new Error(
      `El tipo "${tipo}" no es válido. Usa: ${TIPOS_COTIZACION.join(', ')}.`
    );
  }
  const subtotal = numeroNullable(c['subtotal'], previa?.subtotal);
  const iva = numeroNullable(c['iva'], previa?.iva);
  const total = numeroNullable(c['total'], previa?.total);
  return {
    id: texto(c['id']) ?? previa?.id ?? idDeTexto(`cot-${nombre}`),
    clienteId,
    proyectoId,
    folio: texto(c['folio'])?.slice(0, 40),
    version: enteroOpcional(c['version'], previa?.version),
    empresaFacturaId: texto(c['empresaFacturaId']),
    empresaReceptoraId: texto(c['empresaReceptoraId']),
    tipo: tipo ?? previa?.tipo,
    nombre: nombre.slice(0, 200),
    fechaEmision: fechaValida(c['fechaEmision']),
    vigenciaDias: enteroOpcional(c['vigenciaDias'], previa?.vigenciaDias),
    fechaVencimiento: fechaValida(c['fechaVencimiento']),
    subtotal,
    iva,
    total,
    moneda: texto(c['moneda'])?.slice(0, 10) ?? previa?.moneda ?? 'MXN',
    esquemaCobro:
      c['esquemaCobro'] === null
        ? null
        : (esquemaCobro ?? previa?.esquemaCobro),
    estatus: estatus ?? previa?.estatus,
    fechaEnvio: fechaValida(c['fechaEnvio']),
    enviadaAId: texto(c['enviadaAId']),
    autorizadaPorCarlosEn: fechaValida(c['autorizadaPorCarlosEn']),
    fechaAprobacion: fechaValida(c['fechaAprobacion']),
    aprobadoPor: texto(c['aprobadoPor'])?.slice(0, 120),
    ordenCompra: texto(c['ordenCompra'])?.slice(0, 60),
    pdfUrl: texto(c['pdfUrl'])?.slice(0, 500),
    cotizacionExternaId: texto(c['cotizacionExternaId']),
    notas: texto(c['notas'])?.slice(0, 4000),
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
  const cotizacionId = texto(p['cotizacionId']) ?? previo?.cotizacionId;
  const proyectoId = texto(p['proyectoId']) ?? previo?.proyectoId;
  const clienteId = texto(p['clienteId']) ?? previo?.clienteId;
  if (!cotizacionId && !proyectoId && !clienteId) {
    throw new Error(
      'Cada pago necesita un cotizacionId, proyectoId o clienteId.'
    );
  }
  const estatus = texto(p['estatus']) as CrmPagoEstatus | undefined;
  if (estatus && !ESTATUS_PAGO.includes(estatus)) {
    throw new Error(
      `El estatus "${estatus}" no es válido. Usa: ${ESTATUS_PAGO.join(', ')}.`
    );
  }
  const fechaEsperadaRaw = p['fechaEsperada'];
  const fechaEsperada =
    fechaEsperadaRaw === null
      ? null
      : (fechaValida(fechaEsperadaRaw) ?? previo?.fechaEsperada);
  const fechaPorConfirmar =
    fechaEsperada === null || p['fechaPorConfirmar'] === true;
  const numero_ = enteroOpcional(p['numero'], previo?.numero);
  const totalPagos = enteroOpcional(p['totalPagos'], previo?.totalPagos);
  const monto = numeroNullable(p['monto'], previo?.monto);
  const idBase = cotizacionId ?? proyectoId ?? clienteId;
  return {
    id:
      texto(p['id']) ??
      previo?.id ??
      idDeTexto(`pago-${idBase}-${numero_ ?? 'x'}`),
    cotizacionId,
    proyectoId,
    clienteId,
    numero: numero_,
    totalPagos,
    monto,
    moneda: texto(p['moneda'])?.slice(0, 10) ?? previo?.moneda ?? 'MXN',
    fechaEsperada,
    fechaPorConfirmar,
    estatus: estatus ?? previo?.estatus,
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

/** Total por cobrar de una cotizacion (pagos no pagados con monto conocido). */
export function porCobrarDeCotizacion(
  cotizacionId: string,
  pagos: CrmPagoProgramado[]
): number {
  return pagosDeCoitzacion(cotizacionId, pagos)
    .filter((p) => p.estatus !== 'pagado' && p.monto != null)
    .reduce((sum, p) => sum + (p.monto ?? 0), 0);
}

/** Total cobrado de una cotizacion (pagos pagados con monto conocido). */
export function cobradoDeCotizacion(
  cotizacionId: string,
  pagos: CrmPagoProgramado[]
): number {
  return pagosDeCoitzacion(cotizacionId, pagos)
    .filter((p) => p.estatus === 'pagado' && p.monto != null)
    .reduce((sum, p) => sum + (p.monto ?? 0), 0);
}

/** Pagos vencidos (fecha esperada pasada y no pagados). Ignora pagos sin fecha. */
export function pagosVencidos(
  pagos: CrmPagoProgramado[],
  ahora = new Date()
): CrmPagoProgramado[] {
  return pagos.filter((p) => {
    if (p.estatus === 'pagado' || !p.fechaEsperada) return false;
    return Date.parse(p.fechaEsperada) < ahora.getTime();
  });
}

/** Pagos proximos a vencer (en los proximos N dias). Ignora pagos sin fecha. */
export function pagosPorVencer(
  pagos: CrmPagoProgramado[],
  dias: number,
  ahora = new Date()
): CrmPagoProgramado[] {
  const limite = ahora.getTime() + dias * 86_400_000;
  return pagos.filter((p) => {
    if (p.estatus === 'pagado' || !p.fechaEsperada) return false;
    const fecha = Date.parse(p.fechaEsperada);
    return fecha >= ahora.getTime() && fecha <= limite;
  });
}

// --- Fase 2: Validacion de Orden de Compra ---

export function validarOrdenCompra(
  crudo: unknown,
  previa: CrmOrdenCompra | undefined,
  ahora: string
): CrmOrdenCompra {
  const o = (crudo ?? {}) as Record<string, unknown>;
  const clienteId = texto(o['clienteId']);
  const folio = texto(o['folio']);
  if (!clienteId) {
    throw new Error('Cada orden de compra necesita un clienteId.');
  }
  if (!folio) {
    throw new Error('Cada orden de compra necesita un folio.');
  }
  const pagoIds = Array.isArray(o['pagoIds'])
    ? (o['pagoIds'] as unknown[]).map(String).filter(Boolean)
    : previa?.pagoIds;
  return {
    id: texto(o['id']) ?? previa?.id ?? idDeTexto(`oc-${folio}`),
    clienteId,
    proyectoId: texto(o['proyectoId']),
    folio: folio.slice(0, 60),
    periodo: texto(o['periodo'])?.slice(0, 60),
    monto: numeroNullable(o['monto'], previa?.monto),
    moneda: texto(o['moneda'])?.slice(0, 10) ?? previa?.moneda ?? 'MXN',
    fechaEmision: fechaValida(o['fechaEmision']),
    fechaVencimiento: fechaValida(o['fechaVencimiento']),
    pagoIds,
    notas: texto(o['notas'])?.slice(0, 2000),
    actualizadoEn: ahora
  };
}

// --- Fase 2: Validacion de Factura ---

export function validarFactura(
  crudo: unknown,
  previa: CrmFactura | undefined,
  ahora: string
): CrmFactura {
  const f = (crudo ?? {}) as Record<string, unknown>;
  const empresaEmisoraId = texto(f['empresaEmisoraId']);
  const clienteId = texto(f['clienteId']);
  if (!empresaEmisoraId) {
    throw new Error('Cada factura necesita una empresaEmisoraId.');
  }
  if (!clienteId) {
    throw new Error('Cada factura necesita un clienteId.');
  }
  const pagoIds = Array.isArray(f['pagoIds'])
    ? (f['pagoIds'] as unknown[]).map(String).filter(Boolean)
    : previa?.pagoIds;
  const uuid = texto(f['uuid'])?.slice(0, 40);
  const folio = texto(f['folio'])?.slice(0, 40);
  return {
    id:
      texto(f['id']) ??
      previa?.id ??
      idDeTexto(`fac-${uuid ?? folio ?? Date.now()}`),
    empresaEmisoraId,
    clienteId,
    proyectoId: texto(f['proyectoId']),
    uuid,
    folio,
    fechaEmision: fechaValida(f['fechaEmision']),
    subtotal: numeroNullable(f['subtotal'], previa?.subtotal),
    iva: numeroNullable(f['iva'], previa?.iva),
    total: numeroNullable(f['total'], previa?.total),
    moneda: texto(f['moneda'])?.slice(0, 10) ?? previa?.moneda ?? 'MXN',
    fechaPagoReal: fechaValida(f['fechaPagoReal']),
    tieneComplemento: f['tieneComplemento'] === true,
    fechaComplemento: fechaValida(f['fechaComplemento']),
    uuidComplemento: texto(f['uuidComplemento'])?.slice(0, 40),
    pagoIds,
    archivoUrl: texto(f['archivoUrl'])?.slice(0, 500),
    notas: texto(f['notas'])?.slice(0, 2000),
    actualizadoEn: ahora
  };
}

// --- Fase 2: Validacion de Partida ---

export function validarPartida(
  crudo: unknown,
  previa: CrmPartida | undefined,
  ahora: string
): CrmPartida {
  const p = (crudo ?? {}) as Record<string, unknown>;
  const cotizacionId = texto(p['cotizacionId']);
  const descripcion = texto(p['descripcion']);
  if (!cotizacionId) {
    throw new Error('Cada partida necesita un cotizacionId.');
  }
  if (!descripcion) {
    throw new Error('Cada partida necesita una descripción.');
  }
  const numero_ = entero(p['numero'], previa?.numero ?? 1);
  return {
    id:
      texto(p['id']) ??
      previa?.id ??
      idDeTexto(`part-${cotizacionId}-${numero_}`),
    cotizacionId,
    numero: numero_,
    descripcion: descripcion.slice(0, 500),
    cantidad: numero(p['cantidad'], previa?.cantidad ?? 1),
    precioUnitario: numeroNullable(p['precioUnitario'], previa?.precioUnitario),
    importe: numeroNullable(p['importe'], previa?.importe),
    costoUnitario: numeroNullable(p['costoUnitario'], previa?.costoUnitario),
    costoTotal: numeroNullable(p['costoTotal'], previa?.costoTotal),
    moneda: texto(p['moneda'])?.slice(0, 10) ?? previa?.moneda ?? 'MXN',
    notas: texto(p['notas'])?.slice(0, 500),
    actualizadoEn: ahora
  };
}

// --- Fase 2: Ocultar costos de partidas ---

export function ocultarCostosPartida<
  T extends {
    costoUnitario?: number | null;
    costoTotal?: number | null;
  }
>(partida: T, ocultarCostos: boolean): T {
  if (!ocultarCostos) return partida;
  const { costoUnitario, costoTotal, ...resto } = partida;
  return resto as T;
}

/** Calcula el margen de una cotizacion a partir de sus partidas. */
export function margenDeCotizacion(
  cotizacionId: string,
  partidas: CrmPartida[]
): { venta: number; costo: number; margen: number; margenPct: number } | null {
  const deEsta = partidas.filter((p) => p.cotizacionId === cotizacionId);
  if (deEsta.length === 0) return null;
  const venta = deEsta
    .filter((p) => p.importe != null)
    .reduce((sum, p) => sum + (p.importe ?? 0), 0);
  const costo = deEsta
    .filter((p) => p.costoTotal != null)
    .reduce((sum, p) => sum + (p.costoTotal ?? 0), 0);
  const margen = venta - costo;
  const margenPct = venta > 0 ? (margen / venta) * 100 : 0;
  return { venta, costo, margen, margenPct };
}

// --- Kanban y seguimiento: validaciones ---

export function validarCambioEtapa(
  crudo: unknown,
  previo: CrmCambioEtapa | undefined,
  ahora: string
): CrmCambioEtapa {
  const c = (crudo ?? {}) as Record<string, unknown>;
  const proyectoId = texto(c['proyectoId']);
  const etapaNueva = texto(c['etapaNueva']) as CrmEtapaComercial | undefined;
  if (!proyectoId) {
    throw new Error('Cada cambio de etapa necesita un proyectoId.');
  }
  if (!etapaNueva || !ETAPAS_COMERCIALES.includes(etapaNueva)) {
    throw new Error(
      `La etapa "${etapaNueva}" no es válida. Usa: ${ETAPAS_COMERCIALES.join(', ')}.`
    );
  }
  const etapaAnterior = texto(c['etapaAnterior']) as
    CrmEtapaComercial | undefined;
  if (etapaAnterior && !ETAPAS_COMERCIALES.includes(etapaAnterior)) {
    throw new Error(
      `La etapa anterior "${etapaAnterior}" no es válida. Usa: ${ETAPAS_COMERCIALES.join(', ')}.`
    );
  }
  const fecha = fechaValida(c['fecha']) ?? ahora;
  return {
    id: texto(c['id']) ?? previo?.id ?? idDeTexto(`ce-${proyectoId}-${fecha}`),
    proyectoId,
    etapaAnterior,
    etapaNueva,
    autor: validarPersona(c['autor']),
    fecha,
    nota: texto(c['nota'])?.slice(0, 500),
    actualizadoEn: ahora
  };
}

export function validarAvanceProyecto(
  crudo: unknown,
  previo: CrmAvanceProyecto | undefined,
  ahora: string
): CrmAvanceProyecto {
  const a = (crudo ?? {}) as Record<string, unknown>;
  const proyectoId = texto(a['proyectoId']);
  const nota = texto(a['nota']);
  if (!proyectoId) {
    throw new Error('Cada avance necesita un proyectoId.');
  }
  if (!nota) {
    throw new Error('Cada avance necesita una nota.');
  }
  const fuente = texto(a['fuente']) as CrmFuenteAvance | undefined;
  if (!fuente || !FUENTES_AVANCE.includes(fuente)) {
    throw new Error(
      `La fuente "${fuente}" no es válida. Usa: ${FUENTES_AVANCE.join(', ')}.`
    );
  }
  const estadoAnterior = texto(a['estadoAnterior']) as
    CrmProyectoEstado | undefined;
  const estadoNuevo = texto(a['estadoNuevo']) as CrmProyectoEstado | undefined;
  if (estadoAnterior && !ESTADOS_PROYECTO.includes(estadoAnterior)) {
    throw new Error(`El estado anterior "${estadoAnterior}" no es válido.`);
  }
  if (estadoNuevo && !ESTADOS_PROYECTO.includes(estadoNuevo)) {
    throw new Error(`El estado nuevo "${estadoNuevo}" no es válido.`);
  }
  const fecha = fechaValida(a['fecha']) ?? ahora;
  const avancePct = enteroOpcional(a['avancePct'], previo?.avancePct);
  return {
    id: texto(a['id']) ?? previo?.id ?? idDeTexto(`av-${proyectoId}-${fecha}`),
    proyectoId,
    fecha,
    nota: nota.slice(0, 2000),
    avancePct:
      avancePct !== undefined
        ? Math.max(0, Math.min(100, avancePct))
        : undefined,
    fuente,
    autor: validarPersona(a['autor']),
    estadoAnterior,
    estadoNuevo,
    actualizadoEn: ahora
  };
}

export function validarHito(
  crudo: unknown,
  previo: CrmHito | undefined,
  ahora: string
): CrmHito {
  const h = (crudo ?? {}) as Record<string, unknown>;
  const proyectoId = texto(h['proyectoId']);
  const nombre = texto(h['nombre']);
  if (!proyectoId) {
    throw new Error('Cada hito necesita un proyectoId.');
  }
  if (!nombre) {
    throw new Error('Cada hito necesita un nombre.');
  }
  return {
    id:
      texto(h['id']) ?? previo?.id ?? idDeTexto(`hito-${proyectoId}-${nombre}`),
    proyectoId,
    nombre: nombre.slice(0, 200),
    descripcion: texto(h['descripcion'])?.slice(0, 1000),
    fechaCompromiso: fechaValida(h['fechaCompromiso']),
    fechaReal: fechaValida(h['fechaReal']),
    completado: h['completado'] === true,
    orden: enteroOpcional(h['orden'], previo?.orden),
    actualizadoEn: ahora
  };
}

export function validarRiesgo(
  crudo: unknown,
  previo: CrmRiesgo | undefined,
  ahora: string
): CrmRiesgo {
  const r = (crudo ?? {}) as Record<string, unknown>;
  const proyectoId = texto(r['proyectoId']);
  const descripcion = texto(r['descripcion']);
  if (!proyectoId) {
    throw new Error('Cada riesgo necesita un proyectoId.');
  }
  if (!descripcion) {
    throw new Error('Cada riesgo necesita una descripción.');
  }
  const tipo = texto(r['tipo']) as CrmTipoRiesgo | undefined;
  if (!tipo || !TIPOS_RIESGO.includes(tipo)) {
    throw new Error(
      `El tipo "${tipo}" no es válido. Usa: ${TIPOS_RIESGO.join(', ')}.`
    );
  }
  const fechaReporte = fechaValida(r['fechaReporte']) ?? ahora;
  return {
    id:
      texto(r['id']) ??
      previo?.id ??
      idDeTexto(`riesgo-${proyectoId}-${Date.now()}`),
    proyectoId,
    tipo,
    descripcion: descripcion.slice(0, 1000),
    impacto: texto(r['impacto'])?.slice(0, 500),
    mitigacion: texto(r['mitigacion'])?.slice(0, 1000),
    reportadoPor: validarPersona(r['reportadoPor']),
    fechaReporte,
    abierto: r['abierto'] !== false,
    fechaCierre: fechaValida(r['fechaCierre']),
    actualizadoEn: ahora
  };
}

// --- Kanban: dias en etapa y leads estancados ---

/** Calcula los dias que un proyecto lleva en su etapa comercial actual. */
export function diasEnEtapa(proyecto: CrmProyecto, ahora = new Date()): number {
  if (!proyecto.enEtapaComericalDesde) return 0;
  const desde = Date.parse(proyecto.enEtapaComericalDesde);
  if (Number.isNaN(desde)) return 0;
  return Math.floor((ahora.getTime() - desde) / 86_400_000);
}

/** Determina si un proyecto esta estancado segun los dias configurados por etapa. */
export function proyectoEstancado(
  proyecto: CrmProyecto,
  diasPorEtapa: Partial<Record<CrmEtapaComercial, number>>,
  diasDefault: number,
  ahora = new Date()
): boolean {
  if (!proyecto.etapaComercial) return false;
  if (
    proyecto.etapaComercial === 'ganado' ||
    proyecto.etapaComercial === 'perdido'
  ) {
    return false;
  }
  const limite = diasPorEtapa[proyecto.etapaComercial] ?? diasDefault;
  return diasEnEtapa(proyecto, ahora) > limite;
}
