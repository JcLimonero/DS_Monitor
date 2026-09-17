import type { Socket } from 'node:net';
import { connect } from 'node:tls';
import { ErrorProveedor } from '../nucleo/errores.js';

/**
 * Cliente IMAP minimo, solo lectura.
 *
 * Hace cuatro cosas: entrar, elegir un buzon, buscar por fecha y traer
 * encabezados o cuerpos. Con eso alcanza para deducir juntas, pendientes y
 * licencias de un buzon, y escribirlo aqui evita colgarle al puente una
 * dependencia que tendria acceso a todos los correos de la empresa.
 *
 * Nunca marca nada como leido: todo se pide con `BODY.PEEK`.
 *
 * La parte delicada del protocolo son los literales: el servidor manda
 * `{123}` al final de una linea y a continuacion 123 bytes crudos que pueden
 * contener saltos de linea. `leerRespuesta` los junta con la linea a la que
 * pertenecen para que el resto del codigo vea una "linea logica" por
 * respuesta.
 */

export interface OpcionesImap {
  host: string;
  puerto: number;
  usuario: string;
  contrasena: string;
  /** Con token de OAuth (Gmail) se entra por XOAUTH2 en vez de contraseña. */
  accessToken?: string;
  tiempoLimiteMs?: number;
  /**
   * Como abrir la conexion. Por omision TLS al host y puerto; las pruebas
   * pasan un socket plano contra un servidor falso.
   */
  abrir?: (host: string, puerto: number, alConectar: () => void) => Socket;
}

export interface EncabezadoCorreo {
  uid: number;
  /** Fecha del encabezado `Date`, en ISO. Sin fecha valida queda vacio. */
  fecha: string;
  /** Remitente tal cual viene, por ejemplo `Zoom <no-reply@zoom.us>`. */
  remitente: string;
  asunto: string;
  /** Encabezado `Content-Type` de primer nivel, en minusculas. */
  tipoContenido: string;
  /** Buzon del que salio, cuando se leen varios; los UID son por buzon. */
  buzon?: string;
}

interface Respuesta {
  estado: 'OK' | 'NO' | 'BAD';
  /** Respuestas sin etiqueta (`* ...`), cada una con sus literales dentro. */
  lineas: string[];
  texto: string;
}

const TIEMPO_LIMITE_MS = 30_000;

/** Cuantos UID pedir por FETCH; mas de esto y la respuesta se vuelve enorme. */
const LOTE = 200;

export class ClienteImap {
  private socket!: Socket;
  private buffer = Buffer.alloc(0);
  private contador = 0;
  /** Quien espera la siguiente respuesta etiquetada. */
  private pendiente?: {
    etiqueta: string;
    resolver: (respuesta: Respuesta) => void;
    rechazar: (error: Error) => void;
  };

  private constructor(private readonly opciones: OpcionesImap) {}

  static async conectar(opciones: OpcionesImap): Promise<ClienteImap> {
    const cliente = new ClienteImap(opciones);
    await cliente.abrir();
    await cliente.iniciarSesion();
    return cliente;
  }

  private abrir(): Promise<void> {
    const {
      host,
      puerto,
      tiempoLimiteMs = TIEMPO_LIMITE_MS,
      abrir = (h, p, alConectar) =>
        connect({ host: h, port: p, servername: h }, alConectar)
    } = this.opciones;
    return new Promise((resolver, rechazar) => {
      let saludado = false;
      const socket = abrir(host, puerto, () => {
        socket.setTimeout(tiempoLimiteMs);
      });
      this.socket = socket;
      socket.setEncoding('latin1');
      socket.on('data', (trozo: string) => {
        this.buffer = Buffer.concat([
          this.buffer,
          Buffer.from(trozo, 'latin1')
        ]);
        if (!saludado) {
          // El saludo es una sola linea `* OK ...` y no lleva etiqueta.
          const fin = this.buffer.indexOf('\r\n');
          if (fin === -1) {
            return;
          }
          const saludo = this.buffer.subarray(0, fin).toString('latin1');
          this.buffer = this.buffer.subarray(fin + 2);
          saludado = true;
          if (!saludo.startsWith('* OK')) {
            rechazar(this.error(`el servidor no saludo con OK: ${saludo}`));
            socket.destroy();
            return;
          }
          resolver();
          return;
        }
        this.procesar();
      });
      socket.on('timeout', () => {
        this.fallar(this.error('el servidor dejo de responder'));
        socket.destroy();
      });
      socket.on('error', (causa) => {
        const error = this.error(`fallo la conexion: ${causa.message}`, causa);
        if (!saludado) {
          rechazar(error);
        }
        this.fallar(error);
      });
      socket.on('close', () => {
        this.fallar(this.error('el servidor cerro la conexion'));
      });
    });
  }

