import type { Sesion } from '../acceso/acceso.js';
import type { ClienteIngesta } from '../config/entorno.js';
import type { Ejecucion, Ejecuciones } from '../ingesta/ejecuciones.js';
import type {
  Empresa,
  LicenseAdjustment,
  LlamadaArchivada,
  ManualLicense,
  Person,
  Proveedor,
  TaskItem
} from '../nucleo/contrato.js';
import type { Anotacion, Anotaciones } from '../pendientes/anotaciones.js';
import type { Registro } from '../pendientes/registro.js';
import type { Dominio } from './dominios.js';
import type { ServidorVps } from './servidores.js';
import type { DefinicionTabla } from './almacen-tabla.js';
import type { Fila } from './persistencia.js';

/**
 * Las tablas propias del puente en Postgres.
 *
 * Cada una lleva columnas de verdad para lo que se consulta (estado,
 * prioridad, fechas, responsable, empresa...) y una columna `datos` con el
 * objeto completo, que es de donde se reconstruye al leer: asi un campo
 * nuevo en el contrato no se pierde aunque todavia no tenga columna. Las
 * listas dentro de un registro (trazabilidad, comentarios) van en subtablas.
 *
 * Los tiempos van en `timestamptz` y los ids en `text`, como los usa el
 * portal.
 */

/** Un aviso del monitor: alguien del equipo movio un pendiente. */
export interface Aviso {
  id: string;
  tipo: 'comento' | 'termino' | 'reabrio' | 'reasignacion' | 'sistema';
  accion?: string;
  persona: string;
  tareaId: string;
  titulo: string;
  texto?: string;
  en: string;
  leido: boolean;
}

export interface LigaEquipo {
  persona: string;
  vence: string;
  tarea?: string;
}

const fecha = (v: unknown): string | null =>
  typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null;

const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : String(v);

const objeto = <T>(v: unknown): T =>
  (typeof v === 'string' ? JSON.parse(v) : v) as T;

// --- Pendientes ---------------------------------------------------------

const DDL_PENDIENTES = `
  CREATE TABLE IF NOT EXISTS pendientes (
    id text PRIMARY KEY,
    fuente text NOT NULL,
    cuenta text,
    orden integer NOT NULL DEFAULT 0,
    titulo text NOT NULL,
    descripcion text,
    estado text NOT NULL,
    prioridad text NOT NULL,
    vence_en timestamptz,
    con_hora boolean,
    origen text NOT NULL,
    proyecto text,
    empresa text,
    personal boolean NOT NULL DEFAULT false,
    remitente text,
    responsable_id text,
    responsable_nombre text,
    etiquetas jsonb NOT NULL DEFAULT '[]',
    url text,
    actualizado_en timestamptz NOT NULL,
    datos jsonb NOT NULL
  );
  CREATE INDEX IF NOT EXISTS pendientes_estado ON pendientes (estado);
  CREATE INDEX IF NOT EXISTS pendientes_vence ON pendientes (vence_en);
  CREATE INDEX IF NOT EXISTS pendientes_responsable ON pendientes (responsable_id);
`;

function filaDePendiente(
  t: TaskItem,
  orden: number,
  cuenta: string | null
): Fila {
  return {
    id: t.id,
    cuenta,
    orden,
    titulo: t.title,
    descripcion: t.description ?? null,
    estado: t.status,
    prioridad: t.priority,
    vence_en: fecha(t.dueDate),
    con_hora: t.dueHasTime ?? null,
    origen: t.origin,
    proyecto: t.project ?? null,
    empresa: t.company ?? null,
    personal: t.personal === true,
    remitente: t.senderKind ?? null,
    responsable_id: t.assignee?.id ?? null,
    responsable_nombre: t.assignee?.name ?? null,
    etiquetas: t.tags ?? [],
    url: t.url ?? null,
    actualizado_en: fecha(t.updatedAt) ?? new Date().toISOString(),
    datos: t
  };
}

/** Los pendientes propios (Míos y los que se capturan/dictan). */
export const TABLA_PERSONALES: DefinicionTabla<TaskItem[]> = {
  clave: 'personales',
  tabla: 'pendientes',
  ddl: DDL_PENDIENTES,
  id: 'id',
  filtro: { fuente: 'personales' },
  orden: 'orden',
  aFilas: (lista) => ({
    principal: lista.map((t, i) => filaDePendiente(t, i, null)),
    sub: {}
  }),
  deFilas: (filas) => filas.map((f) => objeto<TaskItem>(f['datos']))
};

/** Los pendientes detectados en el correo, por buzon. */
export const TABLA_REGISTRO_CORREO: DefinicionTabla<Registro> = {
  clave: 'pendientes-correo',
  tabla: 'pendientes',
  ddl: DDL_PENDIENTES,
  id: 'id',
  filtro: { fuente: 'correo' },
  orden: 'orden',
  aFilas: (registro) => ({
    principal: Object.entries(registro).flatMap(([cuenta, lista]) =>
      lista.map((t, i) => filaDePendiente(t, i, cuenta))
    ),
    sub: {}
  }),
  deFilas: (filas) => {
    const salida: Registro = {};
    for (const f of filas) {
      const cuenta = String(f['cuenta'] ?? '');
      (salida[cuenta] ??= []).push(objeto<TaskItem>(f['datos']));
    }
    return salida;
  }
};

// --- Anotaciones, trazabilidad y comentarios ----------------------------

