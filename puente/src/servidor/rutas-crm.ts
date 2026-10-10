import type { AlmacenJson } from '../datos/almacen-json.js';
import type { AlmacenTabla } from '../datos/almacen-tabla.js';
import {
  validarActividad,
  validarCliente,
  validarContacto,
  validarCotizacion,
  validarFuncionalidad,
  validarPagoProgramado,
  validarProyecto,
  type CrmActividadCliente,
  type CrmCliente,
  type CrmContacto,
  type CrmCotizacion,
  type CrmFuncionalidad,
  type CrmPagoProgramado,
  type CrmProyecto
} from '../datos/crm-clientes.js';
import {
  buscarUsuarioPorCorreo,
  camposOcultos,
  clienteEnAlcance,
  esDirector,
  ocultarCostosCotizacion,
  ocultarCostosPago,
  permisosEfectivos,
  proyectoEnAlcance,
  ROLES_FABRICA,
  tienePermiso,
  usuarioDirector,
  validarRol,
  validarUsuarioCrm,
  type RolCrm,
  type UsuarioCrm
} from '../datos/roles-permisos.js';
import type { Person } from '../nucleo/contrato.js';
import { ErrorPuente } from '../nucleo/errores.js';
import type { Contexto, Router } from './router.js';

/**
 * Rutas del CRM nativo: clientes, contactos, proyectos, cotizaciones,
 * pagos, actividades, funcionalidades, roles y usuarios.
 *
 * Todas las rutas respetan el sistema de roles:
 * - El filtrado se hace aqui (no se mandan campos ni registros fuera del permiso)
 * - Las areas personales de Carlos (licencias, correo, etc.) estan en rutas.ts
 */

export interface DatosCrm {
  clientes: AlmacenTabla<CrmCliente[]>;
  contactos: AlmacenTabla<CrmContacto[]>;
  proyectos: AlmacenTabla<CrmProyecto[]>;
  cotizaciones: AlmacenTabla<CrmCotizacion[]>;
  pagos: AlmacenTabla<CrmPagoProgramado[]>;
  actividades: AlmacenTabla<CrmActividadCliente[]>;
  funcionalidades: AlmacenTabla<CrmFuncionalidad[]>;
  roles: AlmacenTabla<RolCrm[]>;
  usuarios: AlmacenTabla<UsuarioCrm[]>;
}

export interface DependenciasCrm {
  router: Router;
  datos: DatosCrm;
  /** Correo de la sesion, si la hay. */
  correoDeSesion: (contexto: Contexto) => string | undefined;
  /** Correos del dueno del monitor (acceso y buzones). */
  correosDelDueno: () => string[];
  /** El catalogo de equipo (para responsables internos). */
  equipo: () => Promise<Person[]>;
}

/** Sembrar roles de fabrica si la lista esta vacia. */
async function sembrarRoles(roles: AlmacenTabla<RolCrm[]>): Promise<void> {
  if (roles.leer().length === 0) {
    await roles.escribir(ROLES_FABRICA);
    console.log(
      `[puente] crm: sembrados ${ROLES_FABRICA.length} roles de fábrica`
    );
  }
}