  private async iniciarSesion(): Promise<void> {
    const { usuario, contrasena, accessToken } = this.opciones;
    const respuesta = accessToken
      ? await this.comando(
          `AUTHENTICATE XOAUTH2 ${Buffer.from(
            `user=${usuario}\x01auth=Bearer ${accessToken}\x01\x01`
          ).toString('base64')}`
        )
      : await this.comando(`LOGIN ${citar(usuario)} ${citar(contrasena)}`);
    if (respuesta.estado !== 'OK') {
      throw this.error(
        `no acepto el usuario o la contraseña (${respuesta.texto.trim()})`
      );
    }
  }

  /** Abre un buzon en modo lectura y devuelve cuantos mensajes tiene. */
  async seleccionar(buzon: string): Promise<number> {
    const respuesta = await this.comando(`EXAMINE ${citar(buzon)}`);
    if (respuesta.estado !== 'OK') {
      throw this.error(`no existe el buzon "${buzon}" (${respuesta.texto})`);
    }
    const existentes = respuesta.lineas
      .map((linea) => /^\* (\d+) EXISTS/.exec(linea))
      .find(Boolean);
    return existentes ? Number(existentes[1]) : 0;
  }

  /** UID de los mensajes recibidos desde la fecha, la mas vieja primero. */
  async buscarDesde(fecha: Date): Promise<number[]> {
    const respuesta = await this.comando(
      `UID SEARCH SINCE ${fechaImap(fecha)}`
    );
    if (respuesta.estado !== 'OK') {
      throw this.error(`fallo la busqueda (${respuesta.texto})`);
    }
    const linea = respuesta.lineas.find((l) => l.startsWith('* SEARCH'));
    if (!linea) {
      return [];
    }
    return linea
      .slice('* SEARCH'.length)
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number)
      .filter((uid) => Number.isInteger(uid) && uid > 0);
  }

  /** Encabezados basicos de una lista de UID, en lotes. */
  async encabezados(uids: number[]): Promise<EncabezadoCorreo[]> {
    const resultado: EncabezadoCorreo[] = [];
    for (let i = 0; i < uids.length; i += LOTE) {
      const lote = uids.slice(i, i + LOTE);
      const respuesta = await this.comando(
        `UID FETCH ${lote.join(',')} (UID BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE CONTENT-TYPE)])`
      );
      if (respuesta.estado !== 'OK') {
        throw this.error(`fallo al traer encabezados (${respuesta.texto})`);
      }
      for (const linea of respuesta.lineas) {
        const encabezado = interpretarEncabezado(linea);
        if (encabezado) {
          resultado.push(encabezado);
        }
      }
    }
    return resultado;
  }

  /**
   * Que UID llevan una parte `text/calendar`, segun el BODYSTRUCTURE.
   *
   * No se interpreta la estructura completa: con encontrar el tipo basta, y
   * asi no hay que escribir un analizador de S-expressions para un solo dato.
   */
  async conCalendario(uids: number[]): Promise<number[]> {
    const conIcs: number[] = [];
    for (let i = 0; i < uids.length; i += LOTE) {
      const lote = uids.slice(i, i + LOTE);
      const respuesta = await this.comando(
        `UID FETCH ${lote.join(',')} (UID BODYSTRUCTURE)`
      );
      if (respuesta.estado !== 'OK') {
        throw this.error(`fallo al traer la estructura (${respuesta.texto})`);
      }
      for (const linea of respuesta.lineas) {
        const uid = /\bUID (\d+)/.exec(linea);
        if (uid && /"TEXT" "CALENDAR"/i.test(linea)) {
          conIcs.push(Number(uid[1]));
        }
      }
    }
    return conIcs;
  }

  /**
   * El mensaje crudo (encabezados y cuerpo MIME), recortado a `maximoBytes`.
   *
   * Las invitaciones traen la parte de calendario antes de los adjuntos, asi
   * que con el principio del mensaje alcanza y no hay que bajar un PDF de
   * varios megas para leer una junta.
   */
  async mensajeCrudo(uid: number, maximoBytes = 262_144): Promise<string> {
    const respuesta = await this.comando(
      `UID FETCH ${uid} (UID BODY.PEEK[]<0.${maximoBytes}>)`
    );
    if (respuesta.estado !== 'OK') {
      throw this.error(`fallo al traer el mensaje ${uid} (${respuesta.texto})`);
    }
    const linea = respuesta.lineas.find((l) => /^\* \d+ FETCH/.test(l));
    return linea ? literalDe(linea) : '';
  }

  async cerrar(): Promise<void> {
    try {
      await this.comando('LOGOUT');
    } catch {
      // Ya se esta cerrando; si el servidor no contesta al LOGOUT da igual.
    }
    this.socket.destroy();
  }

  // --- Protocolo ---

  private comando(linea: string): Promise<Respuesta> {
    if (this.pendiente) {
      return Promise.reject(this.error('ya hay un comando en curso'));
    }
    const etiqueta = `A${String(++this.contador).padStart(3, '0')}`;
    return new Promise((resolver, rechazar) => {
      this.pendiente = { etiqueta, resolver, rechazar };
      this.socket.write(`${etiqueta} ${linea}\r\n`, 'latin1');
    });
  }

  /** Intenta armar una respuesta completa con lo que hay en el buffer. */
  private procesar(): void {
    if (!this.pendiente) {
      return;
    }
    const leida = leerRespuesta(this.buffer, this.pendiente.etiqueta);
    if (!leida) {
      return;
    }
    this.buffer = this.buffer.subarray(leida.consumidos);
    const { resolver } = this.pendiente;
    this.pendiente = undefined;
    resolver(leida.respuesta);
  }

  private fallar(error: Error): void {
    const pendiente = this.pendiente;
    this.pendiente = undefined;
    pendiente?.rechazar(error);
  }

  private error(mensaje: string, causa?: unknown): ErrorProveedor {
    return new ErrorProveedor(
      `correo ${this.opciones.usuario}`,
      mensaje,
      502,
      causa
    );
  }
}