export const TABLA_ANOTACIONES: DefinicionTabla<Anotaciones> = {
  clave: 'anotaciones',
  tabla: 'anotaciones',
  ddl: `
    CREATE TABLE IF NOT EXISTS anotaciones (
      tarea_id text PRIMARY KEY,
      hecho boolean,
      estado text,
      eliminado boolean NOT NULL DEFAULT false,
      asignado_id text,
      asignado_nombre text,
      cambios jsonb,
      solicitud_reasignacion jsonb,
      actualizado_en timestamptz,
      datos jsonb NOT NULL
    );
  `,
  id: 'tarea_id',
  subtablas: [
    {
      tabla: 'trazabilidad',
      padre: 'tarea_id',
      ddl: `
        CREATE TABLE IF NOT EXISTS trazabilidad (
          tarea_id text NOT NULL,
          orden integer NOT NULL,
          en timestamptz NOT NULL,
          quien text,
          tipo text NOT NULL,
          texto text NOT NULL,
          PRIMARY KEY (tarea_id, orden)
        );
        CREATE INDEX IF NOT EXISTS trazabilidad_en ON trazabilidad (en);
      `
    },
    {
      tabla: 'comentarios',
      padre: 'tarea_id',
      ddl: `
        CREATE TABLE IF NOT EXISTS comentarios (
          tarea_id text NOT NULL,
          orden integer NOT NULL,
          en timestamptz NOT NULL,
          quien text,
          texto text NOT NULL,
          PRIMARY KEY (tarea_id, orden)
        );
      `
    }
  ],
  aFilas: (todas) => {
    const principal: Fila[] = [];
    const trazabilidad: Fila[] = [];
    const comentarios: Fila[] = [];
    for (const [id, a] of Object.entries(todas)) {
      const { historial, comentarios: cs, ...resto } = a;
      principal.push({
        tarea_id: id,
        hecho: a.hecho ?? null,
        estado: a.estado ?? null,
        eliminado: a.eliminado === true,
        asignado_id: a.asignado?.id ?? null,
        asignado_nombre: a.asignado?.name ?? null,
        cambios: a.cambios ?? null,
        solicitud_reasignacion: a.solicitudReasignacion ?? null,
        actualizado_en: fecha(a.actualizadoEn),
        datos: resto
      });
      (historial ?? []).forEach((h, i) =>
        trazabilidad.push({
          tarea_id: id,
          orden: i,
          en: fecha(h.at) ?? new Date().toISOString(),
          quien: h.by ?? null,
          tipo: h.kind,
          texto: h.text
        })
      );
      (cs ?? []).forEach((c, i) =>
        comentarios.push({
          tarea_id: id,
          orden: i,
          en: fecha(c.at) ?? new Date().toISOString(),
          quien: c.by ?? null,
          texto: c.text
        })
      );
    }
    return { principal, sub: { trazabilidad, comentarios } };
  },
  deFilas: (principal, sub) => {
    const salida: Anotaciones = {};
    for (const f of principal) {
      const id = String(f['tarea_id']);
      const base = objeto<Omit<Anotacion, 'historial' | 'comentarios'>>(
        f['datos']
      );
      salida[id] = { ...base, comentarios: [] };
    }
    for (const h of sub['trazabilidad'] ?? []) {
      const a = salida[String(h['tarea_id'])];
      if (a) {
        (a.historial ??= []).push({
          at: iso(h['en']),
          by: (h['quien'] as string | null) ?? undefined,
          kind: h['tipo'] as NonNullable<
            Anotacion['historial']
          >[number]['kind'],
          text: String(h['texto'])
        });
      }
    }
    for (const c of sub['comentarios'] ?? []) {
      const a = salida[String(c['tarea_id'])];
      if (a) {
        a.comentarios.push({
          at: iso(c['en']),
          by: (c['quien'] as string | null) ?? undefined,
          text: String(c['texto'])
        });
      }
    }
    return salida;
  }
};

// --- Ejecuciones --------------------------------------------------------

export const TABLA_EJECUCIONES: DefinicionTabla<Ejecuciones> = {
  clave: 'ejecuciones',
  tabla: 'ejecuciones',
  ddl: `
    CREATE TABLE IF NOT EXISTS ejecuciones (
      clave text PRIMARY KEY,
      emisor text NOT NULL,
      integracion text NOT NULL,
      nombre text NOT NULL,
      resultado text NOT NULL,
      mensaje text,
      detalle text,
      duracion_ms integer,
      empezo_en timestamptz,
      termino_en timestamptz NOT NULL,
      recibido_en timestamptz NOT NULL,
      cada_minutos integer,
      corridas integer NOT NULL DEFAULT 0,
      ultimo_ok_en timestamptz,
      ultimo_error_en timestamptz,
      errores_seguidos integer NOT NULL DEFAULT 0,
      datos jsonb NOT NULL
    );
  `,
  id: 'clave',
  aFilas: (todas) => ({
    principal: Object.values(todas).map((e: Ejecucion) => ({
      clave: e.clave,
      emisor: e.emisor,
      integracion: e.integracion,
      nombre: e.nombre,
      resultado: e.resultado,
      mensaje: e.mensaje ?? null,
      detalle: e.detalle ?? null,
      duracion_ms: e.duracionMs ?? null,
      empezo_en: fecha(e.empezoEn),
      termino_en: e.terminoEn,
      recibido_en: e.recibidoEn,
      cada_minutos: e.cadaMinutos ?? null,
      corridas: e.corridas,
      ultimo_ok_en: fecha(e.ultimoOkEn),
      ultimo_error_en: fecha(e.ultimoErrorEn),
      errores_seguidos: e.erroresSeguidos,
      datos: e
    })),
    sub: {}
  }),
  deFilas: (filas) =>
    Object.fromEntries(
      filas.map((f) => [String(f['clave']), objeto<Ejecucion>(f['datos'])])
    )
};

