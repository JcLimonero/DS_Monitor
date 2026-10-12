import { createHash } from 'node:crypto';
import { leerAcuerdos } from '../ia/juntas-fireflies.js';
import { contenidoCompleto } from '../llamadas/archivar.js';
import type { Transcripcion } from '../proveedores/fireflies.js';
import { normalizarTexto } from '../proveedores/fireflies.js';

const ZONA = 'America/Mexico_City';

export interface MetaMarkdown {
  cliente: string;
  proyecto: string;
  empresa?: string;
}

/** `2026-10-12_revision_del_portal.md`, fecha en hora de Mexico. */
export function nombreMarkdown(
  t: Pick<Transcripcion, 'titulo' | 'fecha'>
): string {
  const titulo =
    normalizarTexto(t.titulo).replace(/ +/g, '_').slice(0, 80) || 'junta';
  const d = new Date(t.fecha);
  if (Number.isNaN(d.getTime())) {
    return `sin-fecha_${titulo}.md`;
  }
  const dia = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
  return `${dia}_${titulo}.md`;
}

function unaLinea(valor: string | undefined): string {
  return (valor ?? '')
    .replace(/[\r\n|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fechaCorta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return 'sin fecha';
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
}

/**
 * Markdown para el RAG: metadatos, resumen, acuerdos con responsable y la
 * conversacion frase por frase.
 */
export function markdownDeJunta(t: Transcripcion, meta: MetaMarkdown): string {
  const acuerdos = leerAcuerdos(t.acuerdos ?? '', []);
  const frente = [
    `id: ${unaLinea(t.id)}`,
    `fecha: ${fechaCorta(t.fecha)}`,
    `participantes: ${t.participantes.map(unaLinea).filter(Boolean).join(', ')}`,
    `cliente: ${unaLinea(meta.cliente)}`,
    `proyecto: ${unaLinea(meta.proyecto)}`,
    meta.empresa ? `empresa: ${unaLinea(meta.empresa)}` : undefined,
    t.url ? `fireflies: ${unaLinea(t.url)}` : undefined
  ].filter((l): l is string => !!l);
  const lineas: string[] = [
    '---',
    ...frente,
    '---',
    '',
    `# ${unaLinea(t.titulo) || 'Junta'}`,
    ''
  ];
  if (t.resumen?.trim()) {
    lineas.push('## Resumen', '', t.resumen.trim(), '');
  }
  lineas.push('## Acuerdos', '');
  if (acuerdos.length > 0) {
    for (const a of acuerdos) {
      const quien = a.responsable ? ` (${a.responsable})` : '';
      lineas.push(`- ${a.titulo}${quien}`);
    }
    lineas.push('');
  } else if (t.acuerdos?.trim()) {
    lineas.push(t.acuerdos.trim(), '');
  } else {
    lineas.push('_Sin acuerdos detectados._', '');
  }
  lineas.push('## Transcripción', '');
  const frases = t.frases ?? [];
  if (frases.length === 0) {
    lineas.push('_Sin conversación transcrita._');
  }
  for (const f of frases) {
    const texto = f.texto.replace(/\s*\n\s*/g, ' ').trim();
    if (!texto) {
      continue;
    }
    const quien = f.hablante?.trim();
    lineas.push(quien ? `**${quien}:** ${texto}` : texto);
  }
  return `${lineas.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

export function huellaMarkdown(texto: string): string {
  return createHash('sha256').update(texto).digest('hex').slice(0, 20);
}

export interface EntradaIndice {
  id: string;
  fecha: string;
  cliente: string;
  proyecto: string;
  titulo: string;
  url: string;
}

/** Una linea estable por id de Fireflies, para reemplazarla si la junta cambia. */
export function lineaDeIndice(e: EntradaIndice): string {
  const titulo = unaLinea(e.titulo) || 'Junta';
  const url = e.url.trim();
  const liga = url ? `[${titulo}](${url})` : titulo;
  return `- ${fechaCorta(e.fecha)} | ${unaLinea(e.cliente)} | ${unaLinea(e.proyecto)} | ${liga} | fireflies:${e.id}`;
}

/**
 * Inserta o reemplaza la entrada de esa junta. Si el texto esta vacio, arma
 * un indice minimo.
 */
export function upsertIndice(actual: string, entrada: EntradaIndice): string {
  const marca = `<!-- ff:${entrada.id} -->`;
  const bloque = `${marca}\n${lineaDeIndice(entrada)}`;
  const re = new RegExp(
    `<!-- ff:${entrada.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} -->\\n.*(?:\\n|$)`
  );
  if (re.test(actual)) {
    return actual.replace(re, `${bloque}\n`);
  }
  const base = actual.trim()
    ? actual.replace(/\s*$/, '\n')
    : '# Índice RAG\n\n## Juntas\n\n';
  if (!base.includes('## Juntas')) {
    return `${base}\n## Juntas\n\n${bloque}\n`;
  }
  return `${base}${bloque}\n`;
}

/** El archivo descargado trae el final del Markdown que se subio. */
export function markdownConfirmado(
  subido: string,
  descargado: string
): boolean {
  return contenidoCompleto(subido, descargado);
}
