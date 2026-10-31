import type { ClienteIngesta, Configuracion } from '../config/entorno.js';
import type { Persistencia, Sql } from '../datos/persistencia.js';
import {
  ROLES_FABRICA,
  buscarUsuarioPorCorreo,
  esDirector,
  permisosEfectivos,
  tienePermiso,
  usuarioDirector
} from '../datos/roles-permisos.js';
import { autenticarEmisor, emisorDelToken } from '../ingesta/rutas-ingesta.js';
import { preguntar as preguntarModelo } from '../ia/modelo.js';
import type {
  CrmCliente,
  CrmProyecto,
  CrmRiesgo,
  Empresa,
  JuntaRag,
  RolCrm,
  TaskItem,
  UsuarioCrm
} from '../nucleo/contrato.js';
import {
  ErrorConfiguracion,
  ErrorPuente,
  describir
} from '../nucleo/errores.js';
import { REVISION_MINUTOS } from '../nucleo/programador.js';
import {
  embeddingsDe,
  type ConfigEmbeddings
} from '../proveedores/embeddings.js';
import {
  descargarArchivo,
  listarHijosDrive,
  textoDeArchivo,
  tokenDeCuentaServicio
} from '../proveedores/google.js';
import { RespuestaBinaria } from './router.js';
import {
  buscarHibrido,
  borrarPorDrive,
  guardarDocumento,
  guardarMarca,
  idsEnDrive,
  leerMarca,
  saltarSiNoCambio,
  type DocumentoAGuardar,
  type FragmentoHallado
} from '../rag/almacen-vectorial.js';
import {
  fechaDePedido,
  kDe,
  resolverEmpresas,
  type ActorRag,
  type ClausulaEmpresa,
  type PedidoRag
} from '../rag/alcance.js';
import { clasificarSensibilidad } from '../rag/clasificar.js';
import { juntarMarkdown, type RaizDrive } from '../rag/drive-markdown.js';
import { asegurarEsquemaRag } from '../rag/esquema.js';
import { EMPRESA_ITECH, empresaIdDe } from '../rag/empresas-rag.js';
import {
  fragmentarMarkdown,
  type DocumentoFragmentado
} from '../rag/fragmentar.js';
import { clienteMencionado } from '../rag/menciones.js';
import { cerrarRespuesta, prepararPregunta } from '../rag/preguntar-rag.js';
import { planearReconciliacion } from '../rag/reconciliar.js';
import type { Programable } from './rutas-ia.js';
import type { Contexto, Router } from './router.js';

export interface DependenciasRag {
  router: Router;
  persistencia: Persistencia;
  cfg: () => Configuracion;
  emisores: () => ClienteIngesta[];
  empresas: () => Empresa[];
  clientes: () => CrmCliente[];
  juntas: () => JuntaRag[];
  roles: () => RolCrm[];
  usuarios: () => UsuarioCrm[];
  correoDeSesion: (contexto: Contexto) => string | undefined;
  correosDelDueno: () => string[];
  esAdmin: (contexto: Contexto) => boolean;
  programables: Programable[];
  /** Riesgos y bloqueos de proyectos (opcional, para /rag/atencion). */
  riesgos?: () => CrmRiesgo[];
  /** Proyectos del CRM (opcional, para /rag/atencion). */
  proyectos?: () => CrmProyecto[];
  /** Pendientes abiertos (opcional, para /rag/atencion con acuerdos de juntas). */
  pendientes?: () => TaskItem[];
}

interface GanchosRag {
  embeddings?: typeof embeddingsDe;
  redactar?: (sistema: string, usuario: string) => Promise<string>;
}

let ganchos: GanchosRag = {};

/** Las pruebas sustituyen la red. El puente real no lo llama. */
export function establecerGanchosRag(siguientes: GanchosRag): void {
  ganchos = siguientes;
}

interface GanchosDescarga {
  descargarArchivo?: (
    token: string,
    driveFileId: string
  ) => Promise<{ contenido: Buffer; mimeType: string; nombre: string }>;
  tokenDeCuentaServicio?: () => Promise<string>;
}

