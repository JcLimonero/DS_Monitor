import type { Empresa } from '../datos/empresas.js';
import { empresaDe, esJuntaItech } from '../ia/juntas-fireflies.js';
import {
  normalizarTexto,
  type Transcripcion
} from '../proveedores/fireflies.js';

export interface ClienteResolucion {
  id: string;
  nombre: string;
}

export interface ContactoResolucion {
  clienteId: string;
  correo?: string;
  nombre: string;
}

export interface ProyectoResolucion {
  id: string;
  clienteId: string;
  nombre: string;
  estado?: string;
  empresaAtiendeId?: string;
  driveUrl?: string;
}

export interface CatalogoJunta {
  empresas: Empresa[];
  clientes: ClienteResolucion[];
  contactos: ContactoResolucion[];
  proyectos: ProyectoResolucion[];
}

/** Nombres ya usados en juntas de Itech, para repetir la carpeta. */
export interface AliasItech {
  clienteNombre: string;
  proyectoNombre: string;
}

export interface AsignacionJunta {
  clienteId?: string;
  proyectoId?: string;
  clienteNombre?: string;
  proyectoNombre?: string;
}

export type ResolucionJunta =
  | {
      estado: 'resuelta';
      esItech: false;
      empresaId?: string;
      empresaNombre?: string;
      clienteId: string;
      clienteNombre: string;
      proyectoId: string;
      proyectoNombre: string;
      carpetaProyectoId?: string;
    }
  | {
      estado: 'resuelta';
      esItech: true;
      empresaId: string;
      empresaNombre: string;
      clienteNombre: string;
      proyectoNombre: string;
    }
  | {
      estado: 'sin_asignar';
      esItech: boolean;
      motivo: string;
      empresaId?: string;
      empresaNombre?: string;
    };

