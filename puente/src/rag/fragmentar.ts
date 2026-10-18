import { createHash } from 'node:crypto';
import { normalizarTexto } from '../proveedores/fireflies.js';
import { CARPETAS_COSTOS, CARPETAS_GENERALES } from './clasificar.js';
import {
  empresaDeRuta,
  empresaIdDe,
  segmentosBajoEmpresas,
  type EmpresaCatalogo
} from './empresas-rag.js';

/** Tope de un trozo de transcripcion y cuanto se repite del anterior. */
export const TOKENS_FRAGMENTO = 500;
export const TOKENS_TRASLAPE = 80;

const ZONA = 'America/Mexico_City';
const MESES = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic'
];

const SECCIONES_ENTERAS = new Set(['resumen', 'acuerdos', 'pendientes']);

/**
 * Carpetas de etapa de un proyecto en Drive, normalizadas. Lo que cuelga
 * antes de la primera de ellas es el contexto (empresa, cliente, proyecto).
 */
const CARPETAS_DE_ETAPA = new Set([...CARPETAS_GENERALES, ...CARPETAS_COSTOS]);

/**
 * Carpetas de primer nivel bajo una empresa que no son un cliente (normalizadas
 * con normalizarTexto). Una ficha CLIENTE.md o PROYECTO_*.md que cuelga de una
 * de ellas no recibe cliente. Las que empiezan con `_` o `.`, y las numeradas
 * como `00_Brand_Kit`, tampoco (ver esCarpetaDeCliente).
 */
const CARPETAS_QUE_NO_SON_CLIENTE = new Set([
  'empresas',
  'integraciones',
  'interno',
  'facturacion',
  'brand kit',
  'brand kits',
  'brand kits clientes',
  'marca'
]);

export interface OpcionesFragmento {
  maxTokens?: number;
  traslape?: number;
}

export interface DocumentoFragmentado {
  id: string;
  titulo: string;
  /** ISO, si el markdown trae fecha. */
  fecha?: string;
  empresa: string;
  empresaNombre: string;
  /**
   * true si el frontmatter traia un `empresa:` distinto de la empresa de la
   * ruta de Drive (o que no se reconoce) y se ignoro: manda la ruta.
   */
  empresaDelFrontmatterIgnorada: boolean;
  cliente?: string;
  /**
   * true si el frontmatter traia un `cliente:` distinto del que da la ruta de
   * Drive y se ignoro: manda la ruta.
   */
  clienteDelFrontmatterIgnorado: boolean;
  proyecto?: string;
  /** Igual que `clienteDelFrontmatterIgnorado`, para `proyecto:`. */
  proyectoDelFrontmatterIgnorado: boolean;
  tipo: string;
  participantes: string[];
  frontmatter: Record<string, string>;
  huella: string;
  fragmentos: FragmentoTexto[];
}

export interface FragmentoTexto {
  orden: number;
  seccion: string;
  texto: string;
  tokens: number;
}

export interface ContextoFragmento {
  driveFileId: string;
  ruta?: string;
  catalogo?: readonly EmpresaCatalogo[];
  opciones?: OpcionesFragmento;
}

/** sha256 del markdown completo: si no cambia, no se vuelven a pedir embeddings. */
export function huellaDocumento(markdown: string): string {
  return createHash('sha256').update(markdown).digest('hex');
}

/** Estimacion barata: el modelo cobra por tokens y 4 caracteres alcanzan para cortar. */
export function estimarTokens(texto: string): number {
  const limpio = texto.trim();
  if (!limpio) {
    return 0;
  }
  return Math.max(1, Math.ceil(limpio.length / 4));
}

/**
 * Parte un markdown de junta en fragmentos listos para embeber.
 *
 * Resumen, acuerdos y pendientes van enteros. La transcripcion se corta por
 * turnos de hablante, agrupando hasta ~500 tokens con ~80 de traslape, y
 * solo se parte un turno si el solo ya no cabe.
 */
