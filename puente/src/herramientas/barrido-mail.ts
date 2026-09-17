import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  descripcionDeCorreo,
  detectarLicenciasConEvidencia,
  detectarPendientesConEvidencia,
  montoDelRecibo
} from '../proveedores/correo.js';
import type { EncabezadoCorreo } from '../proveedores/imap.js';
import type { LicenseUsage, TaskItem } from '../nucleo/contrato.js';

/**
 * Barrido de Mail.app (macOS) hacia el puente.
 *
 * Los buzones de Microsoft no se pueden leer por IMAP con contraseña, y el
 * adaptador OAuth todavía no existe. Pero en la Mac ya están todos abiertos en
 * Mail.app, así que esta herramienta les pide a Mail los encabezados por
 * AppleScript, corre las mismas reglas que el puente usa con IMAP, y manda el
 * resultado por ingesta (`POST /ingesta/licencias` y `/ingesta/pendientes`).
 *
 * Uso:
 *
 *   node dist/herramientas/barrido-mail.js \
 *     --cuenta "JCLN Nexus|Bandeja de entrada|correo-nexus" \
 *     --cuenta "JCLN GMAIL|[Gmail]/Todos|correo-gmail" \
 *     --dias 400 \
 *     [--puente http://localhost:8787]
 *
 * Sin `--puente` imprime el resultado en JSON y no manda nada. Con `--puente`,
 * cada cuenta necesita su token de ingesta en `INGESTA_TOKEN_<ID>` (el id en
 * mayúsculas con guion bajo), que a su vez debe estar en `INGESTA_CLIENTES`
 * del puente con tipos `licencias,pendientes` y la cuenta correspondiente.
 *
 * Solo corre en macOS con Mail.app configurado. Nunca modifica el correo.
 */

const ejecutar = promisify(execFile);

interface CuentaBarrido {
  /** Nombre de la cuenta tal cual aparece en Mail.app. */
  cuentaMail: string;
  /** Ruta del buzón; `[Gmail]/Todos` para los buzones anidados. */
  buzon: string;
  /** Cuenta del portal con la que se marcan los datos. */
  accountId: string;
}

interface Argumentos {
  cuentas: CuentaBarrido[];
  dias: number;
  puente?: string;
}

function leerArgumentos(argv: string[]): Argumentos {
  const cuentas: CuentaBarrido[] = [];
  let dias = 400;
  let puente: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const valor = argv[i + 1];
    if (arg === '--cuenta' && valor) {
      const [cuentaMail, buzon, accountId] = valor
        .split('|')
        .map((p) => p.trim());
      if (!cuentaMail || !buzon || !accountId) {
        throw new Error(
          `--cuenta espera "Cuenta Mail|Buzón|id-portal", recibió "${valor}"`
        );
      }
      cuentas.push({ cuentaMail, buzon, accountId });
      i++;
    } else if (arg === '--dias' && valor) {
      dias = Number(valor) || dias;
      i++;
    } else if (arg === '--puente' && valor) {
      puente = valor.replace(/\/+$/, '');
      i++;
    }
  }
  if (cuentas.length === 0) {
    throw new Error('Falta al menos un --cuenta "Cuenta Mail|Buzón|id-portal"');
  }
  return { cuentas, dias, puente };
}

/**
 * AppleScript que devuelve los encabezados como líneas `fecha<TAB>remitente<TAB>asunto`.
 *
 * Pide las tres propiedades como listas completas y no mensaje por mensaje:
 * cada acceso a una propiedad es un evento de Apple y con miles de mensajes
 * la diferencia es de minutos a segundos. El filtro `whose` se repite en cada
 * una a propósito: Mail solo acepta pedir una propiedad de toda la lista
 * cuando la lista es una referencia, no una variable ya resuelta.
 */
const SCRIPT = `
on run argv
  set cuenta to item 1 of argv
  set ruta to item 2 of argv
  set dias to (item 3 of argv) as integer
  set limite to (current date) - dias * days
  set AppleScript's text item delimiters to "/"
  set partes to text items of ruta
  set AppleScript's text item delimiters to ""
  -- Un buzon de decenas de miles de mensajes tarda mas que los dos minutos
  -- que AppleScript espera por omision.
  with timeout of 3600 seconds
    tell application "Mail"
      set mb to mailbox (item 1 of partes) of account cuenta
      repeat with i from 2 to count of partes
        set mb to mailbox (item i of partes) of mb
      end repeat
      set ids to id of (messages of mb whose date received > limite)
      set fechas to date received of (messages of mb whose date received > limite)
      set remitentes to sender of (messages of mb whose date received > limite)
      set asuntos to subject of (messages of mb whose date received > limite)
    end tell
  end timeout
  set salida to ""
  repeat with i from 1 to count of fechas
    set f to item i of fechas
    set salida to salida & (item i of ids) & tab & (f as «class isot» as string) & tab & (item i of remitentes) & tab & (item i of asuntos) & linefeed
  end repeat
  return salida
end run
`;