function escapar(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function contieneNombre(texto: string, nombre: string): boolean {
  const n = normalizarTexto(nombre);
  if (n.length < 4) {
    return false;
  }
  return new RegExp(`\\b${escapar(n)}\\b`).test(texto);
}

/** Id de carpeta a partir de una liga de Drive, si viene en el proyecto. */
export function idDeCarpetaDrive(url: string | undefined): string | undefined {
  if (!url?.trim()) {
    return undefined;
  }
  const limpio = url.trim();
  const enRuta = /\/folders\/([a-zA-Z0-9_-]+)/.exec(limpio);
  if (enRuta?.[1]) {
    return enRuta[1];
  }
  if (/^[a-zA-Z0-9_-]{15,}$/.test(limpio)) {
    return limpio;
  }
  return undefined;
}

function textoDe(t: Transcripcion): string {
  return normalizarTexto(
    `${t.titulo} ${t.resumen ?? ''} ${(t.temas ?? []).join(' ')}`
  );
}

function empresaItech(empresas: Empresa[]): {
  id: string;
  nombre: string;
} {
  const itech = empresas.find(
    (e) =>
      e.activa &&
      (e.id === 'itech-dev' ||
        normalizarTexto(e.nombre) === 'itech dev' ||
        normalizarTexto(e.nombre) === 'itech')
  );
  return { id: itech?.id ?? 'itech-dev', nombre: itech?.nombre ?? 'Itech Dev' };
}

function unicos(nombres: string[]): string[] {
  const vistos = new Set<string>();
  const salida: string[] = [];
  for (const n of nombres) {
    const clave = normalizarTexto(n);
    if (!clave || vistos.has(clave)) {
      continue;
    }
    vistos.add(clave);
    salida.push(n.trim());
  }
  return salida;
}

function resolverItech(
  t: Transcripcion,
  catalogo: CatalogoJunta,
  aliases: AliasItech[]
): ResolucionJunta {
  const empresa = empresaItech(catalogo.empresas);
  const texto = textoDe(t);
  const clientes = unicos(aliases.map((a) => a.clienteNombre)).filter((n) =>
    contieneNombre(texto, n)
  );
  if (clientes.length !== 1) {
    return {
      estado: 'sin_asignar',
      esItech: true,
      empresaId: empresa.id,
      empresaNombre: empresa.nombre,
      motivo:
        'Junta de Itech Dev: indica el cliente y el proyecto para guardarla en Drive. No se registra en el CRM.'
    };
  }
  const clienteNombre = clientes[0] as string;
  const delCliente = aliases.filter(
    (a) => normalizarTexto(a.clienteNombre) === normalizarTexto(clienteNombre)
  );
  const porProyecto = delCliente.filter((a) =>
    contieneNombre(texto, a.proyectoNombre)
  );
  const distintos = unicos(delCliente.map((a) => a.proyectoNombre));
  const elegido =
    porProyecto.length === 1
      ? porProyecto[0]
      : porProyecto.length === 0 && distintos.length === 1
        ? delCliente[0]
        : undefined;
  if (!elegido) {
    return {
      estado: 'sin_asignar',
      esItech: true,
      empresaId: empresa.id,
      empresaNombre: empresa.nombre,
      motivo:
        'Junta de Itech Dev: el cliente aparece, pero no queda claro el proyecto. No se registra en el CRM.'
    };
  }
  return {
    estado: 'resuelta',
    esItech: true,
    empresaId: empresa.id,
    empresaNombre: empresa.nombre,
    clienteNombre: elegido.clienteNombre.trim(),
    proyectoNombre: elegido.proyectoNombre.trim()
  };
}

function clientesPorCorreo(
  t: Transcripcion,
  catalogo: CatalogoJunta
): string[] {
  const correos = new Set(
    t.participantes
      .map((p) => p.trim().toLowerCase())
      .filter((p) => p.includes('@'))
  );
  const ids = new Set<string>();
  for (const c of catalogo.contactos) {
    const correo = c.correo?.trim().toLowerCase();
    if (correo && correos.has(correo)) {
      ids.add(c.clienteId);
    }
  }
  return [...ids];
}

/**
 * Cliente y proyecto del CRM, o bandeja si no hay una sola lectura clara.
 * Itech no se resuelve contra el CRM: solo nombres de carpeta.
 */
export function resolverJunta(
  t: Transcripcion,
  catalogo: CatalogoJunta,
  aliasesItech: AliasItech[] = []
): ResolucionJunta {
  if (esJuntaItech(t, catalogo.empresas)) {
    return resolverItech(t, catalogo, aliasesItech);
  }
  const texto = textoDe(t);
  const porCorreo = clientesPorCorreo(t, catalogo);
  let clienteId: string | undefined;
  if (porCorreo.length === 1) {
    clienteId = porCorreo[0];
  } else if (porCorreo.length > 1) {
    return {
      estado: 'sin_asignar',
      esItech: false,
      motivo: 'Hay varios clientes posibles por los correos de la junta.'
    };
  } else {
    const porNombre = catalogo.clientes.filter((c) =>
      contieneNombre(texto, c.nombre)
    );
    if (porNombre.length === 1) {
      clienteId = porNombre[0]?.id;
    } else if (porNombre.length > 1) {
      return {
        estado: 'sin_asignar',
        esItech: false,
        motivo: 'El título menciona más de un cliente.'
      };
    }
  }
  const cliente = catalogo.clientes.find((c) => c.id === clienteId);
  if (!cliente) {
    return {
      estado: 'sin_asignar',
      esItech: false,
      motivo: 'No reconocí al cliente por los participantes ni por el título.'
    };
  }
  const vivos = catalogo.proyectos.filter(
    (p) => p.clienteId === cliente.id && p.estado !== 'cancelado'
  );
  const porNombre = vivos.filter((p) => contieneNombre(texto, p.nombre));
  let proyecto: ProyectoResolucion | undefined;
  if (porNombre.length === 1) {
    proyecto = porNombre[0];
  } else if (porNombre.length > 1) {
    return {
      estado: 'sin_asignar',
      esItech: false,
      motivo: 'El título menciona más de un proyecto de ese cliente.'
    };
  } else if (vivos.length === 1) {
    proyecto = vivos[0];
  } else if (vivos.length === 0) {
    return {
      estado: 'sin_asignar',
      esItech: false,
      motivo: 'El cliente no tiene un proyecto al cual archivar la junta.'
    };
  } else {
    return {
      estado: 'sin_asignar',
      esItech: false,
      motivo: 'Hay varios proyectos y el título no indica cuál.'
    };
  }
  if (!proyecto) {
    return {
      estado: 'sin_asignar',
      esItech: false,
      motivo: 'No reconocí el proyecto.'
    };
  }
  const empresaNombre = empresaDe(t, catalogo.empresas);
  const empresa = catalogo.empresas.find(
    (e) =>
      empresaNombre &&
      normalizarTexto(e.nombre) === normalizarTexto(empresaNombre)
  );
  if (
    empresa &&
    proyecto.empresaAtiendeId &&
    proyecto.empresaAtiendeId !== empresa.id
  ) {
    return {
      estado: 'sin_asignar',
      esItech: false,
      empresaId: empresa.id,
      empresaNombre: empresa.nombre,
      motivo: 'La empresa de la junta no coincide con la del proyecto.'
    };
  }
  const empresaProyecto = catalogo.empresas.find(
    (e) => e.id === proyecto.empresaAtiendeId
  );
  return {
    estado: 'resuelta',
    esItech: false,
    empresaId: empresa?.id ?? empresaProyecto?.id,
    empresaNombre: empresa?.nombre ?? empresaProyecto?.nombre,
    clienteId: cliente.id,
    clienteNombre: cliente.nombre,
    proyectoId: proyecto.id,
    proyectoNombre: proyecto.nombre,
    carpetaProyectoId: idDeCarpetaDrive(proyecto.driveUrl)
  };
}

/** Lo que Carlos elige en la bandeja. Itech pide nombres; el resto, ids del CRM. */
export function aplicarAsignacion(
  t: Transcripcion,
  asignacion: AsignacionJunta,
  catalogo: CatalogoJunta
): ResolucionJunta {
  if (esJuntaItech(t, catalogo.empresas)) {
    const empresa = empresaItech(catalogo.empresas);
    const clienteNombre = asignacion.clienteNombre?.trim() ?? '';
    const proyectoNombre = asignacion.proyectoNombre?.trim() ?? '';
    if (clienteNombre.length < 2 || proyectoNombre.length < 2) {
      return {
        estado: 'sin_asignar',
        esItech: true,
        empresaId: empresa.id,
        empresaNombre: empresa.nombre,
        motivo: 'Indica el cliente y el proyecto de Itech Dev.'
      };
    }
    return {
      estado: 'resuelta',
      esItech: true,
      empresaId: empresa.id,
      empresaNombre: empresa.nombre,
      clienteNombre,
      proyectoNombre
    };
  }
  const cliente = catalogo.clientes.find((c) => c.id === asignacion.clienteId);
  const proyecto = catalogo.proyectos.find(
    (p) => p.id === asignacion.proyectoId
  );
  if (!cliente || !proyecto || proyecto.clienteId !== cliente.id) {
    return {
      estado: 'sin_asignar',
      esItech: false,
      motivo: 'Elige un cliente y un proyecto del CRM.'
    };
  }
  const empresa = catalogo.empresas.find(
    (e) => e.id === proyecto.empresaAtiendeId
  );
  return {
    estado: 'resuelta',
    esItech: false,
    empresaId: empresa?.id ?? proyecto.empresaAtiendeId,
    empresaNombre: empresa?.nombre,
    clienteId: cliente.id,
    clienteNombre: cliente.nombre,
    proyectoId: proyecto.id,
    proyectoNombre: proyecto.nombre,
    carpetaProyectoId: idDeCarpetaDrive(proyecto.driveUrl)
  };
}