export function fragmentarMarkdown(
  markdown: string,
  ctx: ContextoFragmento
): DocumentoFragmentado {
  const texto = markdown.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const { frente, cuerpo } = separarFrente(texto);
  const catalogo = ctx.catalogo ?? [];
  // La empresa la manda la ruta de Drive (decision de Carlos, 2026-10-17): si de
  // la ruta sale una empresa conocida, el `empresa:` del frontmatter se ignora.
  // Sin ruta, o con una ruta que no resuelve a ninguna empresa, vale el
  // frontmatter. Cliente y proyecto siguen la misma regla (decision de Carlos,
  // 2026-10-18): lo que da la ruta manda y el frontmatter solo llena lo que la
  // ruta no da.
  const empresaDeCarpeta = empresaDeRuta(ctx.ruta, catalogo);
  const empresaDeFrente = empresaIdDe(frente['empresa'], catalogo);
  const empresa = empresaDeCarpeta ?? empresaDeFrente;
  if (!empresa) {
    throw new Error(
      'No reconocí la empresa de la junta (frontmatter o ruta de Drive).'
    );
  }
  const titulo =
    tituloDe(cuerpo) ||
    frente['titulo'] ||
    nombreDeArchivo(ctx.ruta) ||
    'Junta';
  const deRuta = contextoDeRuta(ctx.ruta, catalogo);
  const cliente = deRuta.cliente ?? textoONada(frente['cliente']);
  const proyecto = deRuta.proyecto ?? textoONada(frente['proyecto']);
  const clienteDelFrontmatterIgnorado = discrepa(
    deRuta.cliente,
    frente['cliente']
  );
  const proyectoDelFrontmatterIgnorado = discrepa(
    deRuta.proyecto,
    frente['proyecto']
  );
  const participantes = participantesDe(frente['participantes']);
  const fecha = fechaDe(frente['fecha']) ?? fechaDeNombre(ctx.ruta);
  const id = textoONada(frente['id']) ?? ctx.driveFileId;
  const empresaDelFrontmatterIgnorada =
    !!empresaDeCarpeta &&
    !!textoONada(frente['empresa']) &&
    empresaDeFrente !== empresaDeCarpeta;
  // El nombre de la cabecera sale del frontmatter solo si ese es el que vale.
  const empresaNombre =
    (empresaDeFrente === empresa ? textoONada(frente['empresa']) : undefined) ??
    catalogo.find((e) => e.id === empresa)?.nombre ??
    empresa;
  const cabecera = armarCabecera({
    empresaNombre,
    cliente,
    proyecto,
    fecha,
    participantes,
    titulo
  });
  const maxTokens = ctx.opciones?.maxTokens ?? TOKENS_FRAGMENTO;
  const traslape = ctx.opciones?.traslape ?? TOKENS_TRASLAPE;
  const secciones = seccionesDe(cuerpo);
  const piezas: { seccion: string; texto: string }[] = [];
  for (const seccion of secciones) {
    if (esMarcadorVacio(seccion.texto)) {
      continue;
    }
    const trozos = SECCIONES_ENTERAS.has(seccion.nombre)
      ? [seccion.texto.trim()]
      : agruparTurnos(turnosDe(seccion.texto), maxTokens, traslape);
    for (const trozo of trozos) {
      if (!trozo.trim() || esMarcadorVacio(trozo)) {
        continue;
      }
      piezas.push({
        seccion: seccion.nombre,
        texto: `${cabecera}\n${trozo.trim()}`
      });
    }
  }
  return {
    id,
    titulo,
    fecha,
    empresa,
    empresaNombre,
    empresaDelFrontmatterIgnorada,
    cliente,
    clienteDelFrontmatterIgnorado,
    proyecto,
    proyectoDelFrontmatterIgnorado,
    tipo: tipoDe(frente['tipo'], ctx.ruta),
    participantes,
    frontmatter: frente,
    huella: huellaDocumento(texto),
    fragmentos: piezas.map((p, orden) => ({
      orden,
      seccion: p.seccion,
      texto: p.texto,
      tokens: estimarTokens(p.texto)
    }))
  };
}

