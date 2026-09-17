import type { ConfiguracionCorreo } from '../config/entorno.js';
import type {
  LicenseProvider,
  LicenseUsage,
  Meeting,
  TaskItem,
  TaskPriority
} from '../nucleo/contrato.js';
import { ErrorConfiguracion, ErrorPuente } from '../nucleo/errores.js';
import { variableContrasena } from '../config/entorno.js';
import { calendarioGoogle, tokenDeAccesoGoogle } from './google.js';
import { ClienteImap, type EncabezadoCorreo } from './imap.js';
import { extraerCalendario, juntasDeCalendario } from './ics.js';
import { textoDe } from './mime.js';

/**
 * Un buzon de correo como fuente de juntas, pendientes y licencias.
 *
 * No hay API que consultar: se leen los encabezados de los ultimos meses y se
 * deduce. Tres cosas salen de ahi:
 *
 * - **Licencias**: los recibos y avisos de renovacion que mandan los
 *   proveedores. Cada regla de `REGLAS_LICENCIA` reconoce a uno; lo que ningun
 *   proveedor conocido explica pero suena a suscripcion cae en la regla
 *   generica. Una suscripcion cuenta como vigente mientras su ultimo recibo no
 *   sea mas viejo que dos periodos.
 * - **Pendientes**: correos que piden hacer algo: un cobro rechazado, un
 *   dominio por vencer, un plan que vence hoy. Solo de los ultimos treinta
 *   dias, y uno por asunto.
 * - **Juntas**: invitaciones con archivo de calendario. Eso si requiere bajar
 *   el mensaje, asi que solo se hace con los que traen `text/calendar`.
 *
 * Todo es heuristico y se ajusta agregando reglas. Por eso las reglas viven en
 * tablas al principio del archivo y no repartidas en el codigo.
 */

type Periodo = 'mensual' | 'anual';

interface ReglaLicencia {
  id: string;
  producto: string;
  proveedor?: LicenseProvider;
  /** Se prueba contra el remitente completo (`Nombre <correo>`). */
  remitente: RegExp;
  /** Se prueba contra el asunto. Sin asunto, basta el remitente. */
  asunto?: RegExp;
  /**
   * Grupo de captura del asunto que distingue productos del mismo proveedor,
   * por ejemplo "Microsoft 365 Business Basic" y "Exchange Online Kiosk".
   */
  productoDesde?: number;
  periodo: Periodo;
  url?: string;
}

