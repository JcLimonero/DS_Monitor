import type { AlmacenJson } from '../datos/almacen-json.js';
import type { AlmacenTabla } from '../datos/almacen-tabla.js';
import {
  ALERTAS_ESTANCADOS_OMISION,
  calcularSemaforo,
  ESTADOS_EJECUCION,
  etapaEfectiva,
  validarAlertasEstancados,
  validarAvanceProyecto,
  validarCambioEtapa,
  validarFactura,
  validarHito,
  validarOrdenCompra,
  validarPartida,
  validarRiesgo,
  type CrmAvanceProyecto,
  type CrmCambioEtapa,
  type CrmFactura,
  type CrmHito,
  type CrmOrdenCompra,
  type CrmPartida,
  type CrmRiesgo
} from '../datos/crm-clientes.js';
import { ocultarCostosPartida } from '../datos/crm-clientes.js';
import {
  buscarUsuarioPorCorreo,
  camposOcultos,
  permisosEfectivos,
  tienePermiso,
  usuarioDirector,
  type AreaPermiso
} from '../datos/roles-permisos.js';
import type {
  CrmAlertasEstancados,
  CrmEtapaComercial,
  CrmProyectoEstado,
  Person,
  TaskItem
} from '../nucleo/contrato.js';
import { ErrorPuente } from '../nucleo/errores.js';
import type { DatosCrm } from './rutas-crm.js';
import type { Contexto, Router } from './router.js';

/**
 * Rutas del portal para kanban, seguimiento, OC/facturas/partidas y
 * asignacion en lote. Los permisos se resuelven igual que en rutas-crm.
 */

export interface DatosCrmSeguimiento extends DatosCrm {
  ordenesCompra: AlmacenTabla<CrmOrdenCompra[]>;
  facturas: AlmacenTabla<CrmFactura[]>;
  partidas: AlmacenTabla<CrmPartida[]>;
  cambiosEtapa: AlmacenTabla<CrmCambioEtapa[]>;
  avances: AlmacenTabla<CrmAvanceProyecto[]>;
  hitos: AlmacenTabla<CrmHito[]>;
  riesgos: AlmacenTabla<CrmRiesgo[]>;
  alertasEstancados: AlmacenJson<CrmAlertasEstancados>;
}

export interface DependenciasCrmSeguimiento {
  router: Router;
  datos: DatosCrmSeguimiento;
  correoDeSesion: (contexto: Contexto) => string | undefined;
  correosDelDueno: () => string[];
  equipo: () => Promise<Person[]>;
  /** Pendientes abiertos (ops + personales) para el contador y el lote. */
  pendientes: () => TaskItem[];
  asignarPendiente?: (id: string, quien: Person) => Promise<unknown>;
}

async function guardarEn<T extends { id: string }>(
  almacen: AlmacenTabla<T[]>,
  item: T
): Promise<T> {
  const lista = almacen.leer();
  const idx = lista.findIndex((x) => x.id === item.id);
  if (idx >= 0) {
    lista[idx] = item;
  } else {
    lista.push(item);
  }
  await almacen.escribir(lista);
  return item;
}

