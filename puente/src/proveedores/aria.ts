import type { Meeting } from '../nucleo/contrato.js';
import type { EncabezadoCorreo } from './imap.js';
import type { NuevaJunta } from './microsoft.js';
import { sinEtiquetas } from './mime.js';

/**
 * Correos de ARIA (plataforma de citas de iTechDev):
 * «Nueva consulta agendada» → junta en el calendario itech.
 */

export interface ConsultaAria {
  nombre: string;
  empresa: string;
  correo?: string;
  telefono?: string;
  /** ISO UTC del inicio. */
  inicio: string;
  /** ISO UTC del fin. */
  fin: string;
  zona: string;
  tema?: string;
  teamsUrl?: string;
  citaUrl?: string;
  respuestas: Record<string, string>;
  /** Id del mensaje Graph, si se conoce (para dedupe / traza). */
  messageId?: string;
}

const ASUNTO_ARIA = /nueva\s+consulta\s+agendada/i;
const REMITENTE_ARIA =
  /\baria\b|meet\.itechdev|plataforma.*itech|itechdev\.com\.mx/i;

const MESES: Record<string, number> = {
  ene: 1,
  enero: 1,
  feb: 2,
  febrero: 2,
  mar: 3,
  marzo: 3,
  abr: 4,
  abril: 4,
  may: 5,
  mayo: 5,
  jun: 6,
  junio: 6,
  jul: 7,
  julio: 7,
  ago: 8,
  agosto: 8,
  sep: 9,
  sept: 9,
  septiembre: 9,
  setiembre: 9,
  oct: 10,
  octubre: 10,
  nov: 11,
  noviembre: 11,
  dic: 12,
  diciembre: 12
};

const ETIQUETAS_DATOS = [
  'Nombre',
  'Correo',
  'Teléfono / WhatsApp',
  'Telefono / WhatsApp',
  'Teléfono',
  'Telefono',
  'Empresa',
  'Fecha y hora',
  'Zona horaria del asistente',
  'Zona horaria',
  'Tema',
  'Enlace Teams',
  'Cita en Cal'
] as const;

const ETIQUETAS_CUESTIONARIO = [
  '¿En qué podemos ayudarle?',
  'En qué podemos ayudarle?',
  '¿Cómo nos encontró?',
  'Cómo nos encontró?',
  '¿Para cuándo?',
  'Para cuándo?',
  'Presupuesto estimado',
  'Rol en la empresa',
  '¿Qué usan hoy?',
  'Qué usan hoy?'
] as const;

const TODAS_ETIQUETAS = [...ETIQUETAS_DATOS, ...ETIQUETAS_CUESTIONARIO];

/** Cuenta de correo iTechDev (calendario destino de ARIA). */
export function esCuentaItech(id: string): boolean {
  const n = id.trim().toLowerCase();
  return (
    n === 'correo-itech' || n === 'correo-itech-alterno' || n.includes('itech')
  );
}

export function esCorreoAria(asunto: string, remitente: string): boolean {
  if (ASUNTO_ARIA.test(asunto)) {
    return true;
  }
  return REMITENTE_ARIA.test(remitente) && /consulta|agendad/i.test(asunto);
}