/** El texto de un mensaje concreto, por su id de Mail. */
const SCRIPT_CUERPO = `
on run argv
  set cuenta to item 1 of argv
  set ruta to item 2 of argv
  set idMensaje to (item 3 of argv) as integer
  set AppleScript's text item delimiters to "/"
  set partes to text items of ruta
  set AppleScript's text item delimiters to ""
  with timeout of 300 seconds
    tell application "Mail"
      set mb to mailbox (item 1 of partes) of account cuenta
      repeat with i from 2 to count of partes
        set mb to mailbox (item i of partes) of mb
      end repeat
      set m to first message of mb whose id is idMensaje
      set cuerpo to content of m
      if (length of cuerpo) > 20000 then set cuerpo to text 1 thru 20000 of cuerpo
      set paraQuien to ""
      repeat with r in to recipients of m
        set paraQuien to paraQuien & (address of r) & ", "
      end repeat
      set conCopia to ""
      repeat with r in cc recipients of m
        set conCopia to conCopia & (address of r) & ", "
      end repeat
      return paraQuien & linefeed & conCopia & linefeed & cuerpo
    end tell
  end timeout
end run
`;

async function encabezadosDeMail(
  cuenta: CuentaBarrido,
  dias: number
): Promise<EncabezadoCorreo[]> {
  let stdout: string;
  try {
    ({ stdout } = await ejecutar(
      'osascript',
      ['-e', SCRIPT, cuenta.cuentaMail, cuenta.buzon, String(dias)],
      { maxBuffer: 256 * 1024 * 1024 }
    ));
  } catch (error) {
    // El error de AppleScript repite el guion completo y la lista de
    // mensajes; con la ultima linea alcanza para saber que paso.
    const texto = error instanceof Error ? error.message : String(error);
    const ultima = texto.trim().split('\n').pop() ?? texto;
    throw new Error(
      `Mail.app no pudo leer "${cuenta.cuentaMail} / ${cuenta.buzon}": ${ultima.slice(0, 300)}`
    );
  }
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((linea, indice) => {
      const [id = '', fecha = '', remitente = '', asunto = ''] =
        linea.split('\t');
      const instante = new Date(fecha);
      return {
        uid: Number(id) || indice + 1,
        fecha: Number.isNaN(instante.getTime()) ? '' : instante.toISOString(),
        remitente,
        asunto,
        tipoContenido: ''
      };
    });
}

/** Destinatarios y texto de un mensaje concreto, por su id de Mail. */
async function mensajeDeMail(
  cuenta: CuentaBarrido,
  idMensaje: number
): Promise<{ para: string; cc: string; cuerpo: string }> {
  try {
    const { stdout } = await ejecutar(
      'osascript',
      ['-e', SCRIPT_CUERPO, cuenta.cuentaMail, cuenta.buzon, String(idMensaje)],
      { maxBuffer: 4 * 1024 * 1024 }
    );
    const [para = '', cc = '', ...resto] = stdout.split('\n');
    return {
      para: para.replace(/, $/, ''),
      cc: cc.replace(/, $/, ''),
      cuerpo: resto.join('\n')
    };
  } catch {
    // Sin cuerpo no hay importe ni detalle; el portal deja capturarlos.
    return { para: '', cc: '', cuerpo: '' };
  }
}

async function cuerpoDeMail(
  cuenta: CuentaBarrido,
  idMensaje: number
): Promise<string> {
  return (await mensajeDeMail(cuenta, idMensaje)).cuerpo;
}

/** El modelo del portal, de vuelta al cuerpo que acepta la ingesta. */
function licenciaEntrante(l: LicenseUsage) {
  return {
    id: l.id,
    producto: l.product,
    proveedor: l.provider,
    plan: l.plan,
    unidad: l.unit,
    usado: l.used,
    periodoInicio: l.periodStart,
    periodoFin: l.periodEnd,
    costo: l.cost,
    moneda: l.currency,
    renuevaEn: l.renewsAt,
    capturadoAMano: false,
    url: l.url
  };
}