// --- Equipo -------------------------------------------------------------

export const TABLA_EQUIPO: DefinicionTabla<Person[]> = {
  clave: 'equipo',
  tabla: 'equipo',
  ddl: `
    CREATE TABLE IF NOT EXISTS equipo (
      id text PRIMARY KEY,
      orden integer NOT NULL DEFAULT 0,
      nombre text NOT NULL,
      correo text,
      rol text,
      pedir_estatus boolean,
      datos jsonb NOT NULL
    );
  `,
  id: 'id',
  orden: 'orden',
  aFilas: (lista) => ({
    principal: lista.map((p, i) => ({
      id: p.id,
      orden: i,
      nombre: p.name,
      correo: p.email ?? null,
      rol: p.role ?? null,
      pedir_estatus: p.pedirEstatus ?? null,
      datos: p
    })),
    sub: {}
  }),
  deFilas: (filas) => filas.map((f) => objeto<Person>(f['datos']))
};

// --- Avisos -------------------------------------------------------------

export const TABLA_AVISOS: DefinicionTabla<Aviso[]> = {
  clave: 'avisos',
  tabla: 'avisos',
  ddl: `
    CREATE TABLE IF NOT EXISTS avisos (
      id text PRIMARY KEY,
      tipo text NOT NULL,
      accion text,
      persona text NOT NULL,
      tarea_id text,
      titulo text NOT NULL,
      texto text,
      en timestamptz NOT NULL,
      leido boolean NOT NULL DEFAULT false,
      datos jsonb NOT NULL
    );
    CREATE INDEX IF NOT EXISTS avisos_en ON avisos (en DESC);
  `,
  id: 'id',
  orden: 'en DESC',
  aFilas: (lista) => ({
    principal: lista.map((a) => ({
      id: a.id,
      tipo: a.tipo,
      accion: a.accion ?? null,
      persona: a.persona,
      tarea_id: a.tareaId || null,
      titulo: a.titulo,
      texto: a.texto ?? null,
      en: a.en,
      leido: a.leido,
      datos: a
    })),
    sub: {}
  }),
  deFilas: (filas) => filas.map((f) => objeto<Aviso>(f['datos']))
};

// --- Ligas del equipo ---------------------------------------------------

export const TABLA_LIGAS: DefinicionTabla<Record<string, LigaEquipo>> = {
  clave: 'ligas-equipo',
  tabla: 'ligas_equipo',
  ddl: `
    CREATE TABLE IF NOT EXISTS ligas_equipo (
      token text PRIMARY KEY,
      persona text NOT NULL,
      vence timestamptz NOT NULL,
      tarea text
    );
  `,
  id: 'token',
  aFilas: (todas) => ({
    principal: Object.entries(todas).map(([token, l]) => ({
      token,
      persona: l.persona,
      vence: l.vence,
      tarea: l.tarea ?? null
    })),
    sub: {}
  }),
  deFilas: (filas) =>
    Object.fromEntries(
      filas.map((f) => [
        String(f['token']),
        {
          persona: String(f['persona']),
          vence: iso(f['vence']),
          ...(f['tarea'] ? { tarea: String(f['tarea']) } : {})
        }
      ])
    )
};

// --- Dominios -----------------------------------------------------------

export const TABLA_DOMINIOS: DefinicionTabla<Dominio[]> = {
  clave: 'dominios',
  tabla: 'dominios',
  ddl: `
    CREATE TABLE IF NOT EXISTS dominios (
      nombre text PRIMARY KEY,
      orden integer NOT NULL DEFAULT 0,
      registrador text,
      vence_en timestamptz,
      costo numeric,
      moneda text,
      automatico boolean,
      notas text,
      datos jsonb NOT NULL
    );
  `,
  id: 'nombre',
  orden: 'orden',
  aFilas: (lista) => ({
    principal: lista.map((d, i) => ({
      nombre: d.nombre,
      orden: i,
      registrador: d.registrador ?? null,
      vence_en: fecha(d.venceEn),
      costo: d.costo ?? null,
      moneda: d.moneda ?? null,
      automatico: d.automatico ?? null,
      notas: d.notas ?? null,
      datos: d
    })),
    sub: {}
  }),
  deFilas: (filas) => filas.map((f) => objeto<Dominio>(f['datos']))
};

// --- Emisores de la API -------------------------------------------------

export const TABLA_EMISORES: DefinicionTabla<ClienteIngesta[]> = {
  clave: 'emisores',
  tabla: 'emisores',
  ddl: `
    CREATE TABLE IF NOT EXISTS emisores (
      nombre text PRIMARY KEY,
      orden integer NOT NULL DEFAULT 0,
      token text NOT NULL,
      tipos jsonb NOT NULL DEFAULT '[]',
      cuenta text,
      vigencia_segundos integer,
      datos jsonb NOT NULL
    );
  `,
  id: 'nombre',
  orden: 'orden',
  aFilas: (lista) => ({
    principal: lista.map((e, i) => ({
      nombre: e.nombre,
      orden: i,
      token: e.token,
      tipos: e.tipos,
      cuenta: e.accountId ?? null,
      vigencia_segundos: e.vigenciaSegundos ?? null,
      datos: e
    })),
    sub: {}
  }),
  deFilas: (filas) => filas.map((f) => objeto<ClienteIngesta>(f['datos']))
};

