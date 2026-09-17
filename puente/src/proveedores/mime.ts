import { desdoblar } from './imap.js';

/**
 * Lo minimo de MIME que hace falta para leer un correo crudo.
 *
 * No es un analizador completo: separa las partes por su delimitador, lee los
 * encabezados de cada una y decodifica el cuerpo segun su
 * `Content-Transfer-Encoding`. Para sacar la invitacion de calendario o el
 * texto de un recibo alcanza, y evita traer una dependencia para leer dos
 * tipos de parte.
 */

export interface ParteMime {
  /** `Content-Type` en minusculas, por ejemplo `text/plain; charset=utf-8`. */
  tipo: string;
  /** El cuerpo ya decodificado. */
  texto: string;
}

/** Todas las partes del mensaje con su tipo, en orden. */
export function partesDe(mensaje: string): ParteMime[] {
  const partes: ParteMime[] = [];
  const trozos = mensaje.split(/\r?\n--[^\r\n]+\r?\n/);
  for (const trozo of trozos) {
    const separador = trozo.search(/\r?\n\r?\n/);
    if (separador === -1) {
      continue;
    }
    const encabezados = desdoblar(trozo.slice(0, separador));
    const tipo = (encabezados['content-type'] ?? '').toLowerCase();
    if (!tipo.startsWith('text/')) {
      continue;
    }
    const cuerpo = trozo
      .slice(separador)
      .replace(/^\r?\n\r?\n/, '')
      .replace(/\r?\n--[^\r\n]*--\s*$/, '');
    partes.push({
      tipo,
      texto: decodificarCuerpo(
        cuerpo,
        (encabezados['content-transfer-encoding'] ?? '7bit').toLowerCase()
      )
    });
  }
  return partes;
}

/** La primera parte cuyo tipo empieza con `tipo`, ya decodificada. */
export function parteDe(mensaje: string, tipo: string): string | undefined {
  return partesDe(mensaje).find((parte) => parte.tipo.startsWith(tipo))?.texto;
}

/**
 * El texto legible del mensaje: la parte `text/plain` si hay, y si no el HTML
 * sin etiquetas. Es lo que se usa para buscar el importe de un recibo.
 */
export function textoDe(mensaje: string): string {
  const plano = parteDe(mensaje, 'text/plain');
  if (plano && plano.trim()) {
    return plano;
  }
  const html = parteDe(mensaje, 'text/html');
  return html ? sinEtiquetas(html) : '';
}

/** HTML a texto plano, para buscar importes en un recibo. */
export function sinEtiquetas(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ');
}

export function decodificarCuerpo(
  cuerpo: string,
  codificacion: string
): string {
  if (codificacion === 'base64') {
    return Buffer.from(cuerpo.replace(/\s+/g, ''), 'base64').toString('utf8');
  }
  if (codificacion === 'quoted-printable') {
    const bytes = cuerpo
      .replace(/=\r?\n/g, '')
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      );
    return Buffer.from(bytes, 'latin1').toString('utf8');
  }
  return Buffer.from(cuerpo, 'latin1').toString('utf8');
}