function pendienteEntrante(t: TaskItem) {
  return {
    id: t.id,
    titulo: t.title,
    descripcion: t.description,
    estado: t.status,
    prioridad: t.priority,
    origen: 'correo',
    venceEn: t.dueDate,
    proyecto: t.project,
    etiquetas: t.tags,
    actualizadoEn: t.updatedAt
  };
}

async function enviar(
  puente: string,
  tipo: 'licencias' | 'pendientes',
  token: string,
  datos: unknown[],
  ahora: Date
): Promise<string> {
  const respuesta = await fetch(`${puente}/ingesta/${tipo}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      version: 1,
      modo: 'reemplazar',
      generadoEn: ahora.toISOString(),
      datos
    })
  });
  const cuerpo = await respuesta.text();
  if (!respuesta.ok) {
    // Un 502 del proxy llega como una pagina HTML entera; con el inicio basta.
    throw new Error(
      `${tipo}: el puente respondió ${respuesta.status} · ${cuerpo.replace(/\s+/g, ' ').slice(0, 160)}`
    );
  }
  return cuerpo;
}

function variableToken(accountId: string): string {
  return `INGESTA_TOKEN_${accountId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

async function principal(): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('El barrido de Mail.app solo corre en macOS.');
  }
  const { cuentas, dias, puente } = leerArgumentos(process.argv.slice(2));
  const ahora = new Date();
  const resultado: Record<
    string,
    { leidos: number; licencias: LicenseUsage[]; pendientes: TaskItem[] }
  > = {};

  let fallidas = 0;
  for (const cuenta of cuentas) {
    process.stderr.write(`[barrido] ${cuenta.cuentaMail} / ${cuenta.buzon} … `);
    let encabezados: EncabezadoCorreo[];
    try {
      encabezados = await encabezadosDeMail(cuenta, dias);
    } catch (error) {
      // Un buzon que falla no debe dejar sin datos a los demas.
      fallidas++;
      process.stderr.write(
        `\n[barrido]   ${error instanceof Error ? error.message : String(error)}\n`
      );
      continue;
    }
    const evidencias = detectarLicenciasConEvidencia(
      encabezados,
      cuenta.accountId,
      ahora
    );
    // El importe se lee del ultimo recibo de cada licencia: son pocos
    // mensajes, uno por suscripcion, y Mail los da por su id.
    for (const evidencia of evidencias) {
      const monto = montoDelRecibo(
        await cuerpoDeMail(cuenta, evidencia.ultimo.uid),
        evidencia.ultimo.remitente,
        evidencia.moneda
      );
      if (monto) {
        evidencia.licencia.cost = monto.costo;
        evidencia.licencia.currency = monto.moneda;
        // La unidad es dinero: lo consumido del periodo es lo que se cobro.
        evidencia.licencia.used = monto.costo;
      }
    }
    const licencias = evidencias.map((e) => e.licencia);
    // Los pendientes llevan el correo completo: quien lo mando, a quien y
    // el texto.
    const detectados = detectarPendientesConEvidencia(
      encabezados,
      cuenta.accountId,
      ahora
    );
    for (const p of detectados) {
      const mensaje = await mensajeDeMail(cuenta, p.encabezado.uid);
      p.tarea.description = descripcionDeCorreo(
        { ...p.encabezado, para: mensaje.para || undefined, cc: mensaje.cc || undefined },
        mensaje.cuerpo
      );
    }
    const pendientes = detectados.map((p) => p.tarea);
    resultado[cuenta.accountId] = {
      leidos: encabezados.length,
      licencias,
      pendientes
    };
    process.stderr.write(
      `${encabezados.length} correos, ${licencias.length} licencias, ${pendientes.length} pendientes\n`
    );

    if (!puente) {
      continue;
    }
    const token = process.env[variableToken(cuenta.accountId)];
    if (!token) {
      process.stderr.write(
        `[barrido]   sin ${variableToken(cuenta.accountId)}: no se manda ${cuenta.accountId}\n`
      );
      continue;
    }
    const l = await enviar(
      puente,
      'licencias',
      token,
      licencias.map(licenciaEntrante),
      ahora
    );
    const p = await enviar(
      puente,
      'pendientes',
      token,
      pendientes.map(pendienteEntrante),
      ahora
    );
    process.stderr.write(
      `[barrido]   enviado: licencias ${l} · pendientes ${p}\n`
    );
  }

  if (!puente) {
    process.stdout.write(JSON.stringify(resultado, null, 2) + '\n');
  }
  if (fallidas > 0) {
    process.exitCode = 1;
  }
}

principal().catch((error: unknown) => {
  process.stderr.write(
    `[barrido] ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
});