const REGLAS_LICENCIA: ReglaLicencia[] = [
  {
    id: 'microsoft',
    producto: 'Microsoft 365',
    remitente: /@microsoft\.com/i,
    asunto:
      /renewed your (.+?) subscription|Your (.+?) subscription is renewing soon/i,
    productoDesde: 1,
    periodo: 'mensual',
    url: 'https://admin.microsoft.com/#/subscriptions'
  },
  {
    id: 'emailjs',
    producto: 'EmailJS',
    remitente: /EmailJS.*@paddle\.com|@emailjs\.com/i,
    asunto: /suscripci[oó]n (.+)$|subscription (.+)$/i,
    productoDesde: 1,
    periodo: 'mensual',
    url: 'https://dashboard.emailjs.com/admin/account'
  },
  {
    id: 'google-workspace',
    producto: 'Google Workspace',
    remitente: /@google\.com/i,
    asunto: /Google Workspace: tu factura de (\S+)|Google Workspace.*invoice/i,
    periodo: 'mensual',
    url: 'https://admin.google.com/ac/billing'
  },
  {
    id: 'apple-developer',
    producto: 'Apple Developer Program',
    remitente: /@email\.apple\.com|@apple\.com/i,
    asunto: /Your Membership has been Renewed/i,
    periodo: 'anual',
    url: 'https://developer.apple.com/account'
  },
  {
    id: 'apple-suscripciones',
    producto: 'Suscripciones de Apple',
    remitente: /@email\.apple\.com|@apple\.com/i,
    asunto:
      /Renovaci[oó]n de tu suscripci[oó]n|Your subscription (was|has been) renewed/i,
    periodo: 'mensual',
    url: 'https://apps.apple.com/account/subscriptions'
  },
  {
    id: 'sendgrid',
    producto: 'SendGrid',
    remitente: /@sendgrid\.com/i,
    asunto: /new invoice from SendGrid|payment to SendGrid was successful/i,
    periodo: 'mensual',
    url: 'https://app.sendgrid.com/account/billing'
  },
  {
    id: 'aws',
    producto: 'Amazon Web Services',
    remitente: /@amazon\.com|@aws\.com|amazonaws\.com/i,
    asunto: /Billing Statement Available/i,
    periodo: 'mensual',
    url: 'https://console.aws.amazon.com/billing/home'
  },
  {
    id: 'zoom',
    producto: 'Zoom',
    remitente: /@zoom\.us/i,
    asunto: /Payment Processed|Your invoice is available|Tu factura/i,
    periodo: 'mensual',
    url: 'https://zoom.us/billing'
  },
  {
    id: 'render',
    producto: 'Render',
    remitente: /@stripe\.com|@render\.com/i,
    asunto: /receipt from Render/i,
    periodo: 'mensual',
    url: 'https://dashboard.render.com/billing'
  },
  {
    id: 'gamma',
    producto: 'Gamma',
    remitente: /@stripe\.com|@gamma\.app/i,
    asunto: /receipt from Gamma/i,
    periodo: 'mensual'
  },
  {
    id: 'anthropic',
    producto: 'Claude',
    proveedor: 'anthropic',
    remitente: /@mail\.anthropic\.com|@anthropic\.com|@claude\.com/i,
    asunto: /receipt from Anthropic|Your Claude.*(receipt|invoice)/i,
    periodo: 'mensual',
    url: 'https://claude.ai/settings/billing'
  },
  {
    id: 'figma',
    producto: 'Figma',
    proveedor: 'figma',
    remitente: /@figma\.com/i,
    asunto:
      /Recibo por el pago de la suscripci[oó]n|subscription (payment )?receipt/i,
    periodo: 'mensual',
    url: 'https://www.figma.com/settings'
  },
  {
    id: 'cursor',
    producto: 'Cursor',
    proveedor: 'cursor',
    remitente: /@cursor\.(com|sh)|Cursor.*@stripe\.com/i,
    asunto: /receipt|invoice|recibo|factura/i,
    periodo: 'mensual',
    url: 'https://cursor.com/settings'
  },
  {
    id: 'vercel',
    producto: 'Vercel',
    proveedor: 'vercel',
    remitente: /@vercel\.com/i,
    asunto: /receipt|invoice/i,
    periodo: 'mensual',
    url: 'https://vercel.com/account/billing'
  },
  {
    id: 'canva',
    producto: 'Canva Pro',
    remitente: /@ebanx\.com|@account\.canva\.com|@canva\.com/i,
    asunto: /de Canva|Tu factura de Canva|Canva.*(receipt|invoice)/i,
    periodo: 'mensual',
    url: 'https://www.canva.com/settings/billing-and-teams'
  },
  {
    id: 'godaddy',
    producto: 'GoDaddy (dominios)',
    remitente: /@godaddy\.com/i,
    asunto: /Recibo de renovaci[oó]n|renewal receipt|Order Confirmation/i,
    periodo: 'anual',
    url: 'https://account.godaddy.com/products'
  },
  {
    id: 'neubox',
    producto: 'Neubox (dominios y hosting)',
    remitente: /@neubox\.(net|com)/i,
    asunto: /Recibo de Pago|Domiciliaci[oó]n .* Activada/i,
    periodo: 'anual',
    url: 'https://panel.neubox.com'
  },
  {
    id: 'ionos',
    producto: 'IONOS',
    remitente: /@ionos\.(mx|com)/i,
    asunto: /Tu factura \d+/i,
    periodo: 'mensual',
    url: 'https://my.ionos.mx'
  },
  {
    id: 'starlink',
    producto: 'Starlink',
    remitente: /@starlink\.com/i,
    asunto: /Recibo de Starlink|Starlink receipt/i,
    periodo: 'mensual',
    url: 'https://www.starlink.com/account'
  },
  {
    id: 'tello',
    producto: 'Tello',
    remitente: /@tello\.com/i,
    asunto: /Renovaci[oó]n completa/i,
    periodo: 'mensual'
  },
  {
    id: 'pillofon',
    producto: 'PilloFon',
    remitente: /@pillofon\.mx/i,
    asunto: /Tu plan PilloFon vence hoy|renovado/i,
    periodo: 'mensual'
  },
  {
    id: 'mcafee',
    producto: 'McAfee',
    remitente: /@(protect|notification)\.mcafee\.com|@mcafee\.com/i,
    asunto: /se ha renovado|renovaci[oó]n de la suscripci[oó]n a McAfee/i,
    periodo: 'anual'
  },
  {
    id: 'github',
    producto: 'GitHub',
    remitente: /@github\.com/i,
    asunto: /\[GitHub\] (Payment|Your receipt)|receipt for/i,
    periodo: 'mensual',
    url: 'https://github.com/settings/billing'
  }
];

