import type { Sql } from '../datos/persistencia.js';
import { literalHalfvec } from '../proveedores/embeddings.js';
import { ErrorPuente } from '../nucleo/errores.js';
import {
  sqlEmpresas,
  sqlSensibilidad,
  type ClausulaEmpresa
} from './alcance.js';
import type { Sensibilidad } from './clasificar.js';
import { fusionarRrf } from './hibrida.js';

const CANDIDATOS = 40;

export interface FragmentoAGuardar {
  orden: number;
  seccion: string;
  texto: string;
  tokens: number;
  embedding: number[];
}

export interface DocumentoAGuardar {
  id: string;
  driveFileId: string;
  driveUrl?: string;
  ruta?: string;
  titulo: string;
  fecha?: string;
  empresa: string;
  cliente?: string;
  proyecto?: string;
  /** Va al documento y a cada uno de sus fragmentos. Ver clasificarSensibilidad. */
  sensibilidad: Sensibilidad;
  tipo?: string;
  participantes: string[];
  frontmatter: Record<string, unknown>;
  huella: string;
  modeloEmb: string;
  modificadoEn?: string;
  fragmentos: FragmentoAGuardar[];
}

export interface ResultadoGuardado {
  id: string;
  omitido: boolean;
  fragmentos: number;
  empresa: string;
}

export interface FiltroBusqueda {
  clausula: ClausulaEmpresa;
  cliente?: string;
  desde?: string;
  hasta?: string;
}

export interface FragmentoHallado {
  id: string;
  documentoId: string;
  orden: number;
  seccion: string | null;
  texto: string;
  empresa: string;
  cliente: string | null;
  proyecto: string | null;
  fecha: string | null;
  titulo: string;
  driveFileId: string;
  driveUrl: string | null;
  puntuacion: number;
}

interface FilaDocumento {
  id?: unknown;
  huella?: unknown;
  modelo_emb?: unknown;
  ruta?: unknown;
  drive_url?: unknown;
  drive_modificado_en?: unknown;
  sensibilidad?: unknown;
  proyecto?: unknown;
  empresa?: unknown;
  cliente?: unknown;
  fragmentos_desalineados?: unknown;
}

/**
 * Si la huella y el modelo siguen igual, no hay que volver a embeber.
 * Actualiza ruta y liga cuando el archivo se movio en Drive. No toca el CRM.
 *
 * Aunque el contenido no cambie, la sensibilidad, el proyecto, la empresa y el
 * cliente se vuelven a calcular de la ruta y el texto (con la misma
 * precedencia de la ingesta: frontmatter primero, luego ruta): si difieren de
 * lo guardado (o algun fragmento no coincide con su documento), se corrigen en
 * el documento y en TODOS sus fragmentos, en una sola transaccion y sin pedir
 * embeddings. Asi un documento movido de carpeta o de empresa, o uno indexado
 * antes de que existieran esas columnas, se realinea al volver a correr
 * `npm run rag:backfill` o la reconciliacion diaria. El texto de los
 * fragmentos (su cabecera con empresa/cliente/proyecto) no se reescribe.
 *
 * Devuelve `undefined` cuando hay que ingerir completo: el documento no
 * existe, cambio su huella o su modelo, o otra ingesta lo reemplazo mientras
 * se decidia (en ese caso no se escribe nada).
 */
