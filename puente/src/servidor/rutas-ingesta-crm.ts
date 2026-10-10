import type { ClienteIngesta } from '../config/entorno.js';
import type { AlmacenTabla } from '../datos/almacen-tabla.js';
import {
  validarActividad,
  validarCliente,
  validarContacto,
  validarCotizacion,
  validarFactura,
  validarFuncionalidad,
  validarOrdenCompra,
  validarPagoProgramado,
  validarPartida,
  validarProyecto,
  type CrmActividadCliente,
  type CrmCliente,
  type CrmContacto,
  type CrmCotizacion,
  type CrmFactura,
  type CrmFuncionalidad,
  type CrmOrdenCompra,
  type CrmPagoProgramado,
  type CrmPartida,
  type CrmProyecto
} from '../datos/crm-clientes.js';
import { validarEmpresa, type Empresa } from '../datos/empresas.js';
import { ErrorPuente } from '../nucleo/errores.js';
import type { Contexto, Router } from './router.js';

/**
 * Rutas de ingesta para el CRM nativo.
 *
 * Permiten que un sistema externo (bot, script, etc.) cargue datos al CRM
 * usando un token de emisor. Cada ruta espera un arreglo de registros y usa
 * una llave externa opcional para idempotencia (agregar o actualizar).
 *
 * POST /ingesta/crm-nativo/clientes
 * POST /ingesta/crm-nativo/contactos
 * POST /ingesta/crm-nativo/proyectos
 * POST /ingesta/crm-nativo/cotizaciones
 * POST /ingesta/crm-nativo/pagos
 * POST /ingesta/crm-nativo/actividades
 * POST /ingesta/crm-nativo/funcionalidades
 * POST /ingesta/crm-nativo/ordenes-compra
 * POST /ingesta/crm-nativo/facturas
 * POST /ingesta/crm-nativo/partidas
 * POST /ingesta/crm-nativo/empresas
 *
 * Todas requieren Authorization: Bearer <token> donde el emisor tiene
 * permiso para el tipo "crm-nativo".
 */

export interface DatosIngesta {
  clientes: AlmacenTabla<CrmCliente[]>;
  contactos: AlmacenTabla<CrmContacto[]>;
  proyectos: AlmacenTabla<CrmProyecto[]>;
  cotizaciones: AlmacenTabla<CrmCotizacion[]>;
  pagos: AlmacenTabla<CrmPagoProgramado[]>;
  actividades: AlmacenTabla<CrmActividadCliente[]>;
  funcionalidades: AlmacenTabla<CrmFuncionalidad[]>;
  ordenesCompra: AlmacenTabla<CrmOrdenCompra[]>;
  facturas: AlmacenTabla<CrmFactura[]>;
  partidas: AlmacenTabla<CrmPartida[]>;
  empresas: AlmacenTabla<Empresa[]>;
}

export interface DependenciasIngesta {
  router: Router;
  datos: DatosIngesta;
  emisores: () => ClienteIngesta[];
}

function seguroIguales(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) {
    diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diferencia === 0;
}

function autenticar(
  contexto: Contexto,
  clientes: ClienteIngesta[]
): ClienteIngesta {
  const encabezado = contexto.encabezados['authorization'] ?? '';
  const token = encabezado.toLowerCase().startsWith('bearer ')
    ? encabezado.slice(7).trim()
    : '';

  if (!token) {
    throw new ErrorPuente(
      'Falta el encabezado Authorization: Bearer <token>',
      401
    );
  }

  const cliente = clientes.find((candidato) =>
    seguroIguales(candidato.token, token)
  );
  if (!cliente) {
    throw new ErrorPuente('Token no reconocido', 401);
  }

  if (!cliente.tipos.includes('crm-nativo')) {
    throw new ErrorPuente(
      `El emisor "${cliente.nombre}" no tiene permiso para mandar envíos de tipo "crm-nativo". Permitidos: ${cliente.tipos.join(', ')}`,
      403
    );
  }

  return cliente;
}

interface ResultadoIngesta {
  recibidos: number;
  creados: number;
  actualizados: number;
  errores: string[];
}

