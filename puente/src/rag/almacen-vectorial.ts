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
  cabecera_desalineada?: unknown;
}

type DatosDeSalto = Pick<
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
> & {
  /**
   * El texto que la ingesta acaba de armar para cada fragmento. Si viene, la
   * cabecera de los fragmentos guardados se refresca (ver saltarSiNoCambio).
   */
  fragmentos?: readonly Pick<FragmentoAGuardar, 'orden' | 'texto' | 'tokens'>[];
};

/**
 * Cuando el cuerpo de un fragmento es igual y solo cambia su primera linea (la
 * cabecera `[Empresa / Cliente / Proyecto] Junta ...`, que fragmentar.ts antepone
 * al cuerpo). Compara desde el primer salto de linea: si el cuerpo difiere (otro
 * corte de fragmentos, otro algoritmo) no se toca, porque su embedding ya no
 * correspondería al texto nuevo. Con strpos = 0 (sin salto) compara el texto
 * entero, que por ser distinto nunca coincide.
 */
const MISMO_CUERPO = `substr(f.texto, strpos(f.texto, chr(10)))
                       = substr(u.texto, strpos(u.texto, chr(10)))`;

/**
 * Columnas del estado guardado de un documento y si algun fragmento suyo no
 * coincide con lo que trae la ingesta. `i` es el primer parametro de la clase:
 * sensibilidad, proyecto, empresa y cliente, en ese orden (ver claseDe); le
 * siguen el orden y el texto de los fragmentos nuevos (ver textosDe).
 */
function columnasDeEstado(i: number): string {
  return `d.id, d.huella, d.modelo_emb, d.ruta, d.drive_url,
            d.drive_modificado_en, d.sensibilidad, d.proyecto, d.empresa,
            d.cliente,
            EXISTS (
              SELECT 1
                FROM rag_fragmentos f
               WHERE f.documento_id = d.id
                 AND (f.sensibilidad IS DISTINCT FROM $${i}::text
                      OR f.proyecto IS DISTINCT FROM $${i + 1}::text
                      OR f.empresa IS DISTINCT FROM $${i + 2}::text
                      OR f.cliente IS DISTINCT FROM $${i + 3}::text)
            ) AS fragmentos_desalineados,
            EXISTS (
              SELECT 1
                FROM rag_fragmentos f
                JOIN unnest($${i + 4}::int[], $${i + 5}::text[])
                       AS u(orden, texto) ON u.orden = f.orden
               WHERE f.documento_id = d.id
                 AND f.texto IS DISTINCT FROM u.texto
                 AND ${MISMO_CUERPO}
            ) AS cabecera_desalineada`;
}

function claseDe(doc: DatosDeSalto): unknown[] {
  return [
    doc.sensibilidad,
    doc.proyecto ?? null,
    doc.empresa,
    doc.cliente ?? null
  ];
}

/** Orden y texto de los fragmentos nuevos, o nada si la ingesta no los trae. */
function textosDe(doc: DatosDeSalto): unknown[] {
  const fragmentos = doc.fragmentos ?? [];
  return [fragmentos.map((f) => f.orden), fragmentos.map((f) => f.texto)];
}

/** Que hay que escribir para que la fila guardada coincida con la ingesta. */
function diferencias(
  fila: FilaDocumento,
  doc: DatosDeSalto
): { ubicacion: boolean; clase: boolean; cabecera: boolean } {
  const ruta = texto(fila.ruta);
  const url = texto(fila.drive_url);
  const modificado = instante(fila.drive_modificado_en);
  const rutaCambia = doc.ruta !== undefined && (ruta ?? '') !== doc.ruta;
  const urlCambia = doc.driveUrl !== undefined && (url ?? '') !== doc.driveUrl;
  const tiempoCambia =
    doc.modificadoEn !== undefined &&
    !mismoInstante(modificado, doc.modificadoEn);
  return {
    ubicacion: rutaCambia || urlCambia || tiempoCambia,
    cabecera: fila.cabecera_desalineada === true,
    clase:
      fila.sensibilidad !== doc.sensibilidad ||
      (texto(fila.proyecto) ?? null) !== (doc.proyecto ?? null) ||
      fila.empresa !== doc.empresa ||
      (texto(fila.cliente) ?? null) !== (doc.cliente ?? null) ||
      fila.fragmentos_desalineados === true
  };
}