export async function saltarSiNoCambio(
  sql: Sql,
  doc: Pick<
    DocumentoAGuardar,
    | 'id'
    | 'driveFileId'
    | 'huella'
    | 'modeloEmb'
    | 'ruta'
    | 'driveUrl'
    | 'modificadoEn'
    | 'empresa'
    | 'cliente'
    | 'proyecto'
    | 'sensibilidad'
  >
): Promise<ResultadoGuardado | undefined> {
  const previos = await sql.ejecutar(
    `SELECT d.id, d.huella, d.modelo_emb, d.ruta, d.drive_url,
            d.drive_modificado_en, d.sensibilidad, d.proyecto, d.empresa,
            d.cliente,
            EXISTS (
              SELECT 1
                FROM rag_fragmentos f
               WHERE f.documento_id = d.id
                 AND (f.sensibilidad IS DISTINCT FROM $3::text
                      OR f.proyecto IS DISTINCT FROM $4::text
                      OR f.empresa IS DISTINCT FROM $5::text
                      OR f.cliente IS DISTINCT FROM $6::text)
            ) AS fragmentos_desalineados
       FROM rag_documentos d
      WHERE d.drive_file_id = $1 OR d.id = $2
      LIMIT 1`,
    [
      doc.driveFileId,
      doc.id,
      doc.sensibilidad,
      doc.proyecto ?? null,
      doc.empresa,
      doc.cliente ?? null
    ]
  );
  const previo = previos[0] as FilaDocumento | undefined;
  if (
    previo &&
    previo.huella === doc.huella &&
    previo.modelo_emb === doc.modeloEmb
  ) {
    const ruta = texto(previo.ruta);
    const url = texto(previo.drive_url);
    const modificado = instante(previo.drive_modificado_en);
    const rutaCambia = doc.ruta !== undefined && (ruta ?? '') !== doc.ruta;
    const urlCambia =
      doc.driveUrl !== undefined && (url ?? '') !== doc.driveUrl;
    const tiempoCambia =
      doc.modificadoEn !== undefined &&
      !mismoInstante(modificado, doc.modificadoEn);
    const reclasifica =
      previo.sensibilidad !== doc.sensibilidad ||
      (texto(previo.proyecto) ?? null) !== (doc.proyecto ?? null) ||
      previo.empresa !== doc.empresa ||
      (texto(previo.cliente) ?? null) !== (doc.cliente ?? null) ||
      previo.fragmentos_desalineados === true;
    const id = String(previo.id);
    if (rutaCambia || urlCambia || tiempoCambia || reclasifica) {
      // La lectura de arriba corrio fuera de la transaccion: otra ingesta
      // pudo reemplazar el documento desde entonces. Se vuelve a tomar la
      // fila con su candado y con la misma huella y modelo; si ya no es esa,
      // no se toca nada (ni el documento ni los fragmentos del nuevo) y se
      // sigue con la ingesta completa, para que contenido y clase salgan del
      // mismo envio. Con la fila bloqueada, un reemplazo concurrente espera.
      const vigente = await sql.transaccion(async (ejecutar) => {
        const filas = await ejecutar(
          `SELECT id
             FROM rag_documentos
            WHERE id = $1 AND huella = $2 AND modelo_emb = $3
              FOR UPDATE`,
          [id, doc.huella, doc.modeloEmb]
        );
        if (filas.length === 0) {
          return false;
        }
        if (rutaCambia || urlCambia || tiempoCambia) {
          await ejecutar(
            `UPDATE rag_documentos
                SET ruta = $2,
                    drive_url = $3,
                    drive_modificado_en = $4,
                    actualizado_en = now()
              WHERE id = $1`,
            [
              id,
              doc.ruta ?? null,
              doc.driveUrl ?? null,
              doc.modificadoEn ?? null
            ]
          );
        }
        if (reclasifica) {
          await ejecutar(
            `UPDATE rag_documentos
                SET sensibilidad = $2,
                    proyecto = $3,
                    empresa = $4,
                    cliente = $5,
                    actualizado_en = now()
              WHERE id = $1`,
            [
              id,
              doc.sensibilidad,
              doc.proyecto ?? null,
              doc.empresa,
              doc.cliente ?? null
            ]
          );
          // Solo los fragmentos que difieren: cada fila reescrita agrega una
          // entrada en cada indice, el HNSW incluido.
          await ejecutar(
            `UPDATE rag_fragmentos
                SET sensibilidad = $2,
                    proyecto = $3,
                    empresa = $4,
                    cliente = $5
              WHERE documento_id = $1
                AND (sensibilidad IS DISTINCT FROM $2::text
                     OR proyecto IS DISTINCT FROM $3::text
                     OR empresa IS DISTINCT FROM $4::text
                     OR cliente IS DISTINCT FROM $5::text)`,
            [
              id,
              doc.sensibilidad,
              doc.proyecto ?? null,
              doc.empresa,
              doc.cliente ?? null
            ]
          );
        }
        return true;
      });
      if (!vigente) {
        return undefined;
      }
    }
    return {
      id,
      omitido: true,
      fragmentos: 0,
      empresa: doc.empresa
    };
  }
  return undefined;
}