let ganchosDescarga: GanchosDescarga = {};

/** Las pruebas sustituyen la descarga de archivos. */
export function establecerGanchosDescarga(siguientes: GanchosDescarga): void {
  ganchosDescarga = siguientes;
}

export interface CuerpoIngestaRag {
  driveFileId: string;
  markdown: string;
  driveUrl?: string;
  ruta?: string;
  modificadoEn?: string;
}

/**
 * POST /ingesta/rag, POST /rag/buscar y POST /rag/preguntar.
 *
 * La ingesta exige un emisor con tipo `rag`. Buscar y preguntar exigen
 * sesion, token de admin o un emisor `rag-consulta` con su lista de empresas.
 * Itech no se mezcla: el filtro va en el SQL.
 */
export function registrarRagVectorial(deps: DependenciasRag): void {
  const { router } = deps;
  let esquemaListo: Promise<void> | undefined;

  const exigirSql = (): Sql => {
    const sql = deps.persistencia.sql;
    if (!sql) {
      throw new ErrorConfiguracion(
        'El RAG vectorial necesita Postgres (DATABASE_URL) con la extensión pgvector.'
      );
    }
    return sql;
  };

  const esquema = (sql: Sql): Promise<void> => {
    esquemaListo ??= asegurarEsquemaRag(sql).catch((error) => {
      esquemaListo = undefined;
      throw new ErrorConfiguracion(
        `No se pudo preparar pgvector: ${describir(error)}`
      );
    });
    return esquemaListo;
  };

  const configEmbeddings = (): ConfigEmbeddings => {
    const ia = deps.cfg().ia;
    if (!ia?.apiKey) {
      throw new ErrorConfiguracion(
        'Falta OPENROUTER_API_KEY para los embeddings del RAG (RAG_EMBEDDINGS_MODELO es opcional).'
      );
    }
    return {
      apiKey: ia.apiKey,
      modelo: deps.cfg().ragEmbeddingsModelo
    };
  };

  const catalogo = () =>
    deps.empresas().map((e) => ({ id: e.id, nombre: e.nombre }));

  const ingerir = async (
    cuerpo: CuerpoIngestaRag,
    sql: Sql
  ): Promise<{
    recibido: true;
    id: string;
    omitido: boolean;
    fragmentos: number;
    empresa: string;
  }> => {
    let doc: DocumentoFragmentado;
    try {
      doc = fragmentarMarkdown(cuerpo.markdown, {
        driveFileId: cuerpo.driveFileId,
        ruta: cuerpo.ruta,
        catalogo: catalogo()
      });
    } catch (error) {
      throw new ErrorPuente(describir(error), 400);
    }
    const modelo = deps.cfg().ragEmbeddingsModelo;
    // Lista blanca: solo Juntas, 02_Proyecto y 03_Entregables sin precios son
    // generales. Lo demas, y todo lo que no se pueda comprobar, queda como costos.
    const sensibilidad = clasificarSensibilidad({
      ruta: cuerpo.ruta,
      markdown: cuerpo.markdown
    });
    const salto = await saltarSiNoCambio(sql, {
      id: doc.id,
      driveFileId: cuerpo.driveFileId,
      huella: doc.huella,
      modeloEmb: modelo,
      ruta: cuerpo.ruta,
      driveUrl:
        cuerpo.driveUrl ??
        `https://drive.google.com/file/d/${cuerpo.driveFileId}/view`,
      modificadoEn: cuerpo.modificadoEn,
      empresa: doc.empresa,
      proyecto: doc.proyecto,
      sensibilidad
    });
    if (salto) {
      return { recibido: true, ...salto };
    }
    const vectores =
      doc.fragmentos.length === 0
        ? []
        : await (ganchos.embeddings ?? embeddingsDe)(
            configEmbeddings(),
            doc.fragmentos.map((f) => f.texto)
          );
    const aGuardar: DocumentoAGuardar = {
      id: doc.id,
      driveFileId: cuerpo.driveFileId,
      driveUrl:
        cuerpo.driveUrl ??
        `https://drive.google.com/file/d/${cuerpo.driveFileId}/view`,
      ruta: cuerpo.ruta,
      titulo: doc.titulo,
      fecha: doc.fecha,
      empresa: doc.empresa,
      cliente: doc.cliente,
      proyecto: doc.proyecto,
      sensibilidad,
      tipo: doc.tipo,
      participantes: doc.participantes,
      frontmatter: doc.frontmatter,
      huella: doc.huella,
      modeloEmb: modelo,
      modificadoEn: cuerpo.modificadoEn,
      fragmentos: doc.fragmentos.map((f, i) => ({
        orden: f.orden,
        seccion: f.seccion,
        texto: f.texto,
        tokens: f.tokens,
        embedding: vectores[i] ?? []
      }))
    };
    const guardado = await guardarDocumento(sql, aGuardar);
    return { recibido: true, ...guardado };
  };

  router.post('/ingesta/rag', async (contexto) => {
    autenticarEmisor(contexto, deps.emisores(), 'rag');
    const cuerpo = comoObjeto(contexto.cuerpo);
    const driveFileId = texto(cuerpo['driveFileId']);
    const markdown =
      typeof cuerpo['markdown'] === 'string' ? cuerpo['markdown'] : '';
    if (!driveFileId) {
      throw new ErrorPuente('driveFileId es obligatorio.', 400);
    }
    if (!markdown.trim()) {
      throw new ErrorPuente('markdown es obligatorio.', 400);
    }
    const sql = exigirSql();
    await esquema(sql);
    return ingerir(
      {
        driveFileId,
        markdown,
        driveUrl: texto(cuerpo['driveUrl']),
        ruta: texto(cuerpo['ruta']),
        modificadoEn: texto(cuerpo['modificadoEn'])
      },
      sql
    );
  });

  const roles = () => {
    const guardados = deps.roles();
    return guardados.length > 0 ? guardados : ROLES_FABRICA;
  };

  const actorDe = (contexto: Contexto): ActorRag => {
    const token = tokenDe(contexto);
    const emisor = emisorDelToken(token, deps.emisores());
    if (emisor?.tipos.includes('rag-consulta')) {
      const declaradas = emisor.empresas ?? [];
      const empresas = declaradas.flatMap((e) => {
        const id = empresaIdDe(e, catalogo());
        return id ? [id] : [];
      });
      if (declaradas.length > 0 && empresas.length === 0) {
        throw new ErrorPuente(
          'Las empresas de este token de consulta no son válidas.',
          403
        );
      }
      return {
        director: false,
        ...(empresas.length > 0 ? { tope: empresas } : {}),
        puedeItech: empresas.includes(EMPRESA_ITECH)
      };
    }
    const correo = deps.correoDeSesion(contexto);
    if (!correo && deps.esAdmin(contexto)) {
      return { director: true, puedeItech: true };
    }
    if (!correo) {
      throw new ErrorPuente('Se requiere sesión para consultar el RAG.', 401);
    }
    const esDelDueno = deps
      .correosDelDueno()
      .some((c) => c.toLowerCase() === correo.toLowerCase());
    const usuario =
      buscarUsuarioPorCorreo(correo, deps.usuarios()) ??
      (esDelDueno ? usuarioDirector(correo) : undefined);
    if (!usuario?.activo) {
      throw new ErrorPuente('No tienes acceso a las juntas del RAG.', 403);
    }
    const permisos = permisosEfectivos(usuario, roles());
    const director = esDirector(permisos) || esDelDueno;
    if (
      !director &&
      !tienePermiso(permisos, 'proyectos', 'lectura') &&
      !tienePermiso(permisos, 'actividades', 'lectura')
    ) {
      throw new ErrorPuente(
        'No tienes permiso para consultar las juntas.',
        403
      );
    }
    if (director || !usuario.alcance) {
      return { director, puedeItech: true };
    }
    if (!usuario.alcance.empresas?.length) {
      throw new ErrorPuente(
        'Tu alcance no incluye empresas, así que no puedes consultar el RAG.',
        403
      );
    }
    const tope = usuario.alcance.empresas.flatMap((e) => {
      const id = empresaIdDe(e, catalogo());
      return id ? [id] : [];
    });
    return {
      director: false,
      tope,
      puedeItech: tope.includes(EMPRESA_ITECH)
    };
  };

  const consultar = async (
    contexto: Contexto
  ): Promise<{
    fragmentos: FragmentoHallado[];
    aviso?: string;
    clausula: ClausulaEmpresa;
    pregunta: string;
    k: number;
  }> => {
    const cuerpo = comoObjeto(contexto.cuerpo);
    const pedido = pedidoDe(cuerpo);
    if (!pedido.pregunta?.trim()) {
      throw new ErrorPuente('La pregunta es obligatoria.', 400);
    }
    const actor = actorDe(contexto);
    const clausula = resolverEmpresas(pedido, actor, catalogo());
    const k = kDe(pedido);
    const nombres = [
      ...deps.clientes().map((c) => c.nombre),
      ...(actor.puedeItech
        ? deps
            .juntas()
            .flatMap((j) =>
              j.esItech && j.clienteNombre ? [j.clienteNombre] : []
            )
        : [])
    ];
    const cliente =
      pedido.cliente?.trim() || clienteMencionado(pedido.pregunta, nombres);
    const sql = exigirSql();
    await esquema(sql);
    const [vector] = await (ganchos.embeddings ?? embeddingsDe)(
      configEmbeddings(),
      [pedido.pregunta]
    );
    if (!vector) {
      throw new ErrorPuente('No se pudo vectorizar la pregunta.', 502);
    }
    const fragmentos = await buscarHibrido(
      sql,
      pedido.pregunta,
      vector,
      {
        clausula,
        cliente,
        proyecto: pedido.proyecto,
        desde: fechaDePedido(pedido.desde, 'desde'),
        hasta: fechaDePedido(pedido.hasta, 'hasta')
      },
      k
    );
    const aviso =
      fragmentos.length === 0 &&
      clausula.excluyeItech &&
      actor.puedeItech &&
      clienteMencionado(
        pedido.pregunta,
        deps
          .juntas()
          .flatMap((j) =>
            j.esItech && j.clienteNombre ? [j.clienteNombre] : []
          )
      )
        ? 'No incluí las juntas de Itech Dev. Repite la consulta con empresa "itech-dev" si va de ahí.'
        : undefined;
    return { fragmentos, aviso, clausula, pregunta: pedido.pregunta, k };
  };

  router.post('/rag/buscar', async (contexto) => {
    const { fragmentos, aviso } = await consultar(contexto);
    return aviso ? { fragmentos, aviso } : { fragmentos };
  });

  router.post('/rag/preguntar', async (contexto) => {
    const { fragmentos, aviso, pregunta } = await consultar(contexto);
    if (fragmentos.length === 0) {
      return {
        respuesta: aviso ?? 'No encontré juntas que respondan eso.',
        fuentes: [],
        aviso
      };
    }
    const preparado = prepararPregunta(pregunta, fragmentos);
    const ia = deps.cfg().ia;
    if (!ia && !ganchos.redactar) {
      throw new ErrorConfiguracion(
        'Falta OPENROUTER_API_KEY para redactar la respuesta.'
      );
    }
    const redaccion = ganchos.redactar
      ? await ganchos.redactar(preparado.sistema, preparado.usuario)
      : await preguntarModelo(ia as NonNullable<typeof ia>, {
          uso: 'rag',
          sistema: preparado.sistema,
          usuario: preparado.usuario,
          maxTokens: 1200
        });
    const cerrada = cerrarRespuesta(redaccion, preparado.fuentes);
    return aviso ? { ...cerrada, aviso } : cerrada;
  });

  router.get('/rag/alcance', async (contexto) => {
    const actor = actorDe(contexto);
    const sql = exigirSql();
    await esquema(sql);

    const todasEmpresas = catalogo();
    let empresasPermitidas: typeof todasEmpresas;

    if (actor.director) {
      empresasPermitidas = todasEmpresas;
    } else if (actor.tope) {
      empresasPermitidas = todasEmpresas.filter((e) =>
        actor.tope!.includes(e.id)
      );
    } else {
      empresasPermitidas = todasEmpresas;
    }

    const empresaIds = empresasPermitidas.map((e) => e.id);
    const proyectosFila = await sql.ejecutar(
      `SELECT DISTINCT empresa, proyecto
         FROM rag_documentos
        WHERE empresa = ANY($1::text[])
          AND proyecto IS NOT NULL
          AND proyecto <> ''
        ORDER BY empresa, proyecto`,
      [empresaIds]
    );

    const proyectosPorEmpresa: Record<string, string[]> = {};
    for (const fila of proyectosFila) {
      const emp = String(fila['empresa'] ?? '');
      const proy = String(fila['proyecto'] ?? '');
      if (!proyectosPorEmpresa[emp]) {
        proyectosPorEmpresa[emp] = [];
      }
      if (proy && !proyectosPorEmpresa[emp].includes(proy)) {
        proyectosPorEmpresa[emp].push(proy);
      }
    }

    return {
      empresas: empresasPermitidas.map((e) => ({
        id: e.id,
        nombre: e.nombre,
        proyectos: proyectosPorEmpresa[e.id] ?? []
      })),
      puedeItech: actor.puedeItech
    };
  });

  /**
   * GET /rag/archivo/:driveFileId — descarga un archivo de Drive.
   * Verifica permisos de empresa y sensibilidad (costos).
   * Retorna 404 uniforme para: no encontrado, empresa no permitida, y costos restringidos.
   */
  router.get('/rag/archivo/:driveFileId', async (contexto) => {
    const driveFileId = contexto.segmentos[2];
    if (!driveFileId) {
      throw new ErrorPuente('driveFileId es obligatorio.', 400);
    }
    const actor = actorDe(contexto);
    const sql = exigirSql();
    await esquema(sql);

    const filas = await sql.ejecutar(
      `SELECT empresa, sensibilidad FROM rag_documentos WHERE drive_file_id = $1`,
      [driveFileId]
    );
    if (filas.length === 0) {
      throw new ErrorPuente('Documento no encontrado.', 404);
    }
    const empresaDoc = String(filas[0]?.['empresa'] ?? '');
    const sensibilidad = String(filas[0]?.['sensibilidad'] ?? 'costos');

    if (!actor.director && actor.tope && !actor.tope.includes(empresaDoc)) {
      throw new ErrorPuente('Documento no encontrado.', 404);
    }

    if (sensibilidad === 'costos') {
      const correo = deps.correoDeSesion(contexto);
      const esAdminODueno =
        deps.esAdmin(contexto) ||
        (correo && deps.correosDelDueno().includes(correo));
      let puedeCostos = esAdminODueno;
      if (!puedeCostos && correo) {
        const usuario = buscarUsuarioPorCorreo(correo, deps.usuarios());
        if (usuario) {
          const permisos = permisosEfectivos(usuario, roles());
          puedeCostos = tienePermiso(permisos, 'costos', 'lectura');
        }
      }
      if (!puedeCostos) {
        throw new ErrorPuente('Documento no encontrado.', 404);
      }
    }

    const rag = deps.cfg().ragDrive;
    if (!rag && !ganchosDescarga.tokenDeCuentaServicio) {
      throw new ErrorConfiguracion(
        'Falta GOOGLE_DRIVE_CUENTA_SERVICIO para descargar archivos.'
      );
    }

    const token = ganchosDescarga.tokenDeCuentaServicio
      ? await ganchosDescarga.tokenDeCuentaServicio()
      : await tokenDeCuentaServicio(rag!.cuenta);
    const descarga = ganchosDescarga.descargarArchivo
      ? await ganchosDescarga.descargarArchivo(token, driveFileId)
      : await descargarArchivo(token, driveFileId);

    return new RespuestaBinaria(
      descarga.contenido,
      descarga.mimeType,
      descarga.nombre
    );
  });

  /**
   * GET /rag/atencion — Puntos de atención consolidados:
   * riesgos/bloqueos abiertos de proyectos, pendientes de juntas y acuerdos
   * que el actor puede ver. Respeta los mismos permisos de empresa que el
   * resto del RAG.
   *
   * Query params:
   * - empresa: filtrar por empresa (id o nombre)
   * - proyecto: filtrar por proyecto (id)
   */
  router.get('/rag/atencion', async (contexto) => {
    const actor = actorDe(contexto);
    const cat = catalogo();

    const filtroEmpresa = contexto.parametros.get('empresa') ?? undefined;
    const filtroProyecto = contexto.parametros.get('proyecto') ?? undefined;

    let empresasPermitidas: string[];
    if (actor.director) {
      empresasPermitidas = cat.map((e) => e.id);
    } else if (actor.tope) {
      empresasPermitidas = actor.tope;
    } else {
      empresasPermitidas = cat.map((e) => e.id);
    }

    if (filtroEmpresa) {
      const empresaId = empresaIdDe(filtroEmpresa, cat) ?? filtroEmpresa;
      if (!empresasPermitidas.includes(empresaId)) {
        throw new ErrorPuente('No tienes acceso a esa empresa.', 403);
      }
      empresasPermitidas = [empresaId];
    }

    const correo = deps.correoDeSesion(contexto);
    const esAdminODueno =
      deps.esAdmin(contexto) ||
      (correo && deps.correosDelDueno().includes(correo));
    let puedeCostos = esAdminODueno;
    if (!puedeCostos && correo) {
      const usuario = buscarUsuarioPorCorreo(correo, deps.usuarios());
      if (usuario) {
        const permisos = permisosEfectivos(usuario, roles());
        puedeCostos = tienePermiso(permisos, 'costos', 'lectura');
      }
    }

    interface PuntoAtencion {
      id: string;
      tipo: 'riesgo' | 'bloqueo' | 'pendiente' | 'acuerdo';
      proyectoId?: string;
      proyectoNombre: string | null;
      descripcion: string;
      impacto?: string | null;
      mitigacion?: string | null;
      fecha: string;
      responsableId?: string | null;
      fuente?: string;
    }

    const puntos: PuntoAtencion[] = [];

    const proyectos = deps.proyectos?.() ?? [];
    const proyectosPorId = new Map(proyectos.map((p) => [p.id, p]));
    const proyectosPorNombre = new Map(
      proyectos.map((p) => [p.nombre.toLowerCase(), p])
    );

    const todosRiesgos = deps.riesgos?.() ?? [];
    for (const r of todosRiesgos) {
      if (!r.abierto) continue;
      const proyecto = proyectosPorId.get(r.proyectoId);
      if (!proyecto) continue;
      const empresaProyecto = proyecto.empresaAtiendeId;
      if (empresaProyecto && !empresasPermitidas.includes(empresaProyecto)) {
        continue;
      }
      if (!empresaProyecto && actor.tope) {
        continue;
      }
      if (filtroProyecto && proyecto.id !== filtroProyecto) continue;
      let descripcion = r.descripcion;
      let impacto = r.impacto ?? null;
      let mitigacion = r.mitigacion ?? null;
      if (!puedeCostos) {
        descripcion = redactarCostos(descripcion);
        impacto = impacto ? redactarCostos(impacto) : null;
        mitigacion = mitigacion ? redactarCostos(mitigacion) : null;
      }
      puntos.push({
        id: r.id,
        tipo: r.tipo,
        proyectoId: r.proyectoId,
        proyectoNombre: proyecto.nombre,
        descripcion,
        impacto,
        mitigacion,
        fecha: r.fechaReporte,
        responsableId: r.responsableId ?? null,
        fuente: 'crm'
      });
    }

    const pendientes = deps.pendientes?.() ?? [];
    for (const t of pendientes) {
      if (t.status !== 'pendiente' && t.status !== 'en_progreso') continue;
      const esDeJunta =
        t.id.startsWith('fireflies-') || t.tags?.includes('fireflies');
      if (!esDeJunta) continue;
      const empresaId = t.company
        ? empresaIdDe(t.company, cat) ?? t.company
        : undefined;
      if (empresaId && !empresasPermitidas.includes(empresaId)) continue;
      if (!empresaId && actor.tope) {
        continue;
      }
      let proyectoDelPendiente: CrmProyecto | undefined;
      if (t.project) {
        proyectoDelPendiente = proyectosPorNombre.get(t.project.toLowerCase());
      }
      if (filtroProyecto && proyectoDelPendiente?.id !== filtroProyecto) {
        continue;
      }
      let descripcion = t.description ?? t.title;
      if (!puedeCostos) {
        descripcion = redactarCostos(descripcion);
      }
      puntos.push({
        id: t.id,
        tipo: 'pendiente',
        proyectoId: proyectoDelPendiente?.id,
        proyectoNombre: proyectoDelPendiente?.nombre ?? t.project ?? null,
        descripcion,
        fecha: t.updatedAt,
        responsableId: t.assignee?.id ?? null,
        fuente: 'junta'
      });

      for (const sub of t.subtareas ?? []) {
        if (sub.convertida) continue;
        let subDescripcion = sub.titulo;
        if (!puedeCostos) {
          subDescripcion = redactarCostos(subDescripcion);
        }
        puntos.push({
          id: sub.id,
          tipo: 'acuerdo',
          proyectoId: proyectoDelPendiente?.id,
          proyectoNombre: proyectoDelPendiente?.nombre ?? t.project ?? null,
          descripcion: subDescripcion,
          fecha: t.updatedAt,
          responsableId: sub.responsables?.[0]?.id ?? null,
          fuente: 'junta'
        });
      }
    }

    puntos.sort((a, b) => {
      const orden: Record<PuntoAtencion['tipo'], number> = {
        bloqueo: 0,
        riesgo: 1,
        pendiente: 2,
        acuerdo: 3
      };
      if (orden[a.tipo] !== orden[b.tipo]) {
        return orden[a.tipo] - orden[b.tipo];
      }
      return b.fecha.localeCompare(a.fecha);
    });

    return {
      puntos: puntos.slice(0, 50),
      puedeItech: actor.puedeItech,
      puedeCostos
    };
  });

  deps.programables.push({
    nombre: 'rag vectorial',
    cadaMinutos: REVISION_MINUTOS.diario,
    esperarMinutos: 24 * 60,
    correr: async () => {
      const sql = deps.persistencia.sql;
      const cfg = deps.cfg();
      if (!sql || !cfg.ragDrive || !cfg.ia) {
        return 'omitida';
      }
      const ahora = new Date();
      const hora = Number(
        new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/Mexico_City',
          hour: 'numeric',
          hourCycle: 'h23'
        }).format(ahora)
      );
      if (hora < 4) {
        return 'omitida';
      }
      const dia = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Mexico_City'
      }).format(ahora);
      await esquema(sql);
      if ((await leerMarca(sql, 'reconciliacion')) === dia) {
        return 'omitida';
      }
      const resumen = await reconciliarDrive(deps, sql, ingerir);
      await guardarMarca(sql, 'reconciliacion', dia);
      console.log(
        `[puente] RAG vectorial: ${resumen.actualizados} actualizadas, ${resumen.borrados} borradas`
      );
      return;
    }
  });
}