export function parsearConsultaAria(
  asunto: string,
  textoPlano: string,
  anioReferencia = new Date().getFullYear()
): ConsultaAria | undefined {
  const texto = normalizarTexto(textoPlano);
  const campos = camposDeEtiquetas(texto);
  const nombre =
    limpio(campos['Nombre']) ||
    nombreDelAsunto(asunto) ||
    limpio(primeraLineaTitulo(texto));
  if (!nombre) {
    return undefined;
  }

  const empresa =
    limpio(campos['Empresa']) ||
    empresaDelTitulo(texto, nombre) ||
    'Sin empresa';

  const correo = correoDe(
    campos['Correo'] ?? texto.match(/[\w.+-]+@[\w.-]+\.\w+/)?.[0]
  );
  const telefono = telefonoDe(
    campos['Teléfono / WhatsApp'] ??
      campos['Telefono / WhatsApp'] ??
      campos['Teléfono'] ??
      campos['Telefono'] ??
      texto
  );

  const zona = normalizarZona(
    limpio(campos['Zona horaria del asistente'] ?? campos['Zona horaria']) ||
      'America/Monterrey'
  );

  const fechaTexto =
    limpio(campos['Fecha y hora']) || texto.match(/fecha y hora\s+(.+)/i)?.[1];
  const horario =
    parsearFechaCuerpo(fechaTexto ?? '', zona, anioReferencia) ||
    parsearFechaAsunto(asunto, zona, anioReferencia);
  if (!horario) {
    return undefined;
  }

  const teamsUrl =
    urlDe(campos['Enlace Teams']) ||
    texto.match(/https:\/\/teams\.microsoft\.com\/[^\s<>"']+/i)?.[0];
  const citaUrl =
    urlDe(campos['Cita en Cal']) ||
    texto.match(/https:\/\/meet\.itechdev\.com\.mx\/booking\/[^\s<>"']+/i)?.[0];

  const respuestas: Record<string, string> = {};
  for (const etiqueta of ETIQUETAS_CUESTIONARIO) {
    const v = limpio(campos[etiqueta]);
    if (v) {
      respuestas[etiqueta.replace(/^¿|¿$/g, '').replace(/\?$/, '?')] = v;
    }
  }

  return {
    nombre,
    empresa,
    correo,
    telefono,
    inicio: horario.inicio.toISOString(),
    fin: horario.fin.toISOString(),
    zona,
    tema: limpio(campos['Tema']),
    teamsUrl,
    citaUrl,
    respuestas
  };
}

export function resumenCliente(consulta: ConsultaAria): string {
  const lineas: string[] = [
    `Cliente: ${consulta.nombre}`,
    `Empresa: ${consulta.empresa}`
  ];
  if (consulta.correo) {
    lineas.push(`Correo: ${consulta.correo}`);
  }
  if (consulta.telefono) {
    lineas.push(`Teléfono / WhatsApp: ${consulta.telefono}`);
  }
  if (consulta.tema) {
    lineas.push(`Tema: ${consulta.tema}`);
  }
  lineas.push(`Fecha: ${consulta.inicio} → ${consulta.fin} (${consulta.zona})`);
  if (consulta.teamsUrl) {
    lineas.push(`Teams: ${consulta.teamsUrl}`);
  }
  if (consulta.citaUrl) {
    lineas.push(`Cita Cal: ${consulta.citaUrl}`);
  }
  const keys = Object.keys(consulta.respuestas);
  if (keys.length) {
    lineas.push('', 'Cuestionario:');
    for (const k of keys) {
      lineas.push(`· ${k}: ${consulta.respuestas[k]}`);
    }
  }
  lineas.push('', 'Origen: ARIA (iTechDev)');
  if (consulta.messageId) {
    lineas.push(`Message-Id: ${consulta.messageId}`);
  }
  return lineas.join('\n');
}

export function juntaDesdeAria(consulta: ConsultaAria): NuevaJunta {
  const titulo = `Consulta ARIA: ${consulta.nombre} · ${consulta.empresa}`;
  return {
    titulo: titulo.slice(0, 200),
    inicio: consulta.inicio,
    fin: consulta.fin,
    lugar: consulta.teamsUrl || 'Microsoft Teams',
    cuerpo: resumenCliente(consulta),
    invitados: consulta.correo ? [consulta.correo] : [],
    enLinea: false
  };
}

/** ¿Ya hay junta con el mismo minuto de inicio y el nombre en el título? */
export function yaAgendadaAria(
  juntas: readonly Meeting[],
  consulta: ConsultaAria
): boolean {
  const inicioMin = consulta.inicio.slice(0, 16);
  const nombre = consulta.nombre.toLowerCase();
  return juntas.some((j) => {
    if (j.start.slice(0, 16) !== inicioMin) {
      return false;
    }
    if (j.title.toLowerCase().includes(nombre)) {
      return true;
    }
    if (consulta.messageId && (j.notes ?? '').includes(consulta.messageId)) {
      return true;
    }
    return false;
  });
}

export function textoPlanoDeCuerpo(
  contenido: string,
  contentType?: string
): string {
  if (
    (contentType ?? '').toLowerCase() === 'html' ||
    /<html|<table|<div/i.test(contenido)
  ) {
    return sinEtiquetas(contenido);
  }
  return contenido;
}

/** Encabezados ARIA, más recientes primero, tope razonable. */
export function encabezadosAria(
  encabezados: readonly EncabezadoCorreo[],
  tope = 20
): EncabezadoCorreo[] {
  return encabezados
    .filter((e) => esCorreoAria(e.asunto, e.remitente))
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
    .slice(0, tope);
}

// --- helpers de parseo ---

function normalizarTexto(texto: string): string {
  return texto
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[·•]/g, '·')
    .trim();
}

function limpio(valor: string | undefined): string | undefined {
  const v = valor?.replace(/\s+/g, ' ').trim();
  return v || undefined;
}

function camposDeEtiquetas(texto: string): Record<string, string> {
  const out: Record<string, string> = {};
  const escapadas = TODAS_ETIQUETAS.map((e) =>
    e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  );
  const reEtiqueta = new RegExp(
    `(?:^|\\n)\\s*(${escapadas.join('|')})\\s*[:\\n]?\\s*`,
    'gi'
  );
  const matches = [...texto.matchAll(reEtiqueta)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const etiqueta = m[1]!;
    const inicio = (m.index ?? 0) + m[0]!.length;
    const fin = i + 1 < matches.length ? matches[i + 1]!.index! : texto.length;
    const valor = texto.slice(inicio, fin).split('\n')[0]?.trim() ?? '';
    if (valor && !out[etiqueta]) {
      out[etiqueta] = valor;
    }
  }
  return out;
}

function nombreDelAsunto(asunto: string): string | undefined {
  const m = /nueva\s+consulta\s+agendada:\s*([^·|]+)/i.exec(asunto);
  return limpio(m?.[1]);
}

function primeraLineaTitulo(texto: string): string | undefined {
  const linea = texto
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.includes('·') && !/^aviso/i.test(l));
  return limpio(linea?.split('·')[0]);
}

function empresaDelTitulo(texto: string, nombre: string): string | undefined {
  const linea = texto
    .split('\n')
    .map((l) => l.trim())
    .find(
      (l) => l.toLowerCase().includes(nombre.toLowerCase()) && l.includes('·')
    );
  if (!linea) {
    return undefined;
  }
  const partes = linea.split('·').map((p) => p.trim());
  return limpio(partes[1]);
}

function correoDe(valor: string | undefined): string | undefined {
  const m = valor?.match(/[\w.+-]+@[\w.-]+\.\w+/);
  return m?.[0]?.toLowerCase();
}

function telefonoDe(valor: string | undefined): string | undefined {
  if (!valor) {
    return undefined;
  }
  const m = valor.match(/\+?\d[\d\s-]{8,}\d/);
  return limpio(m?.[0]?.replace(/\s+/g, ''));
}

function urlDe(valor: string | undefined): string | undefined {
  const m = valor?.match(/https?:\/\/[^\s<>"']+/i);
  return m?.[0]?.replace(/[),.;]+$/, '');
}

function normalizarZona(zona: string): string {
  if (/monterrey/i.test(zona)) {
    return 'America/Monterrey';
  }
  if (/mexico|ciudad de m[eé]xico|cdmx/i.test(zona)) {
    return 'America/Mexico_City';
  }
  return zona.trim() || 'America/Monterrey';
}

/**
 * Interpreta fecha local en la zona (Monterrey ≈ Mexico_City, UTC−6 fijo
 * post-DST) y calcula el fin con la duración «· 45 min».
 */
function parsearFechaCuerpo(
  texto: string,
  zona: string,
  anioFallback: number
): { inicio: Date; fin: Date } | undefined {
  // «jueves 24 de septiembre, 12:15 p.m. … · 45 min» o sin año
  const m =
    /(\d{1,2})\s+de\s+([a-záéíóú]+)\s*(?:de\s*)?(\d{4})?[, ]+\s*(\d{1,2}):(\d{2})\s*(a\.?\s*m\.?|p\.?\s*m\.?)/i.exec(
      texto
    );
  if (!m) {
    return undefined;
  }
  const dia = Number(m[1]);
  const mes = MESES[sinAcentos(m[2]!).toLowerCase()];
  if (!mes) {
    return undefined;
  }
  const anio = m[3] ? Number(m[3]) : anioFallback;
  let hora = Number(m[4]);
  const minuto = Number(m[5]);
  const ampm = m[6]!.toLowerCase().replace(/\s|\./g, '');
  if (ampm.startsWith('p') && hora < 12) {
    hora += 12;
  }
  if (ampm.startsWith('a') && hora === 12) {
    hora = 0;
  }
  const minutos = duracionMinutos(texto) ?? 45;
  const inicio = instanteLocal(anio, mes, dia, hora, minuto, zona);
  if (!inicio) {
    return undefined;
  }
  return {
    inicio,
    fin: new Date(inicio.getTime() + minutos * 60_000)
  };
}

/** Asunto: `… · jue 24 sep · 12:15 p.m.` */
function parsearFechaAsunto(
  asunto: string,
  zona: string,
  anioFallback: number
): { inicio: Date; fin: Date } | undefined {
  const m =
    /(\d{1,2})\s+([a-z]{3,})\s*·\s*(\d{1,2}):(\d{2})\s*(a\.?\s*m\.?|p\.?\s*m\.?)/i.exec(
      asunto
    );
  if (!m) {
    return undefined;
  }
  const dia = Number(m[1]);
  const mes = MESES[sinAcentos(m[2]!).toLowerCase()];
  if (!mes) {
    return undefined;
  }
  let hora = Number(m[3]);
  const minuto = Number(m[4]);
  const ampm = m[5]!.toLowerCase().replace(/\s|\./g, '');
  if (ampm.startsWith('p') && hora < 12) {
    hora += 12;
  }
  if (ampm.startsWith('a') && hora === 12) {
    hora = 0;
  }
  const inicio = instanteLocal(anioFallback, mes, dia, hora, minuto, zona);
  if (!inicio) {
    return undefined;
  }
  return {
    inicio,
    fin: new Date(inicio.getTime() + 45 * 60_000)
  };
}

function duracionMinutos(texto: string): number | undefined {
  const m = /·\s*(\d+)\s*min/i.exec(texto) || /\b(\d+)\s*min\b/i.exec(texto);
  return m ? Number(m[1]) : undefined;
}

/**
 * Convierte fecha/hora civil en `zona` a Instant.
 * Para America/Monterrey y America/Mexico_City se usa −06:00 (sin DST).
 */
function instanteLocal(
  anio: number,
  mes: number,
  dia: number,
  hora: number,
  minuto: number,
  zona: string
): Date | undefined {
  const y = String(anio).padStart(4, '0');
  const mo = String(mes).padStart(2, '0');
  const d = String(dia).padStart(2, '0');
  const h = String(hora).padStart(2, '0');
  const mi = String(minuto).padStart(2, '0');
  const offset =
    /Monterrey|Mexico_City/i.test(zona) || !zona
      ? '-06:00'
      : offsetDeZona(zona, `${y}-${mo}-${d}T${h}:${mi}:00`);
  const fecha = new Date(`${y}-${mo}-${d}T${h}:${mi}:00${offset}`);
  return Number.isNaN(fecha.getTime()) ? undefined : fecha;
}

function offsetDeZona(zona: string, localIsoSinZona: string): string {
  // Fallback genérico: probar −06:00 y corregir con Intl si hace falta.
  const prueba = new Date(`${localIsoSinZona}-06:00`);
  if (Number.isNaN(prueba.getTime())) {
    return '-06:00';
  }
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    timeZoneName: 'shortOffset',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(prueba);
  const tz = partes.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-6';
  const m = /GMT([+-]\d{1,2})(?::?(\d{2}))?/.exec(tz);
  if (!m) {
    return '-06:00';
  }
  const sign = m[1]!.startsWith('-') ? '-' : '+';
  const horas = Math.abs(Number(m[1])).toString().padStart(2, '0');
  const mins = (m[2] ?? '00').padStart(2, '0');
  return `${sign}${horas}:${mins}`;
}

function sinAcentos(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '');
}