/**
 * Lo que ningun proveedor conocido explica pero suena a suscripcion. El
 * producto sale del nombre del remitente.
 */
const GENERICA_SUSCRIPCION =
  /(ha sido|se ha|has been) renovad|renewed your|your subscription (payment|receipt|has renewed)|recibo de (tu|la|su) suscripci[oó]n|tu suscripci[oó]n .*(renov|activ)|subscription (payment )?receipt|receipt for your subscription/i;

/** Marketing que usa las mismas palabras. Se descarta antes de cualquier regla. */
const PUBLICIDAD =
  /\d+\s?%|descuento|oferta|ahorra|promo|gratis|free trial|prueba gratis|last chance|[uú]ltima oportunidad|claim your|unlock|upgrade to/i;

interface ReglaPendiente {
  asunto: RegExp;
  prioridad: TaskPriority;
  /** Dias de margen desde el correo para la fecha compromiso. */
  diasDeMargen: number;
  etiqueta: string;
}

const REGLAS_PENDIENTE: ReglaPendiente[] = [
  {
    asunto:
      /payment (has )?failed|pago (rechazado|fallido|no se pudo)|tarjeta fue rechazada|se requiere una acci[oó]n para mantener|action needed.*payment|could not process your payment/i,
    prioridad: 'urgente',
    diasDeMargen: 2,
    etiqueta: 'pago'
  },
  {
    asunto: /vence hoy|expires today|expira hoy|[uú]ltimo d[ií]a para renovar/i,
    prioridad: 'urgente',
    diasDeMargen: 0,
    etiqueta: 'renovación'
  },
  {
    asunto:
      /se requiere una acci[oó]n|action (needed|required|may be required)|necesitas actualizar|update your payment|please update|actualiza tu (m[eé]todo|informaci[oó]n) de pago/i,
    prioridad: 'alta',
    diasDeMargen: 3,
    etiqueta: 'acción'
  },
  {
    asunto:
      /renovaci[oó]n .*(pr[oó]xima|est[aá] por|comienza)|est[aá] por vencer|expires? (soon|in \d+ days)|is renewing soon|about to end|ends? (soon|tomorrow|in \d+ days)|vence (pronto|en \d+ d[ií]as)/i,
    prioridad: 'media',
    diasDeMargen: 7,
    etiqueta: 'renovación'
  }
];

const DIA_MS = 86_400_000;
const PERIODO_DIAS: Record<Periodo, number> = { mensual: 31, anual: 366 };
/**
 * Cuantos dias sin recibo se tolera antes de dar la suscripcion por cancelada.
 * Mas de dos periodos: un recibo mensual que se atrasa o cae en otro buzon no
 * debe tirar la licencia, pero tres meses sin nada ya no es un atraso.
 */
const TOLERANCIA_DIAS: Record<Periodo, number> = { mensual: 75, anual: 730 };

/** Hasta cuantos dias atras se buscan invitaciones (bajar mensajes cuesta). */
const DIAS_DE_INVITACIONES = 60;
const DIAS_DE_PENDIENTES = 30;

export interface DatosCorreo {
  licencias: LicenseUsage[];
  pendientes: TaskItem[];
  juntas: Meeting[];
  /** Cuantos encabezados se leyeron, para la bitacora. */
  leidos: number;
}