async function reconciliarDrive(
  deps: DependenciasRag,
  sql: Sql,
  ingerir: (cuerpo: CuerpoIngestaRag, sql: Sql) => Promise<unknown>
): Promise<{ actualizados: number; borrados: number }> {
  const rag = deps.cfg().ragDrive;
  if (!rag) {
    return { actualizados: 0, borrados: 0 };
  }
  const token = await tokenDeCuentaServicio(rag.cuenta);
  const raices = raicesDe(deps, rag);
  const recorrido = await juntarMarkdown(
    raices,
    (id) => listarHijosDrive(token, id),
    { excluir: rag.excluir }
  );
  const plan = planearReconciliacion(
    recorrido.archivos.map((a) => ({
      driveFileId: a.id,
      ruta: a.ruta,
      modificadoEn: a.modifiedTime
    })),
    await idsEnDrive(sql),
    recorrido.completo
  );
  let actualizados = 0;
  for (const archivo of plan.bajar) {
    try {
      const markdown = await textoDeArchivo(token, archivo.driveFileId);
      await ingerir(
        {
          driveFileId: archivo.driveFileId,
          markdown,
          ruta: archivo.ruta,
          driveUrl: recorrido.archivos.find((a) => a.id === archivo.driveFileId)
            ?.webViewLink,
          modificadoEn: archivo.modificadoEn
        },
        sql
      );
      actualizados += 1;
    } catch (error) {
      console.warn(
        `[puente] RAG vectorial "${archivo.ruta}": ${describir(error)}`
      );
    }
  }
  const borrados = await borrarPorDrive(sql, plan.borrar);
  return { actualizados, borrados };
}