// --- Sesiones del portal ------------------------------------------------

export const TABLA_SESIONES: DefinicionTabla<Sesion[]> = {
  clave: 'sesiones',
  tabla: 'sesiones',
  ddl: `
    CREATE TABLE IF NOT EXISTS sesiones (
      token text PRIMARY KEY,
      correo text NOT NULL,
      creada timestamptz NOT NULL,
      vence timestamptz NOT NULL
    );
  `,
  id: 'token',
  orden: 'creada',
  aFilas: (lista) => ({
    principal: lista.map((s) => ({
      token: s.token,
      correo: s.correo,
      creada: s.creada,
      vence: s.vence
    })),
    sub: {}
  }),
  deFilas: (filas) =>
    filas.map((f) => ({
      token: String(f['token']),
      correo: String(f['correo']),
      creada: iso(f['creada']),
      vence: iso(f['vence'])
    }))
};

// --- Servidores (VPS) con Prometheus ------------------------------------

export const TABLA_SERVIDORES: DefinicionTabla<ServidorVps[]> = {
  clave: 'servidores-vps',
  tabla: 'servidores_vps',
  ddl: `
    CREATE TABLE IF NOT EXISTS servidores_vps (
      id text PRIMARY KEY,
      orden integer NOT NULL DEFAULT 0,
      etiqueta text NOT NULL,
      url text NOT NULL,
      usuario text,
      etiqueta_nombre text,
      actualizado_en timestamptz NOT NULL,
      datos jsonb NOT NULL
    );
  `,
  id: 'id',
  orden: 'orden',
  aFilas: (lista) => ({
    principal: lista.map((s, i) => ({
      id: s.id,
      orden: i,
      etiqueta: s.etiqueta,
      url: s.url,
      usuario: s.usuario ?? null,
      etiqueta_nombre: s.etiquetaNombre ?? null,
      actualizado_en: s.actualizadoEn,
      datos: s
    })),
    sub: {}
  }),
  deFilas: (filas) => filas.map((f) => objeto<ServidorVps>(f['datos']))
};

// --- Empresas del grupo -------------------------------------------------

export const TABLA_EMPRESAS: DefinicionTabla<Empresa[]> = {
  clave: 'empresas',
  tabla: 'empresas',
  ddl: `
    CREATE TABLE IF NOT EXISTS empresas (
      id text PRIMARY KEY,
      orden integer NOT NULL DEFAULT 0,
      nombre text NOT NULL,
      descripcion text,
      color text,
      cuentas jsonb NOT NULL DEFAULT '[]',
      activa boolean NOT NULL DEFAULT true,
      actualizado_en timestamptz NOT NULL,
      datos jsonb NOT NULL
    );
  `,
  id: 'id',
  orden: 'orden',
  aFilas: (lista) => ({
    principal: lista.map((e, i) => ({
      id: e.id,
      orden: i,
      nombre: e.nombre,
      descripcion: e.descripcion ?? null,
      color: e.color ?? null,
      cuentas: e.cuentas,
      activa: e.activa,
      actualizado_en: e.actualizadoEn,
      datos: { ...e, orden: i }
    })),
    sub: {}
  }),
  deFilas: (filas) => filas.map((f) => objeto<Empresa>(f['datos']))
};

// --- Proveedores y clientes externos ------------------------------------

export const TABLA_PROVEEDORES: DefinicionTabla<Proveedor[]> = {
  clave: 'proveedores',
  tabla: 'proveedores',
  ddl: `
    CREATE TABLE IF NOT EXISTS proveedores (
      id text PRIMARY KEY,
      orden integer NOT NULL DEFAULT 0,
      nombre text NOT NULL,
      descripcion text,
      color text,
      activa boolean NOT NULL DEFAULT true,
      actualizado_en timestamptz NOT NULL,
      datos jsonb NOT NULL
    );
  `,
  id: 'id',
  orden: 'orden',
  aFilas: (lista) => ({
    principal: lista.map((p, i) => ({
      id: p.id,
      orden: i,
      nombre: p.nombre,
      descripcion: p.descripcion ?? null,
      color: p.color ?? null,
      activa: p.activa,
      actualizado_en: p.actualizadoEn,
      datos: { ...p, orden: i }
    })),
    sub: {}
  }),
  deFilas: (filas) => filas.map((f) => objeto<Proveedor>(f['datos']))
};

// --- Llamadas archivadas en Drive ---------------------------------------

export const TABLA_LLAMADAS: DefinicionTabla<LlamadaArchivada[]> = {
  clave: 'llamadas',
  tabla: 'llamadas',
  ddl: `
    CREATE TABLE IF NOT EXISTS llamadas (
      id text PRIMARY KEY,
      orden integer NOT NULL DEFAULT 0,
      titulo text NOT NULL,
      fecha timestamptz,
      doc_id text NOT NULL,
      doc_url text NOT NULL,
      archivada_en timestamptz NOT NULL,
      borrada_de_fireflies boolean NOT NULL DEFAULT false,
      datos jsonb NOT NULL
    );
    CREATE INDEX IF NOT EXISTS llamadas_fecha ON llamadas (fecha);
  `,
  id: 'id',
  orden: 'orden',
  aFilas: (lista) => ({
    principal: lista.map((l, i) => ({
      id: l.id,
      orden: i,
      titulo: l.titulo,
      fecha: fecha(l.fecha),
      doc_id: l.docId,
      doc_url: l.docUrl,
      archivada_en: fecha(l.archivadaEn) ?? new Date().toISOString(),
      borrada_de_fireflies: l.borradaDeFireflies,
      datos: l
    })),
    sub: {}
  }),
  deFilas: (filas) => filas.map((f) => objeto<LlamadaArchivada>(f['datos']))
};