export async function guardarDocumento(
  sql: Sql,
  doc: DocumentoAGuardar
): Promise<ResultadoGuardado> {
  const salto = await saltarSiNoCambio(sql, doc);
  if (salto) {
    return salto;
  }

  await sql.transaccion(async (ejecutar) => {
    await ejecutar(
      `DELETE FROM rag_documentos WHERE drive_file_id = $1 OR id = $2`,
      [doc.driveFileId, doc.id]
    );
    await ejecutar(
      `INSERT INTO rag_documentos (
          id, drive_file_id, drive_url, ruta, titulo, fecha, empresa, cliente,
          proyecto, tipo, participantes, frontmatter, huella, modelo_emb,
          drive_modificado_en, actualizado_en, sensibilidad
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11::text[], $12::jsonb, $13, $14,
          $15, now(), $16
        )`,
      [
        doc.id,
        doc.driveFileId,
        doc.driveUrl ?? null,
        doc.ruta ?? null,
        doc.titulo,
        doc.fecha ?? null,
        doc.empresa,
        doc.cliente ?? null,
        doc.proyecto ?? null,
        doc.tipo ?? null,
        doc.participantes,
        JSON.stringify(doc.frontmatter),
        doc.huella,
        doc.modeloEmb,
        doc.modificadoEn ?? null,
        doc.sensibilidad
      ]
    );
    if (doc.fragmentos.length === 0) {
      return;
    }
    await ejecutar(
      `INSERT INTO rag_fragmentos (
          documento_id, orden, seccion, empresa, cliente, fecha, texto, tokens,
          embedding, sensibilidad, proyecto
        )
        SELECT $1, u.orden, u.seccion, $2, $3, $4, u.texto, u.tokens,
               u.embedding::halfvec, $10::text, $11::text
          FROM unnest(
            $5::int[],
            $6::text[],
            $7::text[],
            $8::int[],
            $9::text[]
          ) AS u(orden, seccion, texto, tokens, embedding)`,
      [
        doc.id,
        doc.empresa,
        doc.cliente ?? null,
        doc.fecha ?? null,
        doc.fragmentos.map((f) => f.orden),
        doc.fragmentos.map((f) => f.seccion),
        doc.fragmentos.map((f) => f.texto),
        doc.fragmentos.map((f) => f.tokens),
        doc.fragmentos.map((f) => literalHalfvec(f.embedding)),
        doc.sensibilidad,
        doc.proyecto ?? null
      ]
    );
  });

  return {
    id: doc.id,
    omitido: false,
    fragmentos: doc.fragmentos.length,
    empresa: doc.empresa
  };
}

/**
 * Top 40 por coseno y top 40 por texto espanol, fusionados con RRF.
 * El filtro de empresa (y la exclusion de Itech) y el de sensibilidad van en
 * el WHERE de las dos consultas, antes del ORDER BY ... LIMIT: no hay filtrado
 * posterior que pueda dejar pasar algo.
 */