/** Lee el buzon completo y deduce las tres cosas. */
export async function leerCorreo(
  config: ConfiguracionCorreo,
  ahora = new Date()
): Promise<DatosCorreo> {
  if (config.proveedor === 'microsoft') {
    throw new ErrorPuente(
      `El buzón "${config.id}" es de Microsoft, que ya no acepta IMAP con contraseña. Falta construir el adaptador con OAuth (Entra ID, permisos Mail.Read y Calendars.Read); mientras tanto se alimenta con el barrido de Mail.app.`,
      501
    );
  }
  // Gmail conectado con Google entra por XOAUTH2 con el token; lo demas, con
  // su contraseña.
  const accessToken = config.google?.refreshToken
    ? await tokenDeAccesoGoogle(config.id, config.google)
    : undefined;
  if (!config.contrasena && !accessToken) {
    throw new ErrorConfiguracion(
      `El buzón "${config.id}" no tiene contraseña: ponla en Correo → Editar conexión (o en ${variableContrasena(config.id)}).`
    );
  }

  const cliente = await ClienteImap.conectar({
    host: config.host,
    puerto: config.puerto,
    usuario: config.usuario,
    contrasena: config.contrasena,
    accessToken
  });
  try {
    const encabezados: EncabezadoCorreo[] = [];
    const calendarios: string[] = [];
    const desde = new Date(ahora.getTime() - config.diasAtras * DIA_MS);
    const desdeInvitaciones = ahora.getTime() - DIAS_DE_INVITACIONES * DIA_MS;

    for (const buzon of config.buzones) {
      await cliente.seleccionar(buzon);
      const uids = await cliente.buscarDesde(desde);
      const delBuzon = (await cliente.encabezados(uids)).map((e) => ({
        ...e,
        buzon
      }));
      encabezados.push(...delBuzon);

      const candidatos = delBuzon
        .filter(
          (e) =>
            e.tipoContenido.startsWith('multipart') &&
            e.fecha &&
            new Date(e.fecha).getTime() >= desdeInvitaciones
        )
        .map((e) => e.uid);
      for (const uid of await cliente.conCalendario(candidatos)) {
        const ics = extraerCalendario(await cliente.mensajeCrudo(uid));
        if (ics) {
          calendarios.push(ics);
        }
      }
    }

    // El importe no viene en el asunto: se lee del cuerpo del ultimo recibo
    // de cada suscripcion. Son pocos mensajes (uno por licencia), asi que
    // bajarlos no cuesta lo que costaria bajar el buzon.
    const evidencias = detectarLicenciasConEvidencia(
      encabezados,
      config.accountId,
      ahora
    );
    let buzonAbierto: string | undefined;
    for (const evidencia of evidencias) {
      const { buzon, uid, remitente } = evidencia.ultimo;
      if (buzon && buzon !== buzonAbierto) {
        await cliente.seleccionar(buzon);
        buzonAbierto = buzon;
      }
      const monto = montoDelRecibo(
        textoDe(await cliente.mensajeCrudo(uid, 131_072)),
        remitente
      );
      if (monto) {
        evidencia.licencia.cost = monto.costo;
        evidencia.licencia.currency = monto.moneda;
        // La unidad es dinero: lo consumido del periodo es lo que se cobro.
        evidencia.licencia.used = monto.costo;
      }
    }

    // Con Google conectado se lee el calendario completo, que es mejor que
    // las invitaciones sueltas del buzon.
    const juntas = accessToken
      ? await calendarioGoogle(accessToken, config.accountId, ahora)
      : juntasDeCalendario(calendarios, config.accountId, config.usuario);

    return {
      licencias: evidencias.map((e) => e.licencia),
      pendientes: detectarPendientes(encabezados, config.accountId, ahora),
      juntas,
      leidos: encabezados.length
    };
  } finally {
    await cliente.cerrar();
  }
}

// --- Licencias ---

interface Acumulado {
  regla: ReglaLicencia;
  producto: string;
  fechas: number[];
  /** El encabezado mas reciente: de ahi se lee el importe. */
  ultimo: EncabezadoCorreo;
}

export interface LicenciaConEvidencia {
  licencia: LicenseUsage;
  /** El correo mas reciente que la sostiene. */
  ultimo: EncabezadoCorreo;
}

export function detectarLicencias(
  encabezados: EncabezadoCorreo[],
  accountId: string,
  ahora = new Date()
): LicenseUsage[] {
  return detectarLicenciasConEvidencia(encabezados, accountId, ahora).map(
    (e) => e.licencia
  );
}

/**
 * Las licencias y, por cada una, el correo mas reciente que la sostiene, para
 * que quien tenga acceso al cuerpo pueda leer de ahi el importe.
 */