// --- Licencias a mano y sus ajustes -------------------------------------

export const TABLA_LICENCIAS_MANUALES: DefinicionTabla<ManualLicense[]> = {
  clave: 'licencias-manuales',
  tabla: 'licencias_manuales',
  ddl: `
    CREATE TABLE IF NOT EXISTS licencias_manuales (
      id text PRIMARY KEY,
      orden integer NOT NULL DEFAULT 0,
      producto text NOT NULL,
      cuenta text NOT NULL,
      renueva_en timestamptz,
      actualizado_en timestamptz NOT NULL,
      datos jsonb NOT NULL
    );
  `,
  id: 'id',
  orden: 'orden',
  aFilas: (lista) => ({
    principal: lista.map((l, i) => ({
      id: l.id,
      orden: i,
      producto: l.product,
      cuenta: l.accountId,
      renueva_en: fecha(l.renewsAt),
      actualizado_en: fecha(l.updatedAt) ?? new Date().toISOString(),
      datos: l
    })),
    sub: {}
  }),
  deFilas: (filas) => filas.map((f) => objeto<ManualLicense>(f['datos']))
};

export const TABLA_LICENCIAS_AJUSTES: DefinicionTabla<
  Record<string, LicenseAdjustment>
> = {
  clave: 'licencias-ajustes',
  tabla: 'licencias_ajustes',
  ddl: `
    CREATE TABLE IF NOT EXISTS licencias_ajustes (
      licencia_id text PRIMARY KEY,
      renovada_en timestamptz,
      renueva_en timestamptz,
      oculta boolean NOT NULL DEFAULT false,
      datos jsonb NOT NULL
    );
  `,
  id: 'licencia_id',
  aFilas: (todos) => ({
    principal: Object.entries(todos).map(([id, a]) => ({
      licencia_id: id,
      renovada_en: fecha(a.renewedAt),
      renueva_en: fecha(a.renewsAt),
      oculta: a.hidden === true,
      datos: a
    })),
    sub: {}
  }),
  deFilas: (filas) =>
    Object.fromEntries(
      filas.map((f) => [
        String(f['licencia_id']),
        objeto<LicenseAdjustment>(f['datos'])
      ])
    )
};

// --- CRM nativo: clientes, contactos, proyectos, cotizaciones, etc. ------

import type {
  CrmActividadCliente,
  CrmCliente,
  CrmContacto,
  CrmCotizacion,
  CrmFactura,
  CrmFuncionalidad,
  CrmOrdenCompra,
  CrmPagoProgramado,
  CrmPartida,
  CrmProyecto,
  RolCrm,
  UsuarioCrm
} from '../nucleo/contrato.js';

export const TABLA_CRM_CLIENTES: DefinicionTabla<CrmCliente[]> = {
  clave: 'crm-clientes',
  tabla: 'crm_clientes',
  ddl: `
    CREATE TABLE IF NOT EXISTS crm_clientes (
      id text PRIMARY KEY,
      nombre text NOT NULL,
      razon_social text,
      rfc text,
      tipo text NOT NULL,
      cliente_facturacion_id text,
      drive_folder_url text,
      notas text,
      actualizado_en timestamptz NOT NULL,
      datos jsonb NOT NULL
    );
    CREATE INDEX IF NOT EXISTS crm_clientes_nombre ON crm_clientes (nombre);
    CREATE INDEX IF NOT EXISTS crm_clientes_tipo ON crm_clientes (tipo);
  `,
  id: 'id',
  aFilas: (lista) => ({
    principal: lista.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      razon_social: c.razonSocial ?? null,
      rfc: c.rfc ?? null,
      tipo: c.tipo,
      cliente_facturacion_id: c.clienteFacturacionId ?? null,
      drive_folder_url: c.driveFolderUrl ?? null,
      notas: c.notas ?? null,
      actualizado_en: c.actualizadoEn,
      datos: c
    })),
    sub: {}
  }),
  deFilas: (filas) => filas.map((f) => objeto<CrmCliente>(f['datos']))
};

export const TABLA_CRM_CONTACTOS: DefinicionTabla<CrmContacto[]> = {
  clave: 'crm-contactos',
  tabla: 'crm_contactos',
  ddl: `
    CREATE TABLE IF NOT EXISTS crm_contactos (
      id text PRIMARY KEY,
      cliente_id text NOT NULL,
      nombre text NOT NULL,
      puesto text,
      correo text,
      telefono text,
      es_responsable_proyecto boolean NOT NULL DEFAULT false,
      actualizado_en timestamptz NOT NULL,
      datos jsonb NOT NULL
    );
    CREATE INDEX IF NOT EXISTS crm_contactos_cliente ON crm_contactos (cliente_id);
    CREATE INDEX IF NOT EXISTS crm_contactos_correo ON crm_contactos (correo);
  `,
  id: 'id',
  aFilas: (lista) => ({
    principal: lista.map((c) => ({
      id: c.id,
      cliente_id: c.clienteId,
      nombre: c.nombre,
      puesto: c.puesto ?? null,
      correo: c.correo ?? null,
      telefono: c.telefono ?? null,
      es_responsable_proyecto: c.esResponsableProyecto,
      actualizado_en: c.actualizadoEn,
      datos: c
    })),
    sub: {}
  }),
  deFilas: (filas) => filas.map((f) => objeto<CrmContacto>(f['datos']))
};