function separarFrente(markdown: string): {
  frente: Record<string, string>;
  cuerpo: string;
} {
  const normal = markdown.replace(/^\uFEFF/, '');
  if (!normal.startsWith('---')) {
    return { frente: {}, cuerpo: normal };
  }
  const fin = normal.indexOf('\n---', 3);
  if (fin < 0) {
    return { frente: {}, cuerpo: normal };
  }
  const bloque = normal.slice(3, fin).replace(/^\n/, '');
  const cuerpo = normal.slice(fin + 4).replace(/^\n/, '');
  const frente: Record<string, string> = {};
  for (const linea of bloque.split('\n')) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(linea.trim());
    if (!m) {
      continue;
    }
    const clave = m[1] ?? '';
    const valor = (m[2] ?? '').trim().replace(/^["']|["']$/g, '');
    if (clave && valor) {
      frente[clave] = valor;
    }
  }
  return { frente, cuerpo };
}

function tituloDe(cuerpo: string): string | undefined {
  for (const linea of cuerpo.split('\n')) {
    const m = /^#\s+(.+)$/.exec(linea.trim());
    if (m?.[1]) {
      return m[1].trim();
    }
  }
  return undefined;
}

function nombreDeArchivo(ruta: string | undefined): string | undefined {
  const nombre = ruta?.split(/[/\\]+/).pop();
  if (!nombre) {
    return undefined;
  }
  return nombre
    .replace(/\.md$/i, '')
    .replace(/^\d{4}-\d{2}-\d{2}[_-]?/, '')
    .replace(/[_-]+/g, ' ')
    .trim();
}

function textoONada(valor: string | undefined): string | undefined {
  const limpio = valor?.trim();
  return limpio ? limpio : undefined;
}

function participantesDe(valor: string | undefined): string[] {
  if (!valor?.trim()) {
    return [];
  }
  return valor
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Cliente y proyecto que da la ruta de Drive. Lo que no da, queda vacio. */
interface ContextoDeRuta {
  cliente?: string;
  proyecto?: string;
}

/**
 * Cliente y proyecto de un archivo segun su ruta:
 * Empresa / Cliente de facturacion / [Cliente final /] Proyecto / etapa / ...
 *
 * Solo hay contexto si la primera carpeta (tras `Empresas/`) es una empresa
 * conocida: es la misma lectura de empresaDeRuta, porque sin ella las
 * posiciones no significan cliente ni proyecto (`_Historico`, `_POR_CLASIFICAR`).
 *
 * Con carpeta de etapa (Juntas, 01_Cotizaciones, 02_Proyecto, 03_Entregables,
 * 04_Costos), el contexto son las carpetas anteriores a la primera etapa. El
 * cliente es el segundo segmento (el cliente de facturacion) y el proyecto, con
 * al menos tres, el ultimo.
 *
 * Sin carpeta de etapa no hay contexto, salvo en dos fichas que cuelgan de la
 * carpeta del cliente: CLIENTE.md (solo cliente) y PROYECTO_*.md (cliente y,
 * con al menos tres carpetas, el proyecto de la carpeta que la contiene). Con
 * una condicion: el segundo segmento tiene que poder ser un cliente (ver
 * esCarpetaDeCliente). Ningun otro archivo recibe cliente sin etapa.
 */
function contextoDeRuta(
  ruta: string | undefined,
  catalogo: readonly EmpresaCatalogo[]
): ContextoDeRuta {
  const desde = segmentosBajoEmpresas(ruta);
  const carpetas = desde.slice(0, -1);
  const empresa = carpetas[0];
  if (!empresa || !empresaIdDe(empresa, catalogo)) {
    return {};
  }
  const etapa = carpetas.findIndex((p) =>
    CARPETAS_DE_ETAPA.has(normalizarTexto(p))
  );
  if (etapa >= 0) {
    return contextoDe(carpetas.slice(0, etapa));
  }
  const archivo = (desde[desde.length - 1] ?? '').trim();
  const esFichaDeCliente = /^CLIENTE\.md$/i.test(archivo);
  const esFichaDeProyecto = /^PROYECTO_.+\.md$/i.test(archivo);
  if (
    !(esFichaDeCliente || esFichaDeProyecto) ||
    !esCarpetaDeCliente(carpetas[1])
  ) {
    return {};
  }
  const contexto = contextoDe(carpetas);
  return esFichaDeProyecto ? contexto : { cliente: contexto.cliente };
}

function contextoDe(antes: string[]): ContextoDeRuta {
  const ultimo = antes[antes.length - 1]?.trim();
  return {
    cliente: antes[1]?.trim() || undefined,
    proyecto: antes.length >= 3 && ultimo ? ultimo : undefined
  };
}

/**
 * El segmento puede ser un cliente: no esta vacio, no empieza con `_` ni `.`
 * (`_POR_CLASIFICAR`, `_Historico`, `_Interno_LimonLabs`), no es una carpeta
 * numerada de Drive (`00_Brand_Kit`, `00_Brand_Kits_Clientes`) ni una de las
 * carpetas que no son un cliente (CARPETAS_QUE_NO_SON_CLIENTE). Una carpeta que
 * no se reconoce como cliente deja el cliente vacio: peor es asignarle el de
 * otro.
 */
function esCarpetaDeCliente(nombre: string | undefined): boolean {
  const limpio = nombre?.trim();
  if (!limpio || /^[_.]|^\d{2}_/.test(limpio)) {
    return false;
  }
  return !CARPETAS_QUE_NO_SON_CLIENTE.has(normalizarTexto(limpio));
}

/** La ruta da un valor y el frontmatter trae otro distinto (comparados sin mayusculas ni acentos). */
function discrepa(
  deRuta: string | undefined,
  deFrente: string | undefined
): boolean {
  const frente = textoONada(deFrente);
  return (
    !!deRuta && !!frente && normalizarTexto(frente) !== normalizarTexto(deRuta)
  );
}

function fechaDe(valor: string | undefined): string | undefined {
  if (!valor?.trim()) {
    return undefined;
  }
  const dia = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor.trim());
  if (dia) {
    return new Date(
      Date.UTC(Number(dia[1]), Number(dia[2]) - 1, Number(dia[3]), 18, 0, 0)
    ).toISOString();
  }
  const ms = Date.parse(valor);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

function fechaDeNombre(ruta: string | undefined): string | undefined {
  const nombre = ruta?.split(/[/\\]+/).pop() ?? '';
  return fechaDe(/^(\d{4}-\d{2}-\d{2})/.exec(nombre)?.[1]);
}

function tipoDe(frente: string | undefined, ruta: string | undefined): string {
  const pedido = normalizarTexto(frente ?? '');
  if (pedido === 'interna' || pedido === 'prospecto' || pedido === 'junta') {
    return pedido;
  }
  const plano = normalizarTexto(ruta ?? '');
  if (plano.includes('prospecto')) {
    return 'prospecto';
  }
  if (plano.includes('interna')) {
    return 'interna';
  }
  return 'junta';
}

function armarCabecera(datos: {
  empresaNombre: string;
  cliente?: string;
  proyecto?: string;
  fecha?: string;
  participantes: string[];
  titulo: string;
}): string {
  const donde = [datos.empresaNombre, datos.cliente, datos.proyecto]
    .filter((x): x is string => !!x)
    .join(' / ');
  const cuando = datos.fecha ? fechaCorta(datos.fecha) : '';
  const quienes =
    datos.participantes.length > 0
      ? ` — participantes: ${datos.participantes.join(', ')}`
      : '';
  const junta = cuando ? `Junta ${cuando}` : datos.titulo;
  return donde ? `[${donde}] ${junta}${quienes}` : `${junta}${quienes}`;
}

function fechaCorta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso.slice(0, 10);
  }
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(d);
  const tomar = (tipo: string) =>
    partes.find((p) => p.type === tipo)?.value ?? '';
  const mes = MESES[Number(tomar('month')) - 1] ?? '';
  return `${tomar('day')}-${mes}-${tomar('year')}`;
}