export function detectarLicenciasConEvidencia(
  encabezados: EncabezadoCorreo[],
  accountId: string,
  ahora = new Date()
): LicenciaConEvidencia[] {
  const porProducto = new Map<string, Acumulado>();

  for (const encabezado of encabezados) {
    if (!encabezado.fecha || PUBLICIDAD.test(encabezado.asunto)) {
      continue;
    }
    const coincidencia = reconocerLicencia(encabezado);
    if (!coincidencia) {
      continue;
    }
    const llave = `${coincidencia.regla.id}:${coincidencia.producto.toLowerCase()}`;
    const recibido = new Date(encabezado.fecha).getTime();
    const acumulado = porProducto.get(llave) ?? {
      ...coincidencia,
      fechas: [],
      ultimo: encabezado
    };
    acumulado.fechas.push(recibido);
    if (recibido > new Date(acumulado.ultimo.fecha).getTime()) {
      acumulado.ultimo = encabezado;
    }
    porProducto.set(llave, acumulado);
  }

  const resultado: LicenciaConEvidencia[] = [];
  for (const [llave, acumulado] of porProducto) {
    const ultima = Math.max(...acumulado.fechas);
    const periodoMs = PERIODO_DIAS[acumulado.regla.periodo] * DIA_MS;
    // Una suscripcion que lleva demasiado sin recibo se cancelo, no se
    // atraso: se deja fuera en lugar de mostrarla como vigente.
    if (
      ahora.getTime() - ultima >
      TOLERANCIA_DIAS[acumulado.regla.periodo] * DIA_MS
    ) {
      continue;
    }
    // La proxima renovacion es la primera fecha del ciclo que cae despues de
    // hoy: si el ultimo recibo es de hace dos meses, no "renovo hace un mes".
    let renueva = ultima + periodoMs;
    while (renueva <= ahora.getTime()) {
      renueva += periodoMs;
    }
    resultado.push({
      ultimo: acumulado.ultimo,
      licencia: {
        id: `${accountId}-${llave.replace(/[^a-z0-9]+/gi, '-')}`,
        provider: acumulado.regla.proveedor ?? 'otro',
        product: acumulado.producto,
        plan: `${acumulado.regla.periodo === 'anual' ? 'Anual' : 'Mensual'} · ${acumulado.fechas.length} ${acumulado.fechas.length === 1 ? 'recibo' : 'recibos'} en el correo`,
        unit: 'dinero',
        used: 0,
        periodStart: new Date(ultima).toISOString(),
        periodEnd: new Date(renueva).toISOString(),
        renewsAt: new Date(renueva).toISOString(),
        // No lo capturo nadie: se dedujo del correo. Pero tampoco lo dijo el
        // proveedor por API, asi que el costo solo viene si el recibo lo trae.
        manual: false,
        members: [],
        accountId,
        url: acumulado.regla.url,
        updatedAt: ahora.toISOString()
      }
    });
  }

  return resultado.sort((a, b) =>
    a.licencia.product.localeCompare(b.licencia.product)
  );
}

/**
 * El importe de un recibo, leido de su texto.
 *
 * Heuristica: se buscan cantidades con moneda (`$1,572.17`, `MXN 403.46`,
 * `23.20 USD`) y se toma la que sigue a la palabra "total"; si no hay, la
 * mayor, que en un recibo suele ser el total y no el subtotal ni el impuesto.
 * Un `$` a secas es MXN si el remitente es de un dominio .mx y USD si no.
 * Cuando falla, el portal deja poner el costo a mano.
 */