export const TABLA_CRM_PROYECTOS: DefinicionTabla<CrmProyecto[]> = {
  clave: 'crm-proyectos',
  tabla: 'crm_proyectos',
  ddl: `
    CREATE TABLE IF NOT EXISTS crm_proyectos (
      id text PRIMARY KEY,
      cliente_id text NOT NULL,
      cliente_final_id text,
      empresa_atiende_id text,
      nombre text NOT NULL,
      estado text NOT NULL,
      avance_pct integer,
      fecha_inicio timestamptz,
      fecha_fin_estimada timestamptz,
      actualizado_en timestamptz NOT NULL,
      datos jsonb NOT NULL
    );
    CREATE INDEX IF NOT EXISTS crm_proyectos_cliente ON crm_proyectos (cliente_id);
    CREATE INDEX IF NOT EXISTS crm_proyectos_empresa ON crm_proyectos (empresa_atiende_id);
    CREATE INDEX IF NOT EXISTS crm_proyectos_estado ON crm_proyectos (estado);
  `,
  id: 'id',
  aFilas: (lista) => ({
    principal: lista.map((p) => ({
      id: p.id,
      cliente_id: p.clienteId,
      cliente_final_id: p.clienteFinalId ?? null,
      empresa_atiende_id: p.empresaAtiendeId ?? null,
      nombre: p.nombre,
      estado: p.estado,
      avance_pct: p.avancePct ?? null,
      fecha_inicio: fecha(p.fechaInicio),
      fecha_fin_estimada: fecha(p.fechaFinEstimada),
      actualizado_en: p.actualizadoEn,
      datos: p
    })),
    sub: {}
  }),
  deFilas: (filas) => filas.map((f) => objeto<CrmProyecto>(f['datos']))
};

export const TABLA_CRM_COTIZACIONES: DefinicionTabla<CrmCotizacion[]> = {
  clave: 'crm-cotizaciones',
  tabla: 'crm_cotizaciones',
  ddl: `
    CREATE TABLE IF NOT EXISTS crm_cotizaciones (
      id text PRIMARY KEY,
      proyecto_id text NOT NULL,
      folio text,
      version integer,
      empresa_factura_id text,
      nombre text NOT NULL,
      total numeric,
      moneda text,
      esquema_cobro text NOT NULL,
      estatus text NOT NULL,
      fecha_emision timestamptz,
      fecha_envio timestamptz,
      fecha_aprobacion timestamptz,
      autorizada_en timestamptz,
      actualizado_en timestamptz NOT NULL,
      datos jsonb NOT NULL
    );
    CREATE INDEX IF NOT EXISTS crm_cotizaciones_proyecto ON crm_cotizaciones (proyecto_id);
    CREATE INDEX IF NOT EXISTS crm_cotizaciones_estatus ON crm_cotizaciones (estatus);
    CREATE INDEX IF NOT EXISTS crm_cotizaciones_empresa ON crm_cotizaciones (empresa_factura_id);
  `,
  id: 'id',
  aFilas: (lista) => ({
    principal: lista.map((c) => ({
      id: c.id,
      proyecto_id: c.proyectoId,
      folio: c.folio ?? null,
      version: c.version ?? null,
      empresa_factura_id: c.empresaFacturaId ?? null,
      nombre: c.nombre,
      total: c.total ?? null,
      moneda: c.moneda ?? null,
      esquema_cobro: c.esquemaCobro,
      estatus: c.estatus,
      fecha_emision: fecha(c.fechaEmision),
      fecha_envio: fecha(c.fechaEnvio),
      fecha_aprobacion: fecha(c.fechaAprobacion),
      autorizada_en: fecha(c.autorizadaPorCarlosEn),
      actualizado_en: c.actualizadoEn,
      datos: c
    })),
    sub: {}
  }),
  deFilas: (filas) => filas.map((f) => objeto<CrmCotizacion>(f['datos']))
};

export const TABLA_CRM_PAGOS: DefinicionTabla<CrmPagoProgramado[]> = {
  clave: 'crm-pagos',
  tabla: 'crm_pagos',
  ddl: `
    CREATE TABLE IF NOT EXISTS crm_pagos (
      id text PRIMARY KEY,
      cotizacion_id text NOT NULL,
      numero integer NOT NULL,
      total_pagos integer NOT NULL,
      monto numeric NOT NULL,
      moneda text NOT NULL,
      fecha_esperada timestamptz NOT NULL,
      estatus text NOT NULL,
      fecha_pago_real timestamptz,
      actualizado_en timestamptz NOT NULL,
      datos jsonb NOT NULL
    );
    CREATE INDEX IF NOT EXISTS crm_pagos_cotizacion ON crm_pagos (cotizacion_id);
    CREATE INDEX IF NOT EXISTS crm_pagos_estatus ON crm_pagos (estatus);
    CREATE INDEX IF NOT EXISTS crm_pagos_fecha ON crm_pagos (fecha_esperada);
  `,
  id: 'id',
  aFilas: (lista) => ({
    principal: lista.map((p) => ({
      id: p.id,
      cotizacion_id: p.cotizacionId,
      numero: p.numero,
      total_pagos: p.totalPagos,
      monto: p.monto,
      moneda: p.moneda,
      fecha_esperada: p.fechaEsperada,
      estatus: p.estatus,
      fecha_pago_real: fecha(p.fechaPagoReal),
      actualizado_en: p.actualizadoEn,
      datos: p
    })),
    sub: {}
  }),
  deFilas: (filas) => filas.map((f) => objeto<CrmPagoProgramado>(f['datos']))
};