interface Seccion {
  nombre: string;
  texto: string;
}

function seccionesDe(cuerpo: string): Seccion[] {
  const lineas = cuerpo.split('\n');
  const secciones: Seccion[] = [];
  let nombre = '';
  let buffer: string[] = [];
  const cerrar = () => {
    const texto = buffer.join('\n').trim();
    if (nombre && texto) {
      secciones.push({ nombre, texto });
    } else if (!nombre && texto && !/^#\s+/.test(texto)) {
      secciones.push({ nombre: 'transcripcion', texto });
    }
    buffer = [];
  };
  for (const linea of lineas) {
    const encabezado = /^##\s+(.+)$/.exec(linea.trim());
    if (encabezado?.[1]) {
      cerrar();
      nombre = seccionDe(encabezado[1]);
      continue;
    }
    buffer.push(linea);
  }
  cerrar();
  return secciones;
}

function seccionDe(titulo: string): string {
  const n = normalizarTexto(titulo);
  if (n.includes('resumen')) {
    return 'resumen';
  }
  if (n.includes('transcrip')) {
    return 'transcripcion';
  }
  if (n.includes('pendiente') && !n.includes('acuerdo')) {
    return 'pendientes';
  }
  if (n.includes('acuerdo')) {
    return 'acuerdos';
  }
  return n.replace(/ /g, '-').slice(0, 40) || 'otro';
}

