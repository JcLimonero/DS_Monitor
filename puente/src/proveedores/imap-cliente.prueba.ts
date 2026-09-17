import assert from 'node:assert/strict';
import { createServer, connect, type Server, type Socket } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { ClienteImap } from './imap.js';

/**
 * Un servidor IMAP de mentira que contesta lo justo para recorrer el flujo
 * completo: saludo, LOGIN, EXAMINE, UID SEARCH, UID FETCH con literales y
 * LOGOUT. Con esto se prueba la maquina de estados del cliente sin abrir una
 * conexion real.
 */
const ENCABEZADO_1 =
  'From: =?UTF-8?B?Wm9vbQ==?= <no-reply@zoom.us>\r\n' +
  'Subject: Payment Processed for 7038913102\r\n' +
  'Date: Tue, 25 Aug 2026 10:00:00 -0600\r\n' +
  'Content-Type: text/html; charset=UTF-8\r\n\r\n';

const ENCABEZADO_2 =
  'From: Ana <ana@ejemplo.com>\r\n' +
  'Subject: =?UTF-8?Q?Invitaci=C3=B3n:_Revisi=C3=B3n?=\r\n' +
  ' =?UTF-8?Q?_del_sprint?=\r\n' +
  'Date: Wed, 16 Sep 2026 09:00:00 +0000\r\n' +
  'Content-Type: multipart/alternative; boundary="XYZ"\r\n\r\n';

const MENSAJE_2 =
  ENCABEZADO_2 +
  '--XYZ\r\nContent-Type: text/calendar; method=REQUEST\r\n\r\n' +
  'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:e1\r\nDTSTART:20260918T160000Z\r\n' +
  'SUMMARY:Revisión del sprint\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n--XYZ--\r\n';

function literal(texto: string): string {
  return `{${Buffer.byteLength(texto, 'utf8')}}\r\n${texto}`;
}

function servidorFalso(recibidos: string[]): Server {
  return createServer((socket) => {
    socket.setEncoding('utf8');
    socket.write('* OK IMAP4rev1 de mentira\r\n');
    let resto = '';
    socket.on('data', (trozo: string) => {
      resto += trozo;
      let fin: number;
      while ((fin = resto.indexOf('\r\n')) !== -1) {
        const linea = resto.slice(0, fin);
        resto = resto.slice(fin + 2);
        recibidos.push(linea);
        socket.write(contestar(linea));
      }
    });
  });
}

function contestar(linea: string): string {
  const [etiqueta, ...resto] = linea.split(' ');
  const comando = resto.join(' ');
  if (comando.startsWith('LOGIN ')) {
    return comando.includes('"secreta"')
      ? `${etiqueta} OK LOGIN completed\r\n`
      : `${etiqueta} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`;
  }
  if (comando.startsWith('EXAMINE ')) {
    return `* 2 EXISTS\r\n* 0 RECENT\r\n${etiqueta} OK [READ-ONLY] EXAMINE completed\r\n`;
  }
  if (comando.startsWith('UID SEARCH ')) {
    return `* SEARCH 101 102\r\n${etiqueta} OK SEARCH completed\r\n`;
  }
  if (comando.includes('HEADER.FIELDS')) {
    return (
      `* 1 FETCH (UID 101 BODY[HEADER.FIELDS (FROM SUBJECT DATE CONTENT-TYPE)] ${literal(ENCABEZADO_1)})\r\n` +
      `* 2 FETCH (UID 102 BODY[HEADER.FIELDS (FROM SUBJECT DATE CONTENT-TYPE)] ${literal(ENCABEZADO_2)})\r\n` +
      `${etiqueta} OK FETCH completed\r\n`
    );
  }
  if (comando.includes('BODYSTRUCTURE')) {
    return (
      `* 1 FETCH (UID 101 BODYSTRUCTURE ("TEXT" "HTML" ("CHARSET" "UTF-8") NIL NIL "7BIT" 10 1 NIL NIL NIL))\r\n` +
      `* 2 FETCH (UID 102 BODYSTRUCTURE (("TEXT" "PLAIN" NIL NIL NIL "7BIT" 5 1 NIL NIL NIL)("TEXT" "CALENDAR" ("METHOD" "REQUEST") NIL NIL "7BIT" 90 4 NIL NIL NIL) "ALTERNATIVE" ("BOUNDARY" "XYZ") NIL NIL))\r\n` +
      `${etiqueta} OK FETCH completed\r\n`
    );
  }
  if (comando.startsWith('UID FETCH 102 (UID BODY.PEEK[]')) {
    return `* 2 FETCH (UID 102 BODY[]<0> ${literal(MENSAJE_2)})\r\n${etiqueta} OK FETCH completed\r\n`;
  }
  if (comando === 'LOGOUT') {
    return `* BYE\r\n${etiqueta} OK LOGOUT completed\r\n`;
  }
  return `${etiqueta} BAD no entiendo\r\n`;
}

describe('ClienteImap contra un servidor falso', () => {
  const recibidos: string[] = [];
  const servidor = servidorFalso(recibidos);
  let puerto = 0;

  before(async () => {
    await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo));
    const direccion = servidor.address();
    puerto = typeof direccion === 'object' && direccion ? direccion.port : 0;
  });

  after(() => servidor.close());

  const abrir = (_host: string, p: number, alConectar: () => void): Socket =>
    connect({ host: '127.0.0.1', port: p }, alConectar);

  it('recorre el flujo completo y decodifica los encabezados', async () => {
    const cliente = await ClienteImap.conectar({
      host: 'falso',
      puerto,
      usuario: 'yo@ejemplo.com',
      contrasena: 'secreta',
      abrir
    });
    assert.equal(await cliente.seleccionar('INBOX'), 2);
    const uids = await cliente.buscarDesde(new Date('2026-01-01T00:00:00Z'));
    assert.deepEqual(uids, [101, 102]);

    const encabezados = await cliente.encabezados(uids);
    assert.equal(encabezados.length, 2);
    assert.equal(encabezados[0]?.remitente, 'Zoom <no-reply@zoom.us>');
    assert.equal(encabezados[0]?.fecha, '2026-08-25T16:00:00.000Z');
    assert.equal(encabezados[1]?.asunto, 'Invitación: Revisión del sprint');
    assert.ok(
      encabezados[1]?.tipoContenido.startsWith('multipart/alternative')
    );

    assert.deepEqual(await cliente.conCalendario(uids), [102]);
    const crudo = await cliente.mensajeCrudo(102);
    assert.ok(crudo.includes('BEGIN:VCALENDAR'));
    await cliente.cerrar();

    assert.ok(recibidos.some((l) => l.includes('UID SEARCH SINCE 1-Jan-2026')));
    assert.ok(
      recibidos.every((l) => !l.includes('BODY[') || l.includes('PEEK'))
    );
  });

  it('una contraseña mala se reporta como error del proveedor', async () => {
    await assert.rejects(
      ClienteImap.conectar({
        host: 'falso',
        puerto,
        usuario: 'yo@ejemplo.com',
        contrasena: 'otra',
        abrir
      }),
      /no acepto el usuario o la contraseña/
    );
  });
});