export function registrarRutasCrm(deps: DependenciasCrm): void {
  const { router, datos } = deps;

  // Sembrar roles de fabrica al arrancar
  sembrarRoles(datos.roles).catch((e) =>
    console.warn(
      `[puente] crm: no se pudieron sembrar roles: ${(e as Error).message}`
    )
  );

  // --- Utilidades de permisos ---

  /** Obtiene el usuario y sus permisos efectivos de la sesion. */
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
    const permisos = permisosEfectivos(usuario, datos.roles.leer());
    return { usuario, permisos, esDelDueno };
  };

  const exigirLectura = (
    contexto: Contexto,
    area: Parameters<typeof tienePermiso>[1]
  ) => {
    const { permisos } = usuarioYPermisos(contexto);
    if (!tienePermiso(permisos, area, 'lectura')) {
      throw new ErrorPuente(`No tienes permiso para ver ${area}.`, 403);
    }
    return { permisos, ocultos: camposOcultos(permisos) };
  };

  const exigirEscritura = (
    contexto: Contexto,
    area: Parameters<typeof tienePermiso>[1]
  ) => {
    const { permisos } = usuarioYPermisos(contexto);
    if (!tienePermiso(permisos, area, 'escritura')) {
      throw new ErrorPuente(`No tienes permiso para modificar ${area}.`, 403);
    }
    return { permisos, ocultos: camposOcultos(permisos) };
  };

  // --- Clientes ---

  router.get('/crm/clientes', async (contexto) => {
    const { permisos } = exigirLectura(contexto, 'clientes');
    const { usuario } = usuarioYPermisos(contexto);
    const todos = datos.clientes.leer();
    if (esDirector(permisos) || !usuario.alcance) {
      return todos;
    }
    return todos.filter((c) => clienteEnAlcance(c.id, usuario.alcance));
  });

  router.get('/crm/clientes/:id', async (contexto) => {
    const { permisos } = exigirLectura(contexto, 'clientes');
    const { usuario } = usuarioYPermisos(contexto);
    const id = decodeURIComponent(contexto.segmentos[2] ?? '');
    const cliente = datos.clientes.leer().find((c) => c.id === id);
    if (!cliente) {
      throw new ErrorPuente('Cliente no encontrado.', 404);
    }
    if (
      !esDirector(permisos) &&
      !clienteEnAlcance(cliente.id, usuario.alcance)
    ) {
      throw new ErrorPuente('No tienes acceso a este cliente.', 403);
    }
    return cliente;
  });

  router.post('/crm/clientes/guardar', async (contexto) => {
    exigirEscritura(contexto, 'clientes');
    const ahora = new Date().toISOString();
    const crudo = contexto.cuerpo as Record<string, unknown> | undefined;
    const id = typeof crudo?.['id'] === 'string' ? crudo['id'] : undefined;
    const previo = id
      ? datos.clientes.leer().find((c) => c.id === id)
      : undefined;
    let cliente: CrmCliente;
    try {
      cliente = validarCliente(crudo, previo, ahora);
    } catch (error) {
      throw new ErrorPuente((error as Error).message, 400);
    }
    const lista = datos.clientes.leer();
    const existe = lista.findIndex((c) => c.id === cliente.id);
    if (existe >= 0) {
      lista[existe] = cliente;
    } else {
      lista.push(cliente);
    }
    await datos.clientes.escribir(lista);
    return cliente;
  });

  // --- Contactos ---

  router.get('/crm/contactos', async (contexto) => {
    exigirLectura(contexto, 'clientes');
    const clienteId = contexto.parametros.get('clienteId') ?? undefined;
    const todos = datos.contactos.leer();
    return clienteId ? todos.filter((c) => c.clienteId === clienteId) : todos;
  });

  router.post('/crm/contactos/guardar', async (contexto) => {
    exigirEscritura(contexto, 'clientes');
    const ahora = new Date().toISOString();
    const crudo = contexto.cuerpo as Record<string, unknown> | undefined;
    const id = typeof crudo?.['id'] === 'string' ? crudo['id'] : undefined;
    const previo = id
      ? datos.contactos.leer().find((c) => c.id === id)
      : undefined;
    let contacto: CrmContacto;
    try {
      contacto = validarContacto(crudo, previo, ahora);
    } catch (error) {
      throw new ErrorPuente((error as Error).message, 400);
    }
    const lista = datos.contactos.leer();
    const existe = lista.findIndex((c) => c.id === contacto.id);
    if (existe >= 0) {
      lista[existe] = contacto;
    } else {
      lista.push(contacto);
    }
    await datos.contactos.escribir(lista);
    return contacto;
  });

  // --- Proyectos ---

  router.get('/crm/proyectos', async (contexto) => {
    const { permisos } = exigirLectura(contexto, 'proyectos');
    const { usuario } = usuarioYPermisos(contexto);
    const todos = datos.proyectos.leer();
    if (esDirector(permisos) || !usuario.alcance) {
      return todos;
    }
    return todos.filter((p) =>
      proyectoEnAlcance(p.id, p.clienteId, p.empresaAtiendeId, usuario.alcance)
    );
  });

  router.get('/crm/proyectos/:id', async (contexto) => {
    const { permisos } = exigirLectura(contexto, 'proyectos');
    const { usuario } = usuarioYPermisos(contexto);
    const id = decodeURIComponent(contexto.segmentos[2] ?? '');
    const proyecto = datos.proyectos.leer().find((p) => p.id === id);
    if (!proyecto) {
      throw new ErrorPuente('Proyecto no encontrado.', 404);
    }
    if (
      !esDirector(permisos) &&
      !proyectoEnAlcance(
        proyecto.id,
        proyecto.clienteId,
        proyecto.empresaAtiendeId,
        usuario.alcance
      )
    ) {
      throw new ErrorPuente('No tienes acceso a este proyecto.', 403);
    }
    return proyecto;
  });

  router.get('/crm/proyectos/:id/responsable', async (contexto) => {
    exigirLectura(contexto, 'proyectos');
    const id = decodeURIComponent(contexto.segmentos[2] ?? '');
    const proyecto = datos.proyectos.leer().find((p) => p.id === id);
    if (!proyecto) {
      throw new ErrorPuente('Proyecto no encontrado.', 404);
    }
    if (proyecto.responsableClienteId) {
      const contacto = datos.contactos
        .leer()
        .find((c) => c.id === proyecto.responsableClienteId);
      if (contacto) {
        return {
          nombre: contacto.nombre,
          correo: contacto.correo,
          puesto: contacto.puesto
        };
      }
    }
    // Buscar responsable por omision del cliente
    const responsable = datos.contactos
      .leer()
      .find(
        (c) => c.clienteId === proyecto.clienteId && c.esResponsableProyecto
      );
    if (responsable) {
      return {
        nombre: responsable.nombre,
        correo: responsable.correo,
        puesto: responsable.puesto
      };
    }
    return null;
  });

  router.post('/crm/proyectos/guardar', async (contexto) => {
    exigirEscritura(contexto, 'proyectos');
    const ahora = new Date().toISOString();
    const crudo = contexto.cuerpo as Record<string, unknown> | undefined;
    const id = typeof crudo?.['id'] === 'string' ? crudo['id'] : undefined;
    const previo = id
      ? datos.proyectos.leer().find((p) => p.id === id)
      : undefined;
    let proyecto: CrmProyecto;
    try {
      proyecto = validarProyecto(crudo, previo, ahora);
    } catch (error) {
      throw new ErrorPuente((error as Error).message, 400);
    }
    const lista = datos.proyectos.leer();
    const existe = lista.findIndex((p) => p.id === proyecto.id);
    if (existe >= 0) {
      lista[existe] = proyecto;
    } else {
      lista.push(proyecto);
    }
    await datos.proyectos.escribir(lista);
    return proyecto;
  });

  // --- Cotizaciones ---

  router.get('/crm/cotizaciones', async (contexto) => {
    const { permisos, ocultos } = exigirLectura(contexto, 'cotizaciones');
    const { usuario } = usuarioYPermisos(contexto);
    const proyectoId = contexto.parametros.get('proyectoId') ?? undefined;
    let todas = datos.cotizaciones.leer();
    if (proyectoId) {
      todas = todas.filter((c) => c.proyectoId === proyectoId);
    }
    // Filtrar por alcance del usuario
    if (!esDirector(permisos) && usuario.alcance) {
      const proyectos = datos.proyectos.leer();
      todas = todas.filter((cot) => {
        const proy = proyectos.find((p) => p.id === cot.proyectoId);
        return (
          proy &&
          proyectoEnAlcance(
            proy.id,
            proy.clienteId,
            proy.empresaAtiendeId,
            usuario.alcance
          )
        );
      });
    }
    // Ocultar costos si no tiene permiso
    return todas.map((c) => ocultarCostosCotizacion(c, ocultos));
  });

  router.post('/crm/cotizaciones/guardar', async (contexto) => {
    exigirEscritura(contexto, 'cotizaciones');
    const ahora = new Date().toISOString();
    const crudo = contexto.cuerpo as Record<string, unknown> | undefined;
    const id = typeof crudo?.['id'] === 'string' ? crudo['id'] : undefined;
    const previa = id
      ? datos.cotizaciones.leer().find((c) => c.id === id)
      : undefined;
    let cotizacion: CrmCotizacion;
    try {
      cotizacion = validarCotizacion(crudo, previa, ahora);
    } catch (error) {
      throw new ErrorPuente((error as Error).message, 400);
    }
    const lista = datos.cotizaciones.leer();
    const existe = lista.findIndex((c) => c.id === cotizacion.id);
    if (existe >= 0) {
      lista[existe] = cotizacion;
    } else {
      lista.push(cotizacion);
    }
    await datos.cotizaciones.escribir(lista);
    return cotizacion;
  });

  router.post('/crm/cotizaciones/:id/autorizar', async (contexto) => {
    const { permisos } = usuarioYPermisos(contexto);
    if (!esDirector(permisos)) {
      throw new ErrorPuente(
        'Solo el Director puede autorizar cotizaciones.',
        403
      );
    }
    const id = decodeURIComponent(contexto.segmentos[2] ?? '');
    const lista = datos.cotizaciones.leer();
    const idx = lista.findIndex((c) => c.id === id);
    if (idx < 0) {
      throw new ErrorPuente('Cotización no encontrada.', 404);
    }
    const cotizacion = lista[idx]!;
    if (cotizacion.autorizadaPorCarlosEn) {
      return cotizacion; // Ya autorizada
    }
    const ahora = new Date().toISOString();
    lista[idx] = {
      ...cotizacion,
      autorizadaPorCarlosEn: ahora,
      actualizadoEn: ahora
    };
    await datos.cotizaciones.escribir(lista);
    return lista[idx];
  });

  router.post('/crm/cotizaciones/:id/envio', async (contexto) => {
    exigirEscritura(contexto, 'cotizaciones');
    const id = decodeURIComponent(contexto.segmentos[2] ?? '');
    const lista = datos.cotizaciones.leer();
    const idx = lista.findIndex((c) => c.id === id);
    if (idx < 0) {
      throw new ErrorPuente('Cotización no encontrada.', 404);
    }
    const cotizacion = lista[idx]!;
    if (!cotizacion.autorizadaPorCarlosEn) {
      throw new ErrorPuente(
        'La cotización debe estar autorizada por Carlos antes de enviarla.',
        400
      );
    }
    const cuerpo = contexto.cuerpo as
      | {
          enviadaA?: { nombre?: string; correo?: string };
          fechaEnvio?: string;
        }
      | undefined;
    const ahora = new Date().toISOString();
    const enviadaAId = cuerpo?.enviadaA?.correo
      ? datos.contactos
          .leer()
          .find(
            (c) =>
              c.correo?.toLowerCase() === cuerpo.enviadaA!.correo!.toLowerCase()
          )?.id
      : undefined;
    lista[idx] = {
      ...cotizacion,
      estatus: 'enviada',
      fechaEnvio: cuerpo?.fechaEnvio ?? ahora,
      enviadaAId,
      actualizadoEn: ahora
    };
    await datos.cotizaciones.escribir(lista);
    return lista[idx];
  });

  // --- Pagos programados ---

  router.get('/crm/pagos', async (contexto) => {
    const { ocultos } = exigirLectura(contexto, 'cobranza');
    const cotizacionId = contexto.parametros.get('cotizacionId') ?? undefined;
    const proyectoId = contexto.parametros.get('proyectoId') ?? undefined;
    let todos = datos.pagos.leer();
    if (cotizacionId) {
      todos = todos.filter((p) => p.cotizacionId === cotizacionId);
    }
    if (proyectoId) {
      const ids = new Set(
        datos.cotizaciones
          .leer()
          .filter((c) => c.proyectoId === proyectoId)
          .map((c) => c.id)
      );
      todos = todos.filter(
        (p) =>
          p.proyectoId === proyectoId ||
          (p.cotizacionId && ids.has(p.cotizacionId))
      );
    }
    return todos.map((p) => ocultarCostosPago(p, ocultos));
  });

  router.post('/crm/pagos/guardar', async (contexto) => {
    exigirEscritura(contexto, 'cobranza');
    const ahora = new Date().toISOString();
    const crudo = contexto.cuerpo as Record<string, unknown> | undefined;
    const id = typeof crudo?.['id'] === 'string' ? crudo['id'] : undefined;
    const previo = id ? datos.pagos.leer().find((p) => p.id === id) : undefined;
    let pago: CrmPagoProgramado;
    try {
      pago = validarPagoProgramado(crudo, previo, ahora);
    } catch (error) {
      throw new ErrorPuente((error as Error).message, 400);
    }
    const lista = datos.pagos.leer();
    const existe = lista.findIndex((p) => p.id === pago.id);
    if (existe >= 0) {
      lista[existe] = pago;
    } else {
      lista.push(pago);
    }
    await datos.pagos.escribir(lista);
    return pago;
  });

  // --- Actividades ---

  router.get('/crm/actividades', async (contexto) => {
    exigirLectura(contexto, 'actividades');
    const clienteId = contexto.parametros.get('clienteId') ?? undefined;
    const proyectoId = contexto.parametros.get('proyectoId') ?? undefined;
    let todas = datos.actividades.leer();
    if (clienteId) {
      todas = todas.filter((a) => a.clienteId === clienteId);
    }
    if (proyectoId) {
      todas = todas.filter((a) => a.proyectoId === proyectoId);
    }
    return todas.sort((a, b) => b.fecha.localeCompare(a.fecha));
  });

  router.post('/crm/actividades/guardar', async (contexto) => {
    exigirEscritura(contexto, 'actividades');
    const ahora = new Date().toISOString();
    const crudo = contexto.cuerpo as Record<string, unknown> | undefined;
    const id = typeof crudo?.['id'] === 'string' ? crudo['id'] : undefined;
    const previa = id
      ? datos.actividades.leer().find((a) => a.id === id)
      : undefined;
    let actividad: CrmActividadCliente;
    try {
      actividad = validarActividad(crudo, previa, ahora);
    } catch (error) {
      throw new ErrorPuente((error as Error).message, 400);
    }
    const lista = datos.actividades.leer();
    const existe = lista.findIndex((a) => a.id === actividad.id);
    if (existe >= 0) {
      lista[existe] = actividad;
    } else {
      lista.push(actividad);
    }
    await datos.actividades.escribir(lista);
    return actividad;
  });

  // --- Funcionalidades ---

  router.get('/crm/funcionalidades', async (contexto) => {
    const { permisos } = exigirLectura(contexto, 'desarrollo');
    const { usuario } = usuarioYPermisos(contexto);
    const proyectoId = contexto.parametros.get('proyectoId') ?? undefined;
    const responsableId = contexto.parametros.get('responsableId') ?? undefined;
    let todas = datos.funcionalidades.leer();
    if (proyectoId) {
      todas = todas.filter((f) => f.proyectoId === proyectoId);
    }
    if (responsableId) {
      todas = todas.filter((f) => f.responsableId === responsableId);
    }
    // Filtrar por alcance del usuario
    if (!esDirector(permisos) && usuario.alcance) {
      const proyectos = datos.proyectos.leer();
      todas = todas.filter((func) => {
        const proy = proyectos.find((p) => p.id === func.proyectoId);
        return (
          proy &&
          proyectoEnAlcance(
            proy.id,
            proy.clienteId,
            proy.empresaAtiendeId,
            usuario.alcance
          )
        );
      });
    }
    return todas.sort((a, b) => (a.orden ?? 999) - (b.orden ?? 999));
  });

  router.post('/crm/funcionalidades/guardar', async (contexto) => {
    exigirEscritura(contexto, 'desarrollo');
    const ahora = new Date().toISOString();
    const crudo = contexto.cuerpo as Record<string, unknown> | undefined;
    const id = typeof crudo?.['id'] === 'string' ? crudo['id'] : undefined;
    const previa = id
      ? datos.funcionalidades.leer().find((f) => f.id === id)
      : undefined;
    let funcionalidad: CrmFuncionalidad;
    try {
      funcionalidad = validarFuncionalidad(crudo, previa, ahora);
    } catch (error) {
      throw new ErrorPuente((error as Error).message, 400);
    }
    if (!funcionalidad.responsableId) {
      throw new ErrorPuente(
        'El responsable de la funcionalidad es obligatorio.',
        400
      );
    }
    const lista = datos.funcionalidades.leer();
    const existe = lista.findIndex((f) => f.id === funcionalidad.id);
    if (existe >= 0) {
      lista[existe] = funcionalidad;
    } else {
      lista.push(funcionalidad);
    }
    await datos.funcionalidades.escribir(lista);
    return funcionalidad;
  });

  // --- Roles (solo Director) ---

  router.get('/crm/roles', async (contexto) => {
    const { permisos } = usuarioYPermisos(contexto);
    if (!esDirector(permisos)) {
      throw new ErrorPuente('Solo el Director puede ver los roles.', 403);
    }
    return datos.roles.leer();
  });

  router.post('/crm/roles/guardar', async (contexto) => {
    const { permisos } = usuarioYPermisos(contexto);
    if (!esDirector(permisos)) {
      throw new ErrorPuente('Solo el Director puede modificar roles.', 403);
    }
    const ahora = new Date().toISOString();
    const crudo = contexto.cuerpo as Record<string, unknown> | undefined;
    const id = typeof crudo?.['id'] === 'string' ? crudo['id'] : undefined;
    const previo = id ? datos.roles.leer().find((r) => r.id === id) : undefined;
    let rol: RolCrm;
    try {
      rol = validarRol(crudo, previo, ahora);
    } catch (error) {
      throw new ErrorPuente((error as Error).message, 400);
    }
    const lista = datos.roles.leer();
    const existe = lista.findIndex((r) => r.id === rol.id);
    if (existe >= 0) {
      lista[existe] = rol;
    } else {
      lista.push(rol);
    }
    await datos.roles.escribir(lista);
    return rol;
  });

  // --- Usuarios CRM (solo Director) ---

  router.get('/crm/usuarios', async (contexto) => {
    const { permisos } = usuarioYPermisos(contexto);
    if (!esDirector(permisos)) {
      throw new ErrorPuente('Solo el Director puede ver los usuarios.', 403);
    }
    return datos.usuarios.leer();
  });

  router.post('/crm/usuarios/guardar', async (contexto) => {
    const { permisos } = usuarioYPermisos(contexto);
    if (!esDirector(permisos)) {
      throw new ErrorPuente('Solo el Director puede modificar usuarios.', 403);
    }
    const ahora = new Date().toISOString();
    const crudo = contexto.cuerpo as Record<string, unknown> | undefined;
    const id = typeof crudo?.['id'] === 'string' ? crudo['id'] : undefined;
    const previo = id
      ? datos.usuarios.leer().find((u) => u.id === id)
      : undefined;
    let usuario: UsuarioCrm;
    try {
      usuario = validarUsuarioCrm(crudo, previo, ahora);
    } catch (error) {
      throw new ErrorPuente((error as Error).message, 400);
    }
    // Verificar que los roles existan
    const rolesExistentes = datos.roles.leer().map((r) => r.id);
    for (const rolId of usuario.roles) {
      if (!rolesExistentes.includes(rolId)) {
        throw new ErrorPuente(`El rol "${rolId}" no existe.`, 400);
      }
    }
    const lista = datos.usuarios.leer();
    const existe = lista.findIndex((u) => u.id === usuario.id);
    if (existe >= 0) {
      lista[existe] = usuario;
    } else {
      lista.push(usuario);
    }
    await datos.usuarios.escribir(lista);
    return usuario;
  });

  // --- Mis permisos (para cualquier usuario) ---

  router.get('/crm/mis-permisos', async (contexto) => {
    const { permisos, usuario, esDelDueno } = usuarioYPermisos(contexto);
    return {
      usuario: {
        id: usuario.id,
        correo: usuario.correo,
        nombre: usuario.nombre
      },
      roles: usuario.roles,
      permisos,
      esDirector: esDirector(permisos),
      esDelDueno,
      alcance: usuario.alcance
    };
  });
}