function esMarcadorVacio(texto: string): boolean {
  const plano = normalizarTexto(texto);
  return (
    plano === '' ||
    plano === 'sin acuerdos detectados' ||
    plano === 'sin conversacion transcrita'
  );
}

interface Turno {
  hablante?: string;
  texto: string;
}

function turnosDe(texto: string): Turno[] {
  const turnos: Turno[] = [];
  for (const linea of texto.split('\n')) {
    const limpia = linea.trim();
    if (!limpia) {
      continue;
    }
    const marca = /^\*\*(.+?):\*\*\s*(.*)$/.exec(limpia);
    if (marca) {
      const hablante = (marca[1] ?? '').trim();
      const frase = (marca[2] ?? '').trim();
      const ultimo = turnos[turnos.length - 1];
      if (ultimo?.hablante === hablante) {
        ultimo.texto = [ultimo.texto, frase].filter(Boolean).join(' ');
      } else {
        turnos.push({ hablante, texto: frase });
      }
      continue;
    }
    const ultimo = turnos[turnos.length - 1];
    if (ultimo) {
      ultimo.texto = [ultimo.texto, limpia].filter(Boolean).join(' ');
    } else {
      turnos.push({ texto: limpia });
    }
  }
  return turnos.filter((t) => t.texto.trim());
}

function textoDeTurno(turno: Turno): string {
  return turno.hablante ? `**${turno.hablante}:** ${turno.texto}` : turno.texto;
}

function agruparTurnos(
  turnos: Turno[],
  maxTokens: number,
  traslape: number
): string[] {
  const piezas = turnos.flatMap((t) => partirSiNoCabe(t, maxTokens, traslape));
  const grupos: string[][] = [];
  let actual: string[] = [];
  let tokens = 0;
  for (const pieza of piezas) {
    const costo = estimarTokens(pieza);
    if (actual.length > 0 && tokens + costo > maxTokens) {
      const cola = colaDe(actual, traslape);
      grupos.push(actual);
      if (
        sumaTokens(cola) > 0 &&
        sumaTokens(cola) < sumaTokens(actual) &&
        sumaTokens(cola) + costo <= maxTokens
      ) {
        actual = [...cola];
        tokens = sumaTokens(actual);
      } else {
        actual = [];
        tokens = 0;
      }
    }
    actual.push(pieza);
    tokens += costo;
  }
  if (actual.length > 0) {
    grupos.push(actual);
  }
  return grupos.map((g) => g.join('\n'));
}

function partirSiNoCabe(
  turno: Turno,
  maxTokens: number,
  traslape: number
): string[] {
  const completo = textoDeTurno(turno);
  if (estimarTokens(completo) <= maxTokens) {
    return [completo];
  }
  const prefijo = turno.hablante ? `**${turno.hablante}:** ` : '';
  const cuerpo = turno.texto;
  const limite = Math.max(prefijo.length + 40, maxTokens * 4 - prefijo.length);
  const paso = Math.max(40, limite - traslape * 4);
  const partes: string[] = [];
  for (let i = 0; i < cuerpo.length; i += paso) {
    const fin = Math.min(cuerpo.length, i + limite);
    partes.push(`${prefijo}${cuerpo.slice(i, fin)}`.trim());
    if (fin >= cuerpo.length) {
      break;
    }
  }
  return partes;
}

function colaDe(piezas: string[], traslape: number): string[] {
  if (traslape <= 0) {
    return [];
  }
  const cola: string[] = [];
  let tokens = 0;
  for (let i = piezas.length - 1; i >= 0 && tokens < traslape; i--) {
    const pieza = piezas[i] ?? '';
    const costo = estimarTokens(pieza);
    if (cola.length === 0 && costo > traslape * 2) {
      const chars = traslape * 4;
      return [pieza.slice(-chars)];
    }
    cola.unshift(pieza);
    tokens += costo;
  }
  return cola;
}

function sumaTokens(piezas: string[]): number {
  return piezas.reduce((s, p) => s + estimarTokens(p), 0);
}
