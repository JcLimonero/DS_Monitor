import type { Sesion } from '../acceso/acceso.js';
import type { ClienteIngesta } from '../config/entorno.js';
import type { Ejecucion, Ejecuciones } from '../ingesta/ejecuciones.js';
import type { Person, TaskItem } from '../nucleo/contrato.js';
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