/**
 * Lee del buffer hasta la respuesta etiquetada, respetando los literales.
 *
 * Devuelve `undefined` si todavia no llego completa. Se exporta para probarla
 * sin abrir un socket.
 */
export function leerRespuesta(
  buffer: Buffer,
  etiqueta: string
): { respuesta: Respuesta; consumidos: number } | undefined {
  const lineas: string[] = [];
  let posicion = 0;
  let actual = '';

  while (posicion < buffer.length) {
    const fin = buffer.indexOf('\r\n', posicion);
    if (fin === -1) {
      return undefined;
    }
    const linea = buffer.subarray(posicion, fin).toString('latin1');
    posicion = fin + 2;

    const literal = /\{(\d+)\}$/.exec(linea);
    if (literal) {
      const largo = Number(literal[1]);
      if (posicion + largo > buffer.length) {
        return undefined;
      }
      actual +=
        linea +
        '\r\n' +
        buffer.subarray(posicion, posicion + largo).toString('latin1');
      posicion += largo;
      continue;
    }

    actual += linea;
    if (actual.startsWith(`${etiqueta} `)) {
      const resto = actual.slice(etiqueta.length + 1);
      const estado = /^(OK|NO|BAD)\b/.exec(resto);
      return {
        respuesta: {
          estado: (estado?.[1] as Respuesta['estado']) ?? 'BAD',
          lineas,
          texto: resto
        },
        consumidos: posicion
      };
    }
    lineas.push(actual);
    actual = '';
  }
  return undefined;
}