export function registrarRutasCrmSeguimiento(
  deps: DependenciasCrmSeguimiento
): void {
  const { router, datos } = deps;

  const usuarioYPermisos = (contexto: Contexto) => {
    const correo = deps.correoDeSesion(contexto);
    if (!correo) {
      throw new ErrorPuente('Se requiere sesión para acceder al CRM.', 401);
    }
    const esDelDueno = deps.correosDelDueno().includes(correo.toLowerCase());
    const usuario =
      buscarUsuarioPorCorreo(correo, datos.usuarios.leer()) ??
      (esDelDueno ? usuarioDirector(correo) : undefined);
    if (!usuario) {
      throw new ErrorPuente(
        'No tienes acceso al CRM. Pide al administrador que te agregue.',
        403
      );
    }
    return {
      usuario,
      permisos: permisosEfectivos(usuario, datos.roles.leer()),
      correo
    };
  };

  const exigirLectura = (contexto: Contexto, area: AreaPermiso) => {
    const { permisos, usuario, correo } = usuarioYPermisos(contexto);
    if (!tienePermiso(permisos, area, 'lectura')) {
      throw new ErrorPuente(`No tienes permiso para ver ${area}.`, 403);
    }
    return {
      permisos,
      usuario,
      correo,
      ocultos: camposOcultos(permisos)
    };
  };

  const exigirEscritura = (contexto: Contexto, area: AreaPermiso) => {
    const { permisos, usuario, correo } = usuarioYPermisos(contexto);
    if (!tienePermiso(permisos, area, 'escritura')) {
      throw new ErrorPuente(`No tienes permiso para modificar ${area}.`, 403);
    }
    return { permisos, usuario, correo };
  };

  const puedeMoverEtapa = (contexto: Contexto) => {
    const { permisos, usuario, correo } = usuarioYPermisos(contexto);
    if (
      !tienePermiso(permisos, 'proyectos', 'escritura') &&
      !tienePermiso(permisos, 'actividades', 'escritura')
    ) {
      throw new ErrorPuente(
        'No tienes permiso para mover la etapa comercial.',
        403
      );
    }
    return { permisos, usuario, correo };
  };

  const autorDe = async (correo: string): Promise<Person | undefined> => {
    const equipo = await deps.equipo();
    const clave = correo.toLowerCase();
    return (
      equipo.find((p) => p.email?.toLowerCase() === clave) ?? {
        id: clave,
        name: correo,
        email: correo
      }
    );
  };

  // --- Ordenes de compra ---

  router.get('/crm/ordenes-compra', async (contexto) => {
    exigirLectura(contexto, 'cobranza');
    const clienteId = contexto.parametros.get('clienteId') ?? undefined;
    const proyectoId = contexto.parametros.get('proyectoId') ?? undefined;
    let todas = datos.ordenesCompra.leer();
    if (clienteId) todas = todas.filter((o) => o.clienteId === clienteId);
    if (proyectoId) todas = todas.filter((o) => o.proyectoId === proyectoId);
    return todas;
  });

  router.post('/crm/ordenes-compra/guardar', async (contexto) => {
    exigirEscritura(contexto, 'cobranza');
    const ahora = new Date().toISOString();
    const crudo = contexto.cuerpo as Record<string, unknown> | undefined;
    const id = typeof crudo?.['id'] === 'string' ? crudo['id'] : undefined;
    const previa = id
      ? datos.ordenesCompra.leer().find((o) => o.id === id)
      : undefined;
    let oc: CrmOrdenCompra;
    try {
      oc = validarOrdenCompra(crudo, previa, ahora);
    } catch (error) {
      throw new ErrorPuente((error as Error).message, 400);
    }
    return guardarEn(datos.ordenesCompra, oc);
  });

  // --- Facturas ---

  router.get('/crm/facturas', async (contexto) => {
    exigirLectura(contexto, 'cobranza');
    const clienteId = contexto.parametros.get('clienteId') ?? undefined;
    const proyectoId = contexto.parametros.get('proyectoId') ?? undefined;
    let todas = datos.facturas.leer();
    if (clienteId) todas = todas.filter((f) => f.clienteId === clienteId);
    if (proyectoId) todas = todas.filter((f) => f.proyectoId === proyectoId);
    return todas;
  });

  router.post('/crm/facturas/guardar', async (contexto) => {
    exigirEscritura(contexto, 'cobranza');
    const ahora = new Date().toISOString();
    const crudo = contexto.cuerpo as Record<string, unknown> | undefined;
    const id = typeof crudo?.['id'] === 'string' ? crudo['id'] : undefined;
    const previa = id
      ? datos.facturas.leer().find((f) => f.id === id)
      : undefined;
    let fac: CrmFactura;
    try {
      fac = validarFactura(crudo, previa, ahora);
    } catch (error) {
      throw new ErrorPuente((error as Error).message, 400);
    }
    return guardarEn(datos.facturas, fac);
  });

  // --- Partidas / margen (solo con permiso de costos) ---

  router.get('/crm/partidas', async (contexto) => {
    const { ocultos } = exigirLectura(contexto, 'costos');
    const cotizacionId = contexto.parametros.get('cotizacionId') ?? undefined;
    const proyectoId = contexto.parametros.get('proyectoId') ?? undefined;
    let todas = datos.partidas.leer();
    if (cotizacionId) {
      todas = todas.filter((p) => p.cotizacionId === cotizacionId);
    }
    if (proyectoId) {
      const ids = new Set(
        datos.cotizaciones
          .leer()
          .filter((c) => c.proyectoId === proyectoId)
          .map((c) => c.id)
      );
      todas = todas.filter((p) => ids.has(p.cotizacionId));
    }
    return todas.map((p) => ocultarCostosPartida(p, ocultos.ocultarCostos));
  });

  router.post('/crm/partidas/guardar', async (contexto) => {
    exigirEscritura(contexto, 'costos');
    const ahora = new Date().toISOString();
    const crudo = contexto.cuerpo as Record<string, unknown> | undefined;
    const id = typeof crudo?.['id'] === 'string' ? crudo['id'] : undefined;
    const previa = id
      ? datos.partidas.leer().find((p) => p.id === id)
      : undefined;
    let part: CrmPartida;
    try {
      part = validarPartida(crudo, previa, ahora);
    } catch (error) {
      throw new ErrorPuente((error as Error).message, 400);
    }
    return guardarEn(datos.partidas, part);
  });

  // --- Historial de etapa ---

  router.get('/crm/cambios-etapa', async (contexto) => {
    exigirLectura(contexto, 'proyectos');
    const proyectoId = contexto.parametros.get('proyectoId') ?? undefined;
    let todos = datos.cambiosEtapa.leer();
    if (proyectoId) todos = todos.filter((c) => c.proyectoId === proyectoId);
    return todos.sort((a, b) => b.fecha.localeCompare(a.fecha));
  });

  router.post('/crm/proyectos/:id/etapa', async (contexto) => {
    const { correo } = puedeMoverEtapa(contexto);
    const id = decodeURIComponent(contexto.segmentos[2] ?? '');
    const lista = datos.proyectos.leer();
    const idx = lista.findIndex((p) => p.id === id);
    if (idx < 0) throw new ErrorPuente('Proyecto no encontrado.', 404);
    const actual = lista[idx]!;
    const cuerpo = (contexto.cuerpo ?? {}) as Record<string, unknown>;
    const etapa = cuerpo['etapa'] as CrmEtapaComercial | undefined;
    const nota =
      typeof cuerpo['nota'] === 'string' ? cuerpo['nota'] : undefined;
    const ahora = new Date().toISOString();
    const autor = await autorDe(correo);
    let cambio: CrmCambioEtapa;
    try {
      cambio = validarCambioEtapa(
        {
          proyectoId: id,
          etapaAnterior: etapaEfectiva(actual),
          etapaNueva: etapa,
          autor,
          fecha: ahora,
          nota
        },
        undefined,
        ahora
      );
    } catch (error) {
      throw new ErrorPuente((error as Error).message, 400);
    }
    let estado = actual.estado;
    if (cambio.etapaNueva === 'ganado') {
      if (!estado || !ESTADOS_EJECUCION.includes(estado)) {
        estado = 'en_desarrollo';
      }
    }
    if (cambio.etapaNueva === 'perdido') {
      estado = 'cancelado';
    }
    lista[idx] = {
      ...actual,
      etapaComercial: cambio.etapaNueva,
      enEtapaComericalDesde: ahora,
      estado,
      actualizadoEn: ahora
    };
    await datos.proyectos.escribir(lista);
    await guardarEn(datos.cambiosEtapa, cambio);
    return { proyecto: lista[idx], cambio };
  });

  router.post('/crm/proyectos/:id/estado', async (contexto) => {
    exigirEscritura(contexto, 'proyectos');
    const id = decodeURIComponent(contexto.segmentos[2] ?? '');
    const lista = datos.proyectos.leer();
    const idx = lista.findIndex((p) => p.id === id);
    if (idx < 0) throw new ErrorPuente('Proyecto no encontrado.', 404);
    const actual = lista[idx]!;
    const cuerpo = (contexto.cuerpo ?? {}) as Record<string, unknown>;
    const estado = cuerpo['estado'] as CrmProyectoEstado | undefined;
    if (!estado || !ESTADOS_EJECUCION.includes(estado)) {
      throw new ErrorPuente(
        `El estado "${estado ?? ''}" no es de ejecución.`,
        400
      );
    }
    const nota =
      typeof cuerpo['nota'] === 'string' && cuerpo['nota'].trim()
        ? cuerpo['nota'].trim()
        : `Pasó a ${estado.replaceAll('_', ' ')}.`;
    const ahora = new Date().toISOString();
    const correo = deps.correoDeSesion(contexto) ?? '';
    const autor = await autorDe(correo);
    const avance = validarAvanceProyecto(
      {
        proyectoId: id,
        fecha: ahora,
        nota,
        fuente: 'manual',
        autor,
        estadoAnterior: actual.estado,
        estadoNuevo: estado,
        avancePct: actual.avancePct
      },
      undefined,
      ahora
    );
    lista[idx] = {
      ...actual,
      estado,
      etapaComercial: actual.etapaComercial ?? 'ganado',
      actualizadoEn: ahora
    };
    await datos.proyectos.escribir(lista);
    await guardarEn(datos.avances, avance);
    return { proyecto: lista[idx], avance };
  });

  // --- Avances ---

  router.get('/crm/avances', async (contexto) => {
    exigirLectura(contexto, 'proyectos');
    const proyectoId = contexto.parametros.get('proyectoId') ?? undefined;
    let todos = datos.avances.leer();
    if (proyectoId) todos = todos.filter((a) => a.proyectoId === proyectoId);
    return todos.sort((a, b) => b.fecha.localeCompare(a.fecha));
  });

  router.post('/crm/avances/guardar', async (contexto) => {
    const { correo } = exigirEscritura(contexto, 'proyectos');
    const ahora = new Date().toISOString();
    const crudo: Record<string, unknown> = {
      ...((contexto.cuerpo ?? {}) as Record<string, unknown>),
      autor:
        (contexto.cuerpo as { autor?: unknown } | undefined)?.autor ??
        (await autorDe(correo))
    };
    const id = typeof crudo['id'] === 'string' ? crudo['id'] : undefined;
    const previo = id
      ? datos.avances.leer().find((a) => a.id === id)
      : undefined;
    let avance: CrmAvanceProyecto;
    try {
      avance = validarAvanceProyecto(crudo, previo, ahora);
    } catch (error) {
      throw new ErrorPuente((error as Error).message, 400);
    }
    const proyectos = datos.proyectos.leer();
    const pidx = proyectos.findIndex((p) => p.id === avance.proyectoId);
    if (pidx >= 0) {
      const p = proyectos[pidx]!;
      const hitos = datos.hitos.leer();
      proyectos[pidx] = {
        ...p,
        avancePct: avance.avancePct ?? p.avancePct,
        estado: avance.estadoNuevo ?? p.estado,
        semaforo: calcularSemaforo(
          { ...p, avancePct: avance.avancePct ?? p.avancePct },
          hitos
        ),
        actualizadoEn: ahora
      };
      await datos.proyectos.escribir(proyectos);
    }
    return guardarEn(datos.avances, avance);
  });

  // --- Hitos ---

  router.get('/crm/hitos', async (contexto) => {
    exigirLectura(contexto, 'proyectos');
    const proyectoId = contexto.parametros.get('proyectoId') ?? undefined;
    let todos = datos.hitos.leer();
    if (proyectoId) todos = todos.filter((h) => h.proyectoId === proyectoId);
    return todos.sort((a, b) => (a.orden ?? 999) - (b.orden ?? 999));
  });

  router.post('/crm/hitos/guardar', async (contexto) => {
    exigirEscritura(contexto, 'proyectos');
    const ahora = new Date().toISOString();
    const crudo = contexto.cuerpo as Record<string, unknown> | undefined;
    const id = typeof crudo?.['id'] === 'string' ? crudo['id'] : undefined;
    const previo = id ? datos.hitos.leer().find((h) => h.id === id) : undefined;
    let hito: CrmHito;
    try {
      hito = validarHito(crudo, previo, ahora);
    } catch (error) {
      throw new ErrorPuente((error as Error).message, 400);
    }
    if (!hito.responsableId) {
      throw new ErrorPuente('El responsable del hito es obligatorio.', 400);
    }
    return guardarEn(datos.hitos, hito);
  });

  // --- Riesgos ---

  router.get('/crm/riesgos', async (contexto) => {
    exigirLectura(contexto, 'proyectos');
    const proyectoId = contexto.parametros.get('proyectoId') ?? undefined;
    let todos = datos.riesgos.leer();
    if (proyectoId) todos = todos.filter((r) => r.proyectoId === proyectoId);
    return todos.sort((a, b) => b.fechaReporte.localeCompare(a.fechaReporte));
  });

  router.post('/crm/riesgos/guardar', async (contexto) => {
    exigirEscritura(contexto, 'proyectos');
    const ahora = new Date().toISOString();
    const crudo = contexto.cuerpo as Record<string, unknown> | undefined;
    const id = typeof crudo?.['id'] === 'string' ? crudo['id'] : undefined;
    const previo = id
      ? datos.riesgos.leer().find((r) => r.id === id)
      : undefined;
    let riesgo: CrmRiesgo;
    try {
      riesgo = validarRiesgo(crudo, previo, ahora);
    } catch (error) {
      throw new ErrorPuente((error as Error).message, 400);
    }
    if (!riesgo.responsableId) {
      throw new ErrorPuente('El responsable del riesgo es obligatorio.', 400);
    }
    return guardarEn(datos.riesgos, riesgo);
  });

  // --- Alertas de estancados ---

  router.get('/crm/alertas-estancados', async (contexto) => {
    exigirLectura(contexto, 'proyectos');
    const guardado = datos.alertasEstancados.leer();
    return guardado.diasDefault ? guardado : ALERTAS_ESTANCADOS_OMISION;
  });

  router.post('/crm/alertas-estancados/guardar', async (contexto) => {
    exigirEscritura(contexto, 'proyectos');
    const actual = validarAlertasEstancados(
      contexto.cuerpo,
      datos.alertasEstancados.leer()
    );
    await datos.alertasEstancados.escribir(actual);
    return actual;
  });

  // --- Asignacion en lote ---

  router.post('/crm/asignar-responsable', async (contexto) => {
    const { permisos } = usuarioYPermisos(contexto);
    const cuerpo = (contexto.cuerpo ?? {}) as {
      responsableId?: string;
      funcionalidades?: string[];
      hitos?: string[];
      riesgos?: string[];
      pendientes?: string[];
    };
    const responsableId = cuerpo.responsableId?.trim();
    if (!responsableId) {
      throw new ErrorPuente('Falta el responsableId.', 400);
    }
    const equipo = await deps.equipo();
    const quien = equipo.find(
      (p) => p.id === responsableId || p.email === responsableId
    );
    if (!quien) {
      throw new ErrorPuente('El responsable no está en el equipo.', 400);
    }
    const ahora = new Date().toISOString();
    const resultado = {
      funcionalidades: 0,
      hitos: 0,
      riesgos: 0,
      pendientes: 0
    };

    if (cuerpo.funcionalidades?.length) {
      if (!tienePermiso(permisos, 'desarrollo', 'escritura')) {
        throw new ErrorPuente(
          'No tienes permiso para asignar funcionalidades.',
          403
        );
      }
      const lista = datos.funcionalidades.leer();
      for (const id of cuerpo.funcionalidades) {
        const idx = lista.findIndex((f) => f.id === id);
        if (idx >= 0) {
          lista[idx] = {
            ...lista[idx]!,
            responsableId: quien.id,
            actualizadoEn: ahora
          };
          resultado.funcionalidades++;
        }
      }
      await datos.funcionalidades.escribir(lista);
    }

    if (cuerpo.hitos?.length) {
      if (!tienePermiso(permisos, 'proyectos', 'escritura')) {
        throw new ErrorPuente('No tienes permiso para asignar hitos.', 403);
      }
      const lista = datos.hitos.leer();
      for (const id of cuerpo.hitos) {
        const idx = lista.findIndex((h) => h.id === id);
        if (idx >= 0) {
          lista[idx] = {
            ...lista[idx]!,
            responsableId: quien.id,
            actualizadoEn: ahora
          };
          resultado.hitos++;
        }
      }
      await datos.hitos.escribir(lista);
    }

    if (cuerpo.riesgos?.length) {
      if (!tienePermiso(permisos, 'proyectos', 'escritura')) {
        throw new ErrorPuente('No tienes permiso para asignar riesgos.', 403);
      }
      const lista = datos.riesgos.leer();
      for (const id of cuerpo.riesgos) {
        const idx = lista.findIndex((r) => r.id === id);
        if (idx >= 0) {
          lista[idx] = {
            ...lista[idx]!,
            responsableId: quien.id,
            actualizadoEn: ahora
          };
          resultado.riesgos++;
        }
      }
      await datos.riesgos.escribir(lista);
    }

    if (cuerpo.pendientes?.length && deps.asignarPendiente) {
      for (const id of cuerpo.pendientes) {
        await deps.asignarPendiente(id, quien);
        resultado.pendientes++;
      }
    }

    return resultado;
  });

  // --- Contador / listado para Hoy, carrusel y filtros ---

  router.get('/crm/tareas-sin-responsable', async (contexto) => {
    usuarioYPermisos(contexto);
    const pendientes = deps
      .pendientes()
      .filter((p) => p.status !== 'hecho' && !p.personal && !p.assignee)
      .map((p) => ({
        tipo: 'pendiente' as const,
        id: p.id,
        titulo: p.title,
        desde: p.updatedAt
      }));
    const funcionalidades = datos.funcionalidades
      .leer()
      .filter((f) => f.estado !== 'hecho' && !f.responsableId)
      .map((f) => ({
        tipo: 'funcionalidad' as const,
        id: f.id,
        titulo: f.titulo,
        desde: f.actualizadoEn,
        proyectoId: f.proyectoId
      }));
    const hitos = datos.hitos
      .leer()
      .filter((h) => !h.completado && !h.responsableId)
      .map((h) => ({
        tipo: 'hito' as const,
        id: h.id,
        titulo: h.nombre,
        desde: h.actualizadoEn,
        proyectoId: h.proyectoId
      }));
    const riesgos = datos.riesgos
      .leer()
      .filter((r) => r.abierto && !r.responsableId)
      .map((r) => ({
        tipo: 'riesgo' as const,
        id: r.id,
        titulo: r.descripcion.slice(0, 100),
        desde: r.fechaReporte,
        proyectoId: r.proyectoId
      }));
    const items = [...pendientes, ...funcionalidades, ...hitos, ...riesgos];
    return {
      total: items.length,
      pendientes,
      funcionalidades,
      hitos,
      riesgos
    };
  });
}