function raicesDe(
  deps: DependenciasRag,
  rag: NonNullable<Configuracion['ragDrive']>
): RaizDrive[] {
  if (rag.raizId) {
    return [{ id: rag.raizId, nombre: 'Empresas' }];
  }
  return rag.carpetas.map((c) => ({
    id: c.carpetaId,
    nombre:
      deps.empresas().find((e) => e.id === c.empresaId)?.nombre ?? c.empresaId
  }));
}

function pedidoDe(cuerpo: Record<string, unknown>): PedidoRag {
  const empresas = Array.isArray(cuerpo['empresas'])
    ? cuerpo['empresas'].filter((e): e is string => typeof e === 'string')
    : undefined;
  const k = cuerpo['k'];
  return {
    pregunta: texto(cuerpo['pregunta']),
    empresa: texto(cuerpo['empresa']),
    empresas,
    incluirItech: cuerpo['incluirItech'] === true,
    cliente: texto(cuerpo['cliente']),
    proyecto: texto(cuerpo['proyecto']),
    desde: texto(cuerpo['desde']),
    hasta: texto(cuerpo['hasta']),
    k: k === undefined || k === null ? undefined : Number(k)
  };
}

function comoObjeto(cuerpo: unknown): Record<string, unknown> {
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) {
    throw new ErrorPuente('El cuerpo debe ser un objeto JSON.', 400);
  }
  return cuerpo as Record<string, unknown>;
}

function texto(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : undefined;
}

function tokenDe(contexto: Contexto): string {
  const encabezado = contexto.encabezados['authorization'] ?? '';
  return encabezado.toLowerCase().startsWith('bearer ')
    ? encabezado.slice(7).trim()
    : '';
}

/**
 * Redacta cantidades de dinero, porcentajes y referencias bancarias de un
 * texto para actores sin permiso de costos. Reemplaza $1,234.56, 1234 MXN,
 * +IVA, porcentajes, y referencias a cuentas bancarias.
 */
function redactarCostos(texto: string): string {
  return texto
    .replace(/\$\s*[\d,]+(?:\.\d{1,2})?/g, '[monto redactado]')
    .replace(/[\d,]+(?:\.\d{1,2})?\s*(?:MXN|USD|pesos|dólares)/gi, '[monto redactado]')
    .replace(/\+\s*IVA/gi, '[+IVA]')
    .replace(/\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\s*%/g, '[porcentaje]')
    .replace(/(?:cuenta|clabe|tarjeta|CLABE)\s*[:\s]*\d{10,18}/gi, '[cuenta redactada]');
}