export function registrarRutasIngestaCrm(deps: DependenciasIngesta): void {
  const { router, datos, emisores } = deps;

  // --- Clientes ---
  router.post('/ingesta/crm-nativo/clientes', async (contexto) => {
    autenticar(contexto, emisores());
    const cuerpo = contexto.cuerpo as unknown[];
    if (!Array.isArray(cuerpo)) {
      throw new ErrorPuente('El cuerpo debe ser un arreglo de clientes.', 400);
    }
    const ahora = new Date().toISOString();
    const lista = datos.clientes.leer();
    const porId = new Map(lista.map((c) => [c.id, c]));
    const resultado: ResultadoIngesta = {
      recibidos: cuerpo.length,
      creados: 0,
      actualizados: 0,
      errores: []
    };

    for (let i = 0; i < cuerpo.length; i++) {
      const crudo = cuerpo[i] as Record<string, unknown>;
      try {
        const id = typeof crudo['id'] === 'string' ? crudo['id'] : undefined;
        const previo = id ? porId.get(id) : undefined;
        const cliente = validarCliente(crudo, previo, ahora);
        if (porId.has(cliente.id)) {
          resultado.actualizados++;
        } else {
          resultado.creados++;
        }
        porId.set(cliente.id, cliente);
      } catch (e) {
        resultado.errores.push(`[${i}] ${(e as Error).message}`);
      }
    }

    await datos.clientes.escribir([...porId.values()]);
    return resultado;
  });

  // --- Contactos ---
  router.post('/ingesta/crm-nativo/contactos', async (contexto) => {
    autenticar(contexto, emisores());
    const cuerpo = contexto.cuerpo as unknown[];
    if (!Array.isArray(cuerpo)) {
      throw new ErrorPuente('El cuerpo debe ser un arreglo de contactos.', 400);
    }
    const ahora = new Date().toISOString();
    const lista = datos.contactos.leer();
    const porId = new Map(lista.map((c) => [c.id, c]));
    const resultado: ResultadoIngesta = {
      recibidos: cuerpo.length,
      creados: 0,
      actualizados: 0,
      errores: []
    };

    for (let i = 0; i < cuerpo.length; i++) {
      const crudo = cuerpo[i] as Record<string, unknown>;
      try {
        const id = typeof crudo['id'] === 'string' ? crudo['id'] : undefined;
        const previo = id ? porId.get(id) : undefined;
        const contacto = validarContacto(crudo, previo, ahora);
        if (porId.has(contacto.id)) {
          resultado.actualizados++;
        } else {
          resultado.creados++;
        }
        porId.set(contacto.id, contacto);
      } catch (e) {
        resultado.errores.push(`[${i}] ${(e as Error).message}`);
      }
    }

    await datos.contactos.escribir([...porId.values()]);
    return resultado;
  });

  // --- Proyectos ---
  router.post('/ingesta/crm-nativo/proyectos', async (contexto) => {
    autenticar(contexto, emisores());
    const cuerpo = contexto.cuerpo as unknown[];
    if (!Array.isArray(cuerpo)) {
      throw new ErrorPuente('El cuerpo debe ser un arreglo de proyectos.', 400);
    }
    const ahora = new Date().toISOString();
    const lista = datos.proyectos.leer();
    const porId = new Map(lista.map((p) => [p.id, p]));
    const resultado: ResultadoIngesta = {
      recibidos: cuerpo.length,
      creados: 0,
      actualizados: 0,
      errores: []
    };

    for (let i = 0; i < cuerpo.length; i++) {
      const crudo = cuerpo[i] as Record<string, unknown>;
      try {
        const id = typeof crudo['id'] === 'string' ? crudo['id'] : undefined;
        const previo = id ? porId.get(id) : undefined;
        const proyecto = validarProyecto(crudo, previo, ahora);
        if (porId.has(proyecto.id)) {
          resultado.actualizados++;
        } else {
          resultado.creados++;
        }
        porId.set(proyecto.id, proyecto);
      } catch (e) {
        resultado.errores.push(`[${i}] ${(e as Error).message}`);
      }
    }

    await datos.proyectos.escribir([...porId.values()]);
    return resultado;
  });

  // --- Cotizaciones ---
  // Usa cotizacionExternaId como llave externa para idempotencia.
  // El folio no es unico (35% no lo tiene, algunos se repiten).
  router.post('/ingesta/crm-nativo/cotizaciones', async (contexto) => {
    autenticar(contexto, emisores());
    const cuerpo = contexto.cuerpo as unknown[];
    if (!Array.isArray(cuerpo)) {
      throw new ErrorPuente(
        'El cuerpo debe ser un arreglo de cotizaciones.',
        400
      );
    }
    const ahora = new Date().toISOString();
    const lista = datos.cotizaciones.leer();
    const porId = new Map(lista.map((c) => [c.id, c]));
    const porLlaveExterna = new Map(
      lista
        .filter((c) => c.cotizacionExternaId)
        .map((c) => [c.cotizacionExternaId!, c])
    );
    const resultado: ResultadoIngesta = {
      recibidos: cuerpo.length,
      creados: 0,
      actualizados: 0,
      errores: []
    };

    for (let i = 0; i < cuerpo.length; i++) {
      const crudo = cuerpo[i] as Record<string, unknown>;
      try {
        // Buscar por id primero, luego por llave externa
        const id = typeof crudo['id'] === 'string' ? crudo['id'] : undefined;
        const llaveExterna =
          typeof crudo['cotizacionExternaId'] === 'string'
            ? crudo['cotizacionExternaId']
            : undefined;
        let previo = id ? porId.get(id) : undefined;
        if (!previo && llaveExterna) {
          previo = porLlaveExterna.get(llaveExterna);
          if (previo) {
            // Usar el id existente para actualizar en lugar de crear
            crudo['id'] = previo.id;
          }
        }
        const cotizacion = validarCotizacion(crudo, previo, ahora);
        if (porId.has(cotizacion.id)) {
          resultado.actualizados++;
        } else {
          resultado.creados++;
        }
        porId.set(cotizacion.id, cotizacion);
        if (cotizacion.cotizacionExternaId) {
          porLlaveExterna.set(cotizacion.cotizacionExternaId, cotizacion);
        }
      } catch (e) {
        resultado.errores.push(`[${i}] ${(e as Error).message}`);
      }
    }

    await datos.cotizaciones.escribir([...porId.values()]);
    return resultado;
  });

  // --- Pagos programados ---
  router.post('/ingesta/crm-nativo/pagos', async (contexto) => {
    autenticar(contexto, emisores());
    const cuerpo = contexto.cuerpo as unknown[];
    if (!Array.isArray(cuerpo)) {
      throw new ErrorPuente('El cuerpo debe ser un arreglo de pagos.', 400);
    }
    const ahora = new Date().toISOString();
    const lista = datos.pagos.leer();
    const porId = new Map(lista.map((p) => [p.id, p]));
    const resultado: ResultadoIngesta = {
      recibidos: cuerpo.length,
      creados: 0,
      actualizados: 0,
      errores: []
    };

    for (let i = 0; i < cuerpo.length; i++) {
      const crudo = cuerpo[i] as Record<string, unknown>;
      try {
        const id = typeof crudo['id'] === 'string' ? crudo['id'] : undefined;
        const previo = id ? porId.get(id) : undefined;
        const pago = validarPagoProgramado(crudo, previo, ahora);
        if (porId.has(pago.id)) {
          resultado.actualizados++;
        } else {
          resultado.creados++;
        }
        porId.set(pago.id, pago);
      } catch (e) {
        resultado.errores.push(`[${i}] ${(e as Error).message}`);
      }
    }

    await datos.pagos.escribir([...porId.values()]);
    return resultado;
  });

  // --- Actividades ---
  router.post('/ingesta/crm-nativo/actividades', async (contexto) => {
    autenticar(contexto, emisores());
    const cuerpo = contexto.cuerpo as unknown[];
    if (!Array.isArray(cuerpo)) {
      throw new ErrorPuente(
        'El cuerpo debe ser un arreglo de actividades.',
        400
      );
    }
    const ahora = new Date().toISOString();
    const lista = datos.actividades.leer();
    const porId = new Map(lista.map((a) => [a.id, a]));
    const resultado: ResultadoIngesta = {
      recibidos: cuerpo.length,
      creados: 0,
      actualizados: 0,
      errores: []
    };

    for (let i = 0; i < cuerpo.length; i++) {
      const crudo = cuerpo[i] as Record<string, unknown>;
      try {
        const id = typeof crudo['id'] === 'string' ? crudo['id'] : undefined;
        const previo = id ? porId.get(id) : undefined;
        const actividad = validarActividad(crudo, previo, ahora);
        if (porId.has(actividad.id)) {
          resultado.actualizados++;
        } else {
          resultado.creados++;
        }
        porId.set(actividad.id, actividad);
      } catch (e) {
        resultado.errores.push(`[${i}] ${(e as Error).message}`);
      }
    }

    await datos.actividades.escribir([...porId.values()]);
    return resultado;
  });

  // --- Funcionalidades ---
  router.post('/ingesta/crm-nativo/funcionalidades', async (contexto) => {
    autenticar(contexto, emisores());
    const cuerpo = contexto.cuerpo as unknown[];
    if (!Array.isArray(cuerpo)) {
      throw new ErrorPuente(
        'El cuerpo debe ser un arreglo de funcionalidades.',
        400
      );
    }
    const ahora = new Date().toISOString();
    const lista = datos.funcionalidades.leer();
    const porId = new Map(lista.map((f) => [f.id, f]));
    const resultado: ResultadoIngesta = {
      recibidos: cuerpo.length,
      creados: 0,
      actualizados: 0,
      errores: []
    };

    for (let i = 0; i < cuerpo.length; i++) {
      const crudo = cuerpo[i] as Record<string, unknown>;
      try {
        const id = typeof crudo['id'] === 'string' ? crudo['id'] : undefined;
        const previo = id ? porId.get(id) : undefined;
        const funcionalidad = validarFuncionalidad(crudo, previo, ahora);
        if (porId.has(funcionalidad.id)) {
          resultado.actualizados++;
        } else {
          resultado.creados++;
        }
        porId.set(funcionalidad.id, funcionalidad);
      } catch (e) {
        resultado.errores.push(`[${i}] ${(e as Error).message}`);
      }
    }

    await datos.funcionalidades.escribir([...porId.values()]);
    return resultado;
  });

  // --- Órdenes de compra ---
  router.post('/ingesta/crm-nativo/ordenes-compra', async (contexto) => {
    autenticar(contexto, emisores());
    const cuerpo = contexto.cuerpo as unknown[];
    if (!Array.isArray(cuerpo)) {
      throw new ErrorPuente(
        'El cuerpo debe ser un arreglo de órdenes de compra.',
        400
      );
    }
    const ahora = new Date().toISOString();
    const lista = datos.ordenesCompra.leer();
    const porId = new Map(lista.map((o) => [o.id, o]));
    const resultado: ResultadoIngesta = {
      recibidos: cuerpo.length,
      creados: 0,
      actualizados: 0,
      errores: []
    };

    for (let i = 0; i < cuerpo.length; i++) {
      const crudo = cuerpo[i] as Record<string, unknown>;
      try {
        const id = typeof crudo['id'] === 'string' ? crudo['id'] : undefined;
        const previo = id ? porId.get(id) : undefined;
        const oc = validarOrdenCompra(crudo, previo, ahora);
        if (porId.has(oc.id)) {
          resultado.actualizados++;
        } else {
          resultado.creados++;
        }
        porId.set(oc.id, oc);
      } catch (e) {
        resultado.errores.push(`[${i}] ${(e as Error).message}`);
      }
    }

    await datos.ordenesCompra.escribir([...porId.values()]);
    return resultado;
  });

  // --- Facturas ---
  router.post('/ingesta/crm-nativo/facturas', async (contexto) => {
    autenticar(contexto, emisores());
    const cuerpo = contexto.cuerpo as unknown[];
    if (!Array.isArray(cuerpo)) {
      throw new ErrorPuente('El cuerpo debe ser un arreglo de facturas.', 400);
    }
    const ahora = new Date().toISOString();
    const lista = datos.facturas.leer();
    const porId = new Map(lista.map((f) => [f.id, f]));
    const porUuid = new Map(
      lista.filter((f) => f.uuid).map((f) => [f.uuid!, f])
    );
    const resultado: ResultadoIngesta = {
      recibidos: cuerpo.length,
      creados: 0,
      actualizados: 0,
      errores: []
    };

    for (let i = 0; i < cuerpo.length; i++) {
      const crudo = cuerpo[i] as Record<string, unknown>;
      try {
        const id = typeof crudo['id'] === 'string' ? crudo['id'] : undefined;
        const uuid =
          typeof crudo['uuid'] === 'string' ? crudo['uuid'] : undefined;
        let previo = id ? porId.get(id) : undefined;
        if (!previo && uuid) {
          previo = porUuid.get(uuid);
          if (previo) {
            crudo['id'] = previo.id;
          }
        }
        const factura = validarFactura(crudo, previo, ahora);
        if (porId.has(factura.id)) {
          resultado.actualizados++;
        } else {
          resultado.creados++;
        }
        porId.set(factura.id, factura);
        if (factura.uuid) {
          porUuid.set(factura.uuid, factura);
        }
      } catch (e) {
        resultado.errores.push(`[${i}] ${(e as Error).message}`);
      }
    }

    await datos.facturas.escribir([...porId.values()]);
    return resultado;
  });

  // --- Partidas ---
  router.post('/ingesta/crm-nativo/partidas', async (contexto) => {
    autenticar(contexto, emisores());
    const cuerpo = contexto.cuerpo as unknown[];
    if (!Array.isArray(cuerpo)) {
      throw new ErrorPuente('El cuerpo debe ser un arreglo de partidas.', 400);
    }
    const ahora = new Date().toISOString();
    const lista = datos.partidas.leer();
    const porId = new Map(lista.map((p) => [p.id, p]));
    const resultado: ResultadoIngesta = {
      recibidos: cuerpo.length,
      creados: 0,
      actualizados: 0,
      errores: []
    };

    for (let i = 0; i < cuerpo.length; i++) {
      const crudo = cuerpo[i] as Record<string, unknown>;
      try {
        const id = typeof crudo['id'] === 'string' ? crudo['id'] : undefined;
        const previo = id ? porId.get(id) : undefined;
        const partida = validarPartida(crudo, previo, ahora);
        if (porId.has(partida.id)) {
          resultado.actualizados++;
        } else {
          resultado.creados++;
        }
        porId.set(partida.id, partida);
      } catch (e) {
        resultado.errores.push(`[${i}] ${(e as Error).message}`);
      }
    }

    await datos.partidas.escribir([...porId.values()]);
    return resultado;
  });

  // --- Empresas del grupo ---
  router.post('/ingesta/crm-nativo/empresas', async (contexto) => {
    autenticar(contexto, emisores());
    const cuerpo = contexto.cuerpo as unknown[];
    if (!Array.isArray(cuerpo)) {
      throw new ErrorPuente('El cuerpo debe ser un arreglo de empresas.', 400);
    }
    const ahora = new Date().toISOString();
    const lista = datos.empresas.leer();
    const porId = new Map(lista.map((e) => [e.id, e]));
    const resultado: ResultadoIngesta = {
      recibidos: cuerpo.length,
      creados: 0,
      actualizados: 0,
      errores: []
    };

    for (let i = 0; i < cuerpo.length; i++) {
      const crudo = cuerpo[i] as Record<string, unknown>;
      try {
        const id = typeof crudo['id'] === 'string' ? crudo['id'] : undefined;
        const previo = id ? porId.get(id) : undefined;
        const orden = previo?.orden ?? lista.length + i;
        const empresa = validarEmpresa(crudo, previo, ahora, orden);
        if (porId.has(empresa.id)) {
          resultado.actualizados++;
        } else {
          resultado.creados++;
        }
        porId.set(empresa.id, empresa);
      } catch (e) {
        resultado.errores.push(`[${i}] ${(e as Error).message}`);
      }
    }

    await datos.empresas.escribir([...porId.values()]);
    return resultado;
  });
}