export const TABLA_CRM_ACTIVIDADES: DefinicionTabla<CrmActividadCliente[]> = {
  clave: 'crm-actividades',
  tabla: 'crm_actividades',
  ddl: `
    CREATE TABLE IF NOT EXISTS crm_actividades (
      id text PRIMARY KEY,
      cliente_id text NOT NULL,
      proyecto_id text,
      cotizacion_id text,
      tipo text NOT NULL,
      resumen text NOT NULL,
      fecha timestamptz NOT NULL,
      actualizado_en timestamptz NOT NULL,
      datos jsonb NOT NULL
    );
    CREATE INDEX IF NOT EXISTS crm_actividades_cliente ON crm_actividades (cliente_id);
    CREATE INDEX IF NOT EXISTS crm_actividades_proyecto ON crm_actividades (proyecto_id);
    CREATE INDEX IF NOT EXISTS crm_actividades_fecha ON crm_actividades (fecha DESC);
  `,
  id: 'id',
  aFilas: (lista) => ({
    principal: lista.map((a) => ({
      id: a.id,
      cliente_id: a.clienteId,
      proyecto_id: a.proyectoId ?? null,
      cotizacion_id: a.cotizacionId ?? null,
      tipo: a.tipo,
      resumen: a.resumen,
      fecha: a.fecha,
      actualizado_en: a.actualizadoEn,
      datos: a
    })),
    sub: {}
  }),
  deFilas: (filas) => filas.map((f) => objeto<CrmActividadCliente>(f['datos']))
};

export const TABLA_CRM_FUNCIONALIDADES: DefinicionTabla<CrmFuncionalidad[]> = {
  clave: 'crm-funcionalidades',
  tabla: 'crm_funcionalidades',
  ddl: `
    CREATE TABLE IF NOT EXISTS crm_funcionalidades (
      id text PRIMARY KEY,
      proyecto_id text NOT NULL,
      titulo text NOT NULL,
      estado text NOT NULL,
      responsable_id text,
      prioridad text NOT NULL,
      fecha_compromiso timestamptz,
      orden integer,
      pendiente_id text,
      actualizado_en timestamptz NOT NULL,
      datos jsonb NOT NULL
    );
    CREATE INDEX IF NOT EXISTS crm_funcionalidades_proyecto ON crm_funcionalidades (proyecto_id);
    CREATE INDEX IF NOT EXISTS crm_funcionalidades_responsable ON crm_funcionalidades (responsable_id);
    CREATE INDEX IF NOT EXISTS crm_funcionalidades_estado ON crm_funcionalidades (estado);
  `,
  id: 'id',
  aFilas: (lista) => ({
    principal: lista.map((f) => ({
      id: f.id,
      proyecto_id: f.proyectoId,
      titulo: f.titulo,
      estado: f.estado,
      responsable_id: f.responsableId ?? null,
      prioridad: f.prioridad,
      fecha_compromiso: fecha(f.fechaCompromiso),
      orden: f.orden ?? null,
      pendiente_id: f.pendienteId ?? null,
      actualizado_en: f.actualizadoEn,
      datos: f
    })),
    sub: {}
  }),
  deFilas: (filas) => filas.map((f) => objeto<CrmFuncionalidad>(f['datos']))
};

export const TABLA_ROLES_CRM: DefinicionTabla<RolCrm[]> = {
  clave: 'roles-crm',
  tabla: 'roles_crm',
  ddl: `
    CREATE TABLE IF NOT EXISTS roles_crm (
      id text PRIMARY KEY,
      nombre text NOT NULL,
      descripcion text,
      es_sistema boolean NOT NULL DEFAULT false,
      actualizado_en timestamptz NOT NULL,
      datos jsonb NOT NULL
    );
  `,
  id: 'id',
  aFilas: (lista) => ({
    principal: lista.map((r) => ({
      id: r.id,
      nombre: r.nombre,
      descripcion: r.descripcion ?? null,
      es_sistema: r.esSistema,
      actualizado_en: r.actualizadoEn,
      datos: r
    })),
    sub: {}
  }),
  deFilas: (filas) => filas.map((f) => objeto<RolCrm>(f['datos']))
};

export const TABLA_USUARIOS_CRM: DefinicionTabla<UsuarioCrm[]> = {
  clave: 'usuarios-crm',
  tabla: 'usuarios_crm',
  ddl: `
    CREATE TABLE IF NOT EXISTS usuarios_crm (
      id text PRIMARY KEY,
      correo text NOT NULL UNIQUE,
      nombre text NOT NULL,
      activo boolean NOT NULL DEFAULT true,
      actualizado_en timestamptz NOT NULL,
      datos jsonb NOT NULL
    );
    CREATE INDEX IF NOT EXISTS usuarios_crm_correo ON usuarios_crm (correo);
  `,
  id: 'id',
  aFilas: (lista) => ({
    principal: lista.map((u) => ({
      id: u.id,
      correo: u.correo,
      nombre: u.nombre,
      activo: u.activo,
      actualizado_en: u.actualizadoEn,
      datos: u
    })),
    sub: {}
  }),
  deFilas: (filas) => filas.map((f) => objeto<UsuarioCrm>(f['datos']))
};