export async function buscarHibrido(
  sql: Sql,
  pregunta: string,
  vector: readonly number[],
  filtro: FiltroBusqueda,
  k: number
): Promise<FragmentoHallado[]> {
  const empresa = sqlEmpresas(filtro.clausula, 1, 'f.empresa');
  const sensibilidad = sqlSensibilidad(filtro.clausula, 'f', 'd');
  const paramsBase: unknown[] = [
    ...empresa.parametros,
    filtro.cliente ?? null,
    filtro.desde ?? null,
    filtro.hasta ?? null
  ];
  const iCliente = empresa.parametros.length + 1;
  const iDesde = iCliente + 1;
  const iHasta = iDesde + 1;
  const donde = `
    WHERE TRUE
      ${empresa.sql}
      ${sensibilidad}
      AND ($${iCliente}::text IS NULL OR lower(f.cliente) = lower($${iCliente}))
      AND ($${iDesde}::timestamptz IS NULL OR f.fecha >= $${iDesde})
      AND ($${iHasta}::timestamptz IS NULL OR f.fecha <= $${iHasta})`;
  const columnas = `
    f.id::text AS id,
    f.documento_id,
    f.orden,
    f.seccion,
    f.texto,
    f.empresa,
    f.cliente,
    d.proyecto,
    f.fecha,
    f.sensibilidad AS sensibilidad,
    d.sensibilidad AS documento_sensibilidad,
    d.titulo,
    d.drive_file_id,
    d.drive_url`;
  const desde = `
    FROM rag_fragmentos f
    JOIN rag_documentos d ON d.id = f.documento_id`;

  const iVector = iHasta + 1;
  const porVector = await sql.ejecutar(
    `SELECT ${columnas}
       ${desde}
       ${donde}
      ORDER BY f.embedding <=> $${iVector}::halfvec
      LIMIT ${CANDIDATOS}`,
    [...paramsBase, literalHalfvec(vector)]
  );

  const iPregunta = iHasta + 1;
  const porTexto = await sql.ejecutar(
    `SELECT ${columnas}
       ${desde},
            websearch_to_tsquery('spanish', $${iPregunta}) q
       ${donde}
        AND f.tsv @@ q
      ORDER BY ts_rank_cd(f.tsv, q) DESC
      LIMIT ${CANDIDATOS}`,
    [...paramsBase, pregunta]
  );

  // Red de seguridad, no el filtro (el filtro ya esta en el SQL de arriba):
  // si una consulta devolvio algo que no es 'general' a quien no tiene costos,
  // la funcion falla en lugar de entregarlo. Atrapa una regresion del WHERE.
  if (
    filtro.clausula.incluyeCostos !== true &&
    [...porVector, ...porTexto].some(
      (fila) =>
        fila['sensibilidad'] !== 'general' ||
        fila['documento_sensibilidad'] !== 'general'
    )
  ) {
    throw new ErrorPuente(
      'No se pudo verificar el alcance de la consulta.',
      500
    );
  }

  const fusion = fusionarRrf(
    [porVector.map(filaId), porTexto.map(filaId)],
    60
  ).slice(0, k);
  const porId = new Map<string, FragmentoHallado>();
  for (const fila of [...porVector, ...porTexto]) {
    const id = String(fila['id'] ?? '');
    if (!id || porId.has(id)) {
      continue;
    }
    porId.set(id, filaHallada(fila, 0));
  }
  return fusion.flatMap((item) => {
    const hallado = porId.get(item.id);
    return hallado ? [{ ...hallado, puntuacion: item.puntuacion }] : [];
  });
}

/**
 * Avisa en el log si hay fragmentos indexados y ninguno es 'general': señal de
 * que falta correr `npm run rag:backfill` (el DEFAULT de la columna es
 * 'costos'). Solo informa: no cambia lo que ve nadie. Nunca lanza.
 */
export async function avisarSiFaltaBackfill(
  sql: Sql,
  avisar: (mensaje: string) => void = console.warn
): Promise<void> {
  try {
    const filas = await sql.ejecutar(
      `SELECT EXISTS (SELECT 1 FROM rag_fragmentos) AS hay,
              EXISTS (
                SELECT 1 FROM rag_fragmentos WHERE sensibilidad = 'general'
              ) AS general`
    );
    if (filas[0]?.['hay'] === true && filas[0]?.['general'] !== true) {
      avisar(
        '[puente] RAG: ningún fragmento está marcado como general, así que todo cuenta como costos y solo lo ve quien tiene permiso de costos. Si la base ya estaba indexada, falta correr npm run rag:backfill.'
      );
    }
  } catch (error) {
    avisar(
      `[puente] RAG: no se pudo revisar la clasificación de los fragmentos (${error instanceof Error ? error.message : error}).`
    );
  }
}