export function montoDelRecibo(
  texto: string,
  remitente: string
): { costo: number; moneda: string } | undefined {
  const cantidades: { costo: number; moneda: string; indice: number }[] = [];
  const patron =
    /(MXN|USD|EUR|MX\$|US\$|\$|€)\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)(?:\s?(MXN|USD|EUR))?|(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s?(MXN|USD|EUR)\b/g;
  const monedaPorOmision = /\.mx>?\s*$|@[^\s>]+\.mx\b/i.test(remitente)
    ? 'MXN'
    : 'USD';
  for (const m of texto.matchAll(patron)) {
    const numero = Number((m[2] ?? m[4] ?? '').replace(/,/g, ''));
    if (!Number.isFinite(numero) || numero <= 0) {
      continue;
    }
    const simbolo = (m[1] ?? '').toUpperCase();
    const explicita = (m[3] ?? m[5] ?? '').toUpperCase();
    const moneda =
      explicita ||
      (simbolo === 'MXN' || simbolo === 'MX$'
        ? 'MXN'
        : simbolo === 'USD' || simbolo === 'US$'
          ? 'USD'
          : simbolo === 'EUR' || simbolo === '€'
            ? 'EUR'
            : monedaPorOmision);
    cantidades.push({ costo: numero, moneda, indice: m.index ?? 0 });
  }
  if (cantidades.length === 0) {
    return undefined;
  }
  const trasTotal = cantidades.find((c) =>
    /(?<!sub)total/i.test(texto.slice(Math.max(0, c.indice - 40), c.indice))
  );
  const elegida =
    trasTotal ?? cantidades.reduce((a, b) => (b.costo > a.costo ? b : a));
  return { costo: elegida.costo, moneda: elegida.moneda };
}

function reconocerLicencia(
  encabezado: EncabezadoCorreo
): { regla: ReglaLicencia; producto: string } | undefined {
  for (const regla of REGLAS_LICENCIA) {
    if (!regla.remitente.test(encabezado.remitente)) {
      continue;
    }
    if (!regla.asunto) {
      return { regla, producto: regla.producto };
    }
    const coincidencia = regla.asunto.exec(encabezado.asunto);
    if (!coincidencia) {
      continue;
    }
    const capturado =
      regla.productoDesde !== undefined
        ? coincidencia
            .slice(regla.productoDesde)
            .find((grupo) => grupo !== undefined)
        : undefined;
    return {
      regla,
      producto:
        regla.productoDesde !== undefined && capturado
          ? `${regla.producto} · ${capturado.trim()}`
          : regla.producto
    };
  }

  if (GENERICA_SUSCRIPCION.test(encabezado.asunto)) {
    return {
      regla: GENERICA,
      producto: nombreDelRemitente(encabezado.remitente)
    };
  }
  return undefined;
}

const GENERICA: ReglaLicencia = {
  id: 'generica',
  producto: 'Suscripción',
  remitente: /./,
  periodo: 'mensual'
};

/** `Zoom <no-reply@zoom.us>` -> `Zoom`; `no-reply@zoom.us` -> `zoom.us`. */
export function nombreDelRemitente(remitente: string): string {
  const conNombre = /^\s*"?([^"<]+?)"?\s*<[^>]+>/.exec(remitente);
  if (conNombre?.[1]) {
    return conNombre[1].trim();
  }
  const dominio = /@([^\s>]+)/.exec(remitente);
  return dominio?.[1] ?? remitente.trim();
}

// --- Pendientes ---

export function detectarPendientes(
  encabezados: EncabezadoCorreo[],
  accountId: string,
  ahora = new Date()
): TaskItem[] {
  const desde = ahora.getTime() - DIAS_DE_PENDIENTES * DIA_MS;
  const porAsunto = new Map<string, TaskItem>();

  for (const encabezado of encabezados) {
    if (!encabezado.fecha || PUBLICIDAD.test(encabezado.asunto)) {
      continue;
    }
    const recibido = new Date(encabezado.fecha).getTime();
    if (recibido < desde) {
      continue;
    }
    const regla = REGLAS_PENDIENTE.find((r) =>
      r.asunto.test(encabezado.asunto)
    );
    if (!regla) {
      continue;
    }
    const llave = encabezado.asunto.toLowerCase().replace(/\d+/g, '#');
    const anterior = porAsunto.get(llave);
    if (anterior && new Date(anterior.updatedAt).getTime() >= recibido) {
      continue;
    }
    const vence = new Date(recibido + regla.diasDeMargen * DIA_MS);
    porAsunto.set(llave, {
      id: `${accountId}-${encabezado.uid}`,
      title: encabezado.asunto,
      description: `De ${nombreDelRemitente(encabezado.remitente)}`,
      status: 'pendiente',
      priority: regla.prioridad,
      dueDate: vence.toISOString(),
      accountId,
      origin: 'correo',
      project: 'Correo',
      tags: ['correo', regla.etiqueta],
      updatedAt: new Date(recibido).toISOString()
    });
  }

  return [...porAsunto.values()].sort((a, b) =>
    (a.dueDate ?? '').localeCompare(b.dueDate ?? '')
  );
}