// --- Fase 2: OC, facturas y partidas ------------------------------------

export const TABLA_CRM_ORDENES_COMPRA: DefinicionTabla<CrmOrdenCompra[]> = {
  clave: 'crm-ordenes-compra',
  tabla: 'crm_ordenes_compra',
  ddl: `
    CREATE TABLE IF NOT EXISTS crm_ordenes_compra (
      id text PRIMARY KEY,
      cliente_id text NOT NULL,
      proyecto_id text,
      folio text NOT NULL,
      periodo text,
      monto numeric,
      moneda text,
      fecha_emision timestamptz,
      fecha_vencimiento timestamptz,
      actualizado_en timestamptz NOT NULL,
      datos jsonb NOT NULL
    );
    CREATE INDEX IF NOT EXISTS crm_oc_cliente ON crm_ordenes_compra (cliente_id);
    CREATE INDEX IF NOT EXISTS crm_oc_folio ON crm_ordenes_compra (folio);
  `,
  id: 'id',
  aFilas: (lista) => ({
    principal: lista.map((o) => ({
      id: o.id,
      cliente_id: o.clienteId,
      proyecto_id: o.proyectoId ?? null,
      folio: o.folio,
      periodo: o.periodo ?? null,
      monto: o.monto ?? null,
      moneda: o.moneda ?? null,
      fecha_emision: fecha(o.fechaEmision),
      fecha_vencimiento: fecha(o.fechaVencimiento),
      actualizado_en: o.actualizadoEn,
      datos: o
    })),
    sub: {}
  }),
  deFilas: (filas) => filas.map((f) => objeto<CrmOrdenCompra>(f['datos']))
};

export const TABLA_CRM_FACTURAS: DefinicionTabla<CrmFactura[]> = {
  clave: 'crm-facturas',
  tabla: 'crm_facturas',
  ddl: `
    CREATE TABLE IF NOT EXISTS crm_facturas (
      id text PRIMARY KEY,
      empresa_emisora_id text NOT NULL,
      cliente_id text NOT NULL,
      proyecto_id text,
      uuid text,
      folio text,
      fecha_emision timestamptz,
      total numeric,
      moneda text,
      fecha_pago_real timestamptz,
      tiene_complemento boolean,
      actualizado_en timestamptz NOT NULL,
      datos jsonb NOT NULL
    );
    CREATE INDEX IF NOT EXISTS crm_facturas_cliente ON crm_facturas (cliente_id);
    CREATE INDEX IF NOT EXISTS crm_facturas_empresa ON crm_facturas (empresa_emisora_id);
    CREATE INDEX IF NOT EXISTS crm_facturas_uuid ON crm_facturas (uuid);
    CREATE INDEX IF NOT EXISTS crm_facturas_folio ON crm_facturas (folio);
  `,
  id: 'id',
  aFilas: (lista) => ({
    principal: lista.map((f) => ({
      id: f.id,
      empresa_emisora_id: f.empresaEmisoraId,
      cliente_id: f.clienteId,
      proyecto_id: f.proyectoId ?? null,
      uuid: f.uuid ?? null,
      folio: f.folio ?? null,
      fecha_emision: fecha(f.fechaEmision),
      total: f.total ?? null,
      moneda: f.moneda ?? null,
      fecha_pago_real: fecha(f.fechaPagoReal),
      tiene_complemento: f.tieneComplemento ?? null,
      actualizado_en: f.actualizadoEn,
      datos: f
    })),
    sub: {}
  }),
  deFilas: (filas) => filas.map((f) => objeto<CrmFactura>(f['datos']))
};

export const TABLA_CRM_PARTIDAS: DefinicionTabla<CrmPartida[]> = {
  clave: 'crm-partidas',
  tabla: 'crm_partidas',
  ddl: `
    CREATE TABLE IF NOT EXISTS crm_partidas (
      id text PRIMARY KEY,
      cotizacion_id text NOT NULL,
      numero integer NOT NULL,
      descripcion text NOT NULL,
      cantidad numeric,
      precio_unitario numeric,
      importe numeric,
      costo_unitario numeric,
      costo_total numeric,
      moneda text,
      actualizado_en timestamptz NOT NULL,
      datos jsonb NOT NULL
    );
    CREATE INDEX IF NOT EXISTS crm_partidas_cotizacion ON crm_partidas (cotizacion_id);
  `,
  id: 'id',
  aFilas: (lista) => ({
    principal: lista.map((p) => ({
      id: p.id,
      cotizacion_id: p.cotizacionId,
      numero: p.numero,
      descripcion: p.descripcion,
      cantidad: p.cantidad ?? null,
      precio_unitario: p.precioUnitario ?? null,
      importe: p.importe ?? null,
      costo_unitario: p.costoUnitario ?? null,
      costo_total: p.costoTotal ?? null,
      moneda: p.moneda ?? null,
      actualizado_en: p.actualizadoEn,
      datos: p
    })),
    sub: {}
  }),
  deFilas: (filas) => filas.map((f) => objeto<CrmPartida>(f['datos']))
};