/**
 * Si la huella y el modelo siguen igual, no hay que volver a embeber.
 * Actualiza ruta y liga cuando el archivo se movio en Drive. No toca el CRM.
 *
 * Aunque el contenido no cambie, la sensibilidad, el proyecto, la empresa y el
 * cliente se vuelven a calcular de la ruta y el texto (con la misma
 * precedencia de la ingesta: manda la ruta y el frontmatter solo llena lo que
 * la ruta no da): si difieren de
 * lo guardado (o algun fragmento no coincide con su documento), se corrigen en
 * el documento y en TODOS sus fragmentos, en una sola transaccion y sin pedir
 * embeddings. Asi un documento movido de carpeta o de empresa, o uno indexado
 * antes de que existieran esas columnas o con una regla anterior, se realinea
 * al volver a correr `npm run rag:backfill`; la reconciliacion diaria solo
 * vuelve a mandar los archivos movidos o editados.
 *
 * Si la ingesta trae el texto nuevo de los fragmentos (`fragmentos`), tambien se
 * refresca su cabecera (`[Empresa / Cliente / Proyecto] ...`), que repite esos
 * nombres: solo en los fragmentos cuyo cuerpo es identico, reescribiendo
 * `texto` y `tokens` (el `tsv` se regenera) y sin tocar el embedding, que se
 * calculo con la cabecera anterior. Asi el nombre de la empresa o del cliente
 * anterior no se lee ni se encuentra por texto en el nuevo lugar.
 *
 * Devuelve `undefined` cuando hay que ingerir completo: el documento no
 * existe, cambio su huella o su modelo, o otra ingesta lo reemplazo mientras
 * se decidia (en ese caso no se escribe nada).
 */
export async function saltarSiNoCambio(
  sql: Sql,
  doc: DatosDeSalto
): Promise<ResultadoGuardado | undefined> {
  const previos = await sql.ejecutar(
    `SELECT ${columnasDeEstado(3)}
       FROM rag_documentos d
      WHERE d.drive_file_id = $1 OR d.id = $2
      LIMIT 1`,
    [doc.driveFileId, doc.id, ...claseDe(doc), ...textosDe(doc)]
  );
  const previo = previos[0] as FilaDocumento | undefined;
  if (
    previo &&
    previo.huella === doc.huella &&
    previo.modelo_emb === doc.modeloEmb
  ) {
    const id = String(previo.id);
    const previas = diferencias(previo, doc);
    if (previas.ubicacion || previas.clase || previas.cabecera) {
      // La lectura de arriba corrio fuera de la transaccion y solo decide si
      // vale la pena abrirla: otra ingesta pudo reemplazar el documento, o
      // moverlo, desde entonces. Se vuelve a tomar la fila con su candado y con
      // la misma huella y modelo; si ya no es esa, no se toca nada (ni el
      // documento ni los fragmentos del nuevo) y se sigue con la ingesta
      // completa, para que contenido y clase salgan del mismo envio. Con la
      // fila bloqueada, un reemplazo concurrente espera, y lo que hay que
      // escribir se decide AQUI, contra la fila ya bloqueada: ruta, empresa,
      // cliente, proyecto y sensibilidad salen siempre del mismo envio, nunca
      // mezclados con los de otra ingesta que termino entre la lectura y el
      // candado.
      const vigente = await sql.transaccion(async (ejecutar) => {
        const filas = await ejecutar(
          `SELECT ${columnasDeEstado(4)}
             FROM rag_documentos d
            WHERE d.id = $1 AND d.huella = $2 AND d.modelo_emb = $3
              FOR UPDATE OF d`,
          [id, doc.huella, doc.modeloEmb, ...claseDe(doc), ...textosDe(doc)]
        );
        const bloqueada = filas[0] as FilaDocumento | undefined;
        if (!bloqueada) {
          return false;
        }
        const { ubicacion, clase } = diferencias(bloqueada, doc);
        if (ubicacion) {
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
        if (clase) {
          await ejecutar(
            `UPDATE rag_documentos
                SET sensibilidad = $2,
                    proyecto = $3,
                    empresa = $4,
                    cliente = $5,
                    actualizado_en = now()
              WHERE id = $1`,
            [id, ...claseDe(doc)]
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
            [id, ...claseDe(doc)]
          );
        }
        if (doc.fragmentos) {
          // Se corre siempre que se llega aqui, no segun la lectura de arriba
          // (ni la del candado, que ve la instantanea anterior a la espera):
          // la guarda del WHERE deja la sentencia en nada si ya esta al dia.
          // Reescribe `texto` (y con el `tsv` generado) y `tokens`; el embedding
          // se queda con el de la cabecera anterior.
          await ejecutar(
            `UPDATE rag_fragmentos f
                SET texto = u.texto,
                    tokens = u.tokens
               FROM unnest($2::int[], $3::text[], $4::int[])
                      AS u(orden, texto, tokens)
              WHERE f.documento_id = $1
                AND f.orden = u.orden
                AND f.texto IS DISTINCT FROM u.texto
                AND ${MISMO_CUERPO}`,
            [
              id,
              doc.fragmentos.map((f) => f.orden),
              doc.fragmentos.map((f) => f.texto),
              doc.fragmentos.map((f) => f.tokens)
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