/** Saca el contenido del primer literal de una linea logica. */
function literalDe(linea: string): string {
  const marca = /\{(\d+)\}\r\n/.exec(linea);
  if (!marca || marca.index === undefined) {
    return '';
  }
  const inicio = marca.index + marca[0].length;
  return linea.slice(inicio, inicio + Number(marca[1]));
}

function interpretarEncabezado(linea: string): EncabezadoCorreo | undefined {
  const uid = /\bUID (\d+)/.exec(linea);
  if (!uid || !/^\* \d+ FETCH/.test(linea)) {
    return undefined;
  }
  const campos = desdoblar(literalDe(linea));
  const fecha = new Date(campos['date'] ?? '');
  return {
    uid: Number(uid[1]),
    fecha: Number.isNaN(fecha.getTime()) ? '' : fecha.toISOString(),
    remitente: decodificarTexto(campos['from'] ?? ''),
    asunto: decodificarTexto(campos['subject'] ?? ''),
    tipoContenido: (campos['content-type'] ?? '').toLowerCase()
  };
}

/** Encabezados MIME a un objeto, juntando las lineas continuadas. */
export function desdoblar(crudo: string): Record<string, string> {
  const campos: Record<string, string> = {};
  let nombre = '';
  for (const linea of crudo.split(/\r?\n/)) {
    if (/^[ \t]/.test(linea) && nombre) {
      campos[nombre] = `${campos[nombre]} ${linea.trim()}`;
      continue;
    }
    const separador = linea.indexOf(':');
    if (separador === -1) {
      continue;
    }
    nombre = linea.slice(0, separador).trim().toLowerCase();
    campos[nombre] = linea.slice(separador + 1).trim();
  }
  return campos;
}

/**
 * Traduce un encabezado a texto legible.
 *
 * Los asuntos con acentos llegan como palabras codificadas (RFC 2047):
 * `=?UTF-8?B?...?=` o `=?UTF-8?Q?...?=`. Lo que no viene codificado se toma
 * como UTF-8 crudo, que es lo que mandan los clientes que no cumplen la norma.
 */
export function decodificarTexto(valor: string): string {
  // Dos palabras codificadas seguidas van separadas por espacio que no cuenta.
  const sinEspaciosEntrePalabras = valor.replace(/\?=\s+=\?/g, '?==?');
  const conPalabras = sinEspaciosEntrePalabras.replace(
    /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g,
    (_, juego: string, modo: string, datos: string) => {
      const bytes =
        modo.toUpperCase() === 'B'
          ? Buffer.from(datos, 'base64')
          : Buffer.from(
              datos
                .replace(/_/g, ' ')
                .replace(/=([0-9A-Fa-f]{2})/g, (__, hex) =>
                  String.fromCharCode(parseInt(hex, 16))
                ),
              'latin1'
            );
      return decodificarBytes(bytes, juego);
    }
  );
  return decodificarBytes(Buffer.from(conPalabras, 'latin1'), 'utf-8')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodificarBytes(bytes: Buffer, juego: string): string {
  const normalizado = juego.toLowerCase().replace(/\*.*$/, '');
  try {
    return new TextDecoder(normalizado === 'utf8' ? 'utf-8' : normalizado, {
      fatal: normalizado.startsWith('utf')
    }).decode(bytes);
  } catch {
    return bytes.toString('latin1');
  }
}

/** Fecha en el formato que pide SEARCH: `16-Sep-2026`. */
export function fechaImap(fecha: Date): string {
  const meses = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec'
  ];
  return `${fecha.getUTCDate()}-${meses[fecha.getUTCMonth()]}-${fecha.getUTCFullYear()}`;
}

function citar(valor: string): string {
  return `"${valor.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
}