export async function idsEnDrive(sql: Sql): Promise<
  {
    driveFileId: string;
    ruta: string | null;
    modificadoEn: string | null;
  }[]
> {
  const filas = await sql.ejecutar(
    `SELECT drive_file_id, ruta, drive_modificado_en FROM rag_documentos`
  );
  return filas.map((f) => ({
    driveFileId: String(f['drive_file_id'] ?? ''),
    ruta: texto(f['ruta']) ?? null,
    modificadoEn: instante(f['drive_modificado_en']) ?? null
  }));
}

/** Borra documentos cuyo archivo ya no esta en Drive. El CASCADE se lleva los fragmentos. */
export async function borrarPorDrive(
  sql: Sql,
  ids: readonly string[]
): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }
  const filas = await sql.ejecutar(
    `DELETE FROM rag_documentos WHERE drive_file_id = ANY($1::text[]) RETURNING id`,
    [ids]
  );
  return filas.length;
}

export async function leerMarca(
  sql: Sql,
  clave: string
): Promise<string | undefined> {
  const filas = await sql.ejecutar(
    `SELECT valor FROM rag_estado WHERE clave = $1`,
    [clave]
  );
  const valor = filas[0]?.['valor'];
  return typeof valor === 'string' ? valor : undefined;
}

export async function guardarMarca(
  sql: Sql,
  clave: string,
  valor: string
): Promise<void> {
  await sql.ejecutar(
    `INSERT INTO rag_estado (clave, valor, actualizado_en)
     VALUES ($1, $2, now())
     ON CONFLICT (clave) DO UPDATE
       SET valor = EXCLUDED.valor, actualizado_en = now()`,
    [clave, valor]
  );
}

function filaId(fila: Record<string, unknown>): { id: string } {
  return { id: String(fila['id'] ?? '') };
}

function filaHallada(
  fila: Record<string, unknown>,
  puntuacion: number
): FragmentoHallado {
  const driveFileId = String(fila['drive_file_id'] ?? '');
  const driveUrl = texto(fila['drive_url']);
  return {
    id: String(fila['id'] ?? ''),
    documentoId: String(fila['documento_id'] ?? ''),
    orden: Number(fila['orden'] ?? 0),
    seccion: texto(fila['seccion']) ?? null,
    texto: String(fila['texto'] ?? ''),
    empresa: String(fila['empresa'] ?? ''),
    cliente: texto(fila['cliente']) ?? null,
    proyecto: texto(fila['proyecto']) ?? null,
    fecha: instante(fila['fecha']) ?? null,
    titulo: String(fila['titulo'] ?? ''),
    driveFileId,
    driveUrl:
      driveUrl ??
      (driveFileId
        ? `https://drive.google.com/file/d/${driveFileId}/view`
        : null),
    puntuacion
  };
}

function texto(valor: unknown): string | undefined {
  if (valor instanceof Date) {
    return valor.toISOString();
  }
  return typeof valor === 'string' && valor.trim() ? valor : undefined;
}

function mismoInstante(guardado: string | undefined, pedido: string): boolean {
  const b = Date.parse(pedido);
  if (Number.isNaN(b)) {
    return guardado === pedido;
  }
  if (!guardado) {
    return false;
  }
  const a = Date.parse(guardado);
  if (Number.isNaN(a)) {
    return false;
  }
  return Math.abs(a - b) <= 2000;
}

function instante(valor: unknown): string | undefined {
  if (valor instanceof Date) {
    return valor.toISOString();
  }
  if (typeof valor === 'string' && valor.trim()) {
    const ms = Date.parse(valor);
    return Number.isNaN(ms) ? valor : new Date(ms).toISOString();
  }
  return undefined;
}
