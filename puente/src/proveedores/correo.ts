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
  /** Moneda del recibo cuando el cuerpo solo trae "$" (MXN o USD). */
  moneda?: string;
}

const REGLAS_LICENCIA: ReglaLicencia[] = [
  {
    id: 'microsoft',
    moneda: 'USD',
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
    moneda: 'USD',
    producto: 'EmailJS',
    remitente: /EmailJS.*@paddle\.com|@emailjs\.com/i,
    asunto: /suscripci[oó]n (.+)$|subscription (.+)$/i,
    productoDesde: 1,
    periodo: 'mensual',
    url: 'https://dashboard.emailjs.com/admin/account'
  },
  {
    id: 'google-workspace',
    moneda: 'MXN',
    producto: 'Google Workspace',
    remitente: /@google\.com/i,
    asunto: /Google Workspace: tu factura de (\S+)|Google Workspace.*invoice/i,
    periodo: 'mensual',
    url: 'https://admin.google.com/ac/billing'
  },
  {
    id: 'apple-developer',
    moneda: 'USD',
    producto: 'Apple Developer Program',
    remitente: /@email\.apple\.com|@apple\.com/i,
    asunto: /Your Membership has been Renewed/i,
    periodo: 'anual',
    url: 'https://developer.apple.com/account'
  },
  {
    id: 'apple-suscripciones',
    moneda: 'MXN',
    producto: 'Suscripciones de Apple',
    remitente: /@email\.apple\.com|@apple\.com/i,
    asunto:
      /Renovaci[oó]n de tu suscripci[oó]n|Your subscription (was|has been) renewed/i,
    periodo: 'mensual',
    url: 'https://apps.apple.com/account/subscriptions'
  },
  {
    id: 'sendgrid',
    moneda: 'USD',
    producto: 'SendGrid',
    remitente: /@sendgrid\.com/i,
    asunto: /new invoice from SendGrid|payment to SendGrid was successful/i,
    periodo: 'mensual',
    url: 'https://app.sendgrid.com/account/billing'
  },
  {
    id: 'aws',
    moneda: 'USD',
    producto: 'Amazon Web Services',
    remitente: /@amazon\.com|@aws\.com|amazonaws\.com/i,
    asunto: /Billing Statement Available/i,
    periodo: 'mensual',
    url: 'https://console.aws.amazon.com/billing/home'
  },
  {
    id: 'zoom',
    moneda: 'USD',
    producto: 'Zoom',
    remitente: /@zoom\.us/i,
    asunto: /Payment Processed|Your invoice is available|Tu factura/i,
    periodo: 'mensual',
    url: 'https://zoom.us/billing'
  },
  {
    id: 'render',
    moneda: 'USD',
    producto: 'Render',
    remitente: /@stripe\.com|@render\.com/i,
    asunto: /receipt from Render/i,
    periodo: 'mensual',
    url: 'https://dashboard.render.com/billing'
  },
  {
    id: 'gamma',
    moneda: 'USD',
    producto: 'Gamma',
    remitente: /@stripe\.com|@gamma\.app/i,
    asunto: /receipt from Gamma/i,
    periodo: 'mensual'
  },
  {
    id: 'anthropic',
    moneda: 'USD',
    producto: 'Claude',
    proveedor: 'anthropic',
    remitente: /@mail\.anthropic\.com|@anthropic\.com|@claude\.com/i,
    asunto: /receipt from Anthropic|Your Claude.*(receipt|invoice)/i,
    periodo: 'mensual',
    url: 'https://claude.ai/settings/billing'
  },
  {
    id: 'figma',
    moneda: 'USD',
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
    moneda: 'USD',
    producto: 'Cursor',
    proveedor: 'cursor',
    remitente: /@cursor\.(com|sh)|Cursor.*@stripe\.com/i,
    asunto: /receipt|invoice|recibo|factura/i,
    periodo: 'mensual',
    url: 'https://cursor.com/settings'
  },
  {
    id: 'vercel',
    moneda: 'USD',
    producto: 'Vercel',
    proveedor: 'vercel',
    remitente: /@vercel\.com/i,
    asunto: /receipt|invoice/i,
    periodo: 'mensual',
    url: 'https://vercel.com/account/billing'
  },
  {
    id: 'canva',
    moneda: 'MXN',
    producto: 'Canva Pro',
    remitente: /@ebanx\.com|@account\.canva\.com|@canva\.com/i,
    asunto: /de Canva|Tu factura de Canva|Canva.*(receipt|invoice)/i,
    periodo: 'mensual',
    url: 'https://www.canva.com/settings/billing-and-teams'
  },
  {
    id: 'godaddy',
    moneda: 'MXN',
    producto: 'GoDaddy (dominios)',
    remitente: /@godaddy\.com/i,
    asunto: /Recibo de renovaci[oó]n|renewal receipt|Order Confirmation/i,
    periodo: 'anual',
    url: 'https://account.godaddy.com/products'
  },
  {
    id: 'neubox',
    moneda: 'MXN',
    producto: 'Neubox (dominios y hosting)',
    remitente: /@neubox\.(net|com)/i,
    asunto: /Recibo de Pago|Domiciliaci[oó]n .* Activada/i,
    periodo: 'anual',
    url: 'https://panel.neubox.com'
  },
  {
    id: 'ionos',
    moneda: 'MXN',
    producto: 'IONOS',
    remitente: /@ionos\.(mx|com)/i,
    asunto: /Tu factura \d+/i,
    periodo: 'mensual',
    url: 'https://my.ionos.mx'
  },
  {
    id: 'starlink',
    moneda: 'MXN',
    producto: 'Starlink',
    remitente: /@starlink\.com/i,
    asunto: /Recibo de Starlink|Starlink receipt/i,
    periodo: 'mensual',
    url: 'https://www.starlink.com/account'
  },
  {
    id: 'tello',
    moneda: 'USD',
    producto: 'Tello',
    remitente: /@tello\.com/i,
    asunto: /Renovaci[oó]n completa/i,
    periodo: 'mensual'
  },
  {
    id: 'pillofon',
    moneda: 'MXN',
    producto: 'PilloFon',
    remitente: /@pillofon\.mx/i,
    asunto: /Tu plan PilloFon vence hoy|renovado/i,
    periodo: 'mensual'
  },
  {
    id: 'mcafee',
    moneda: 'MXN',
    producto: 'McAfee',
    remitente: /@(protect|notification)\.mcafee\.com|@mcafee\.com/i,
    asunto: /se ha renovado|renovaci[oó]n de la suscripci[oó]n a McAfee/i,
    periodo: 'anual'
  },
  {
    id: 'github',
    moneda: 'USD',
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
  /\d+\s?%|descuento|oferta|ahorra|promo|gratis|free trial|prueba gratis|last chance|[uú]ltima oportunidad|claim your|unlock|upgrade to|sorpresa|newsletter|webinar|black friday|buen fin|\bdeal\b|\bsale\b|te extra[nñ]amos/i;

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
  /** Correos recientes que las reglas no reconocen, listos para la IA. */
  paraIa: CandidatoIa[];
}

/** Un correo que las reglas no reconocieron y que la IA todavia no vio. */
export interface CandidatoIa {
  clave: string;
  encabezado: EncabezadoCorreo;
  /** Texto del cuerpo, ya sin HTML y recortado. */
  texto: string;
}

/** Que correos mandar a la IA: cuantos dias atras, cuantos y cuales no. */
export interface OpcionesIa {
  dias: number;
  maximo: number;
  yaAnalizado: (clave: string) => boolean;
}

/** Un identificador estable para no analizar dos veces el mismo correo. */
export function claveDeCorreo(accountId: string, e: EncabezadoCorreo): string {
  return `${accountId}:${e.fecha}:${e.remitente}:${e.asunto}`.slice(0, 300);
}

/**
 * Los correos recientes que las reglas no reconocieron ni como recibo ni como
 * aviso: publicidad fuera, mas nuevos primero, y solo los que la IA no ha
 * visto. El cuerpo lo baja quien llama, porque cada proveedor lo saca
 * distinto.
 */
export function candidatosParaIa(
  encabezados: EncabezadoCorreo[],
  reconocidos: ReadonlySet<number>,
  accountId: string,
  opciones: OpcionesIa,
  ahora = new Date()
): { clave: string; encabezado: EncabezadoCorreo }[] {
  const desde = ahora.getTime() - opciones.dias * DIA_MS;
  return encabezados
    .filter(
      (e) =>
        e.fecha &&
        new Date(e.fecha).getTime() >= desde &&
        !reconocidos.has(e.uid) &&
        !PUBLICIDAD.test(e.asunto) &&
        !SIN_RESPUESTA.test(e.remitente) &&
        !DEL_MONITOR.test(e.asunto) &&
        !esCorreoDeTotalOne(e.asunto)
    )
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
    .map((encabezado) => ({
      clave: claveDeCorreo(accountId, encabezado),
      encabezado
    }))
    .filter((c) => !opciones.yaAnalizado(c.clave))
    .slice(0, opciones.maximo);
}

/**
 * Lo que manda el propio monitor (codigos de acceso, asignaciones, la liga
 * del equipo, el correo del lunes): si entrara a la IA, cada aviso de un
 * pendiente se volveria otro pendiente.
 */
const DEL_MONITOR = /^\s*(re:\s*)?access monitor\b/i;

/**
 * Lo que manda Total One (avisos de leads, apartados, citas, recibos, altas
 * de cuenta): sale por EmailJS con el remitente de Carlos, asi que se
 * reconoce por sus marcas fijas, no por el remitente. El asunto del buzon de
 * pruebas ("[PRUEBA · para …]") se ve en la cabecera; el pie de la plantilla
 * ("Enviado con Total One", "Aviso automático de Total One") solo en el
 * cuerpo. Ninguno es un pendiente de Carlos: son cosas que su propio
 * producto le avisa a sus clientes.
 */
const ASUNTO_TOTAL_ONE = /^\s*(re:\s*|rv:\s*|fwd?:\s*)*\[PRUEBA · para /i;
const CUERPO_TOTAL_ONE =
  /Enviado con Total One|Aviso autom[aá]tico de Total One/i;
/** En la descripcion de un pendiente ya registrado, el asunto va como "Asunto: …". */
const ASUNTO_EN_DESCRIPCION =
  /^Asunto:\s*(re:\s*|rv:\s*|fwd?:\s*)*\[PRUEBA · para /im;

/**
 * Un correo (asunto y, si se tiene, cuerpo) que manda Total One. Sirve
 * tambien para un pendiente ya registrado: titulo + descripcion, donde el
 * asunto original va como "Asunto: …" aunque la IA le haya puesto otro titulo.
 */
export function esCorreoDeTotalOne(asunto: string, texto = ''): boolean {
  return (
    ASUNTO_TOTAL_ONE.test(asunto) ||
    CUERPO_TOTAL_ONE.test(texto) ||
    ASUNTO_EN_DESCRIPCION.test(texto)
  );
}

/** Remitentes automaticos que nunca piden nada. */
const SIN_RESPUESTA =
  /no-?reply|noreply|donotreply|mailer-daemon|postmaster|notifications?@|newsletter|marketing@/i;

/** Lee el buzon completo y deduce las tres cosas. */
export async function leerCorreo(
  config: ConfiguracionCorreo,
  ahora = new Date(),
  ia?: OpcionesIa
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
        remitente,
        evidencia.moneda
      );
      if (monto) {
        evidencia.licencia.cost = monto.costo;
        evidencia.licencia.currency = monto.moneda;
        // La unidad es dinero: lo consumido del periodo es lo que se cobro.
        evidencia.licencia.used = monto.costo;
      }
    }

    // Los pendientes llevan el correo completo: remitente, destinatarios y
    // texto. Son pocos, asi que se bajan uno por uno.
    const pendientes = detectarPendientesConEvidencia(
      encabezados,
      config.accountId,
      ahora
    );
    for (const pendiente of pendientes) {
      const { buzon, uid } = pendiente.encabezado;
      if (buzon && buzon !== buzonAbierto) {
        await cliente.seleccionar(buzon);
        buzonAbierto = buzon;
      }
      pendiente.tarea.description = descripcionDeCorreo(
        pendiente.encabezado,
        textoDe(await cliente.mensajeCrudo(uid, 131_072))
      );
    }

    // Lo que las reglas no reconocieron se le deja a la IA, con un trozo
    // del cuerpo para que tenga con que decidir.
    const paraIa: CandidatoIa[] = [];
    if (ia) {
      const reconocidos = new Set([
        ...evidencias.map((e) => e.ultimo.uid),
        ...pendientes.map((p) => p.encabezado.uid)
      ]);
      for (const candidato of candidatosParaIa(
        encabezados,
        reconocidos,
        config.accountId,
        ia,
        ahora
      )) {
        const { buzon, uid } = candidato.encabezado;
        if (buzon && buzon !== buzonAbierto) {
          await cliente.seleccionar(buzon);
          buzonAbierto = buzon;
        }
        paraIa.push({
          ...candidato,
          texto: textoDe(await cliente.mensajeCrudo(uid, 32_768)).slice(0, 2000)
        });
      }
    }

    // Con Google conectado se lee el calendario completo, que es mejor que
    // las invitaciones sueltas del buzon.
    const juntas = accessToken
      ? await calendarioGoogle(accessToken, config.accountId, ahora)
      : juntasDeCalendario(calendarios, config.accountId, config.usuario);

    return {
      licencias: evidencias.map((e) => e.licencia),
      pendientes: pendientes.map((p) => p.tarea),
      juntas,
      leidos: encabezados.length,
      paraIa
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
  /** Moneda que usa ese proveedor cuando el recibo solo trae "$". */
  moneda?: string;
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
      moneda: acumulado.regla.moneda,
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
  remitente: string,
  monedaSugerida?: string
): { costo: number; moneda: string } | undefined {
  const cantidades: { costo: number; moneda: string; indice: number }[] = [];
  const patron =
    /(MXN|USD|EUR|MX\$|US\$|\$|€)\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)(?:\s?(MXN|USD|EUR))?|(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s?(MXN|USD|EUR)\b/g;
  const monedaPorOmision =
    monedaSugerida ??
    (/\.mx>?\s*$|@[^\s>]+\.mx\b/i.test(remitente) ? 'MXN' : 'USD');
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

/** Remitente de alguno de los proveedores de suscripciones o dominios. */
function esProveedorConocido(remitente: string): boolean {
  return REGLAS_LICENCIA.some((regla) => regla.remitente.test(remitente));
}

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

export interface PendienteConEvidencia {
  tarea: TaskItem;
  /** El correo del que salio, para copiar su contenido. */
  encabezado: EncabezadoCorreo;
}

export function detectarPendientes(
  encabezados: EncabezadoCorreo[],
  accountId: string,
  ahora = new Date()
): TaskItem[] {
  return detectarPendientesConEvidencia(encabezados, accountId, ahora).map(
    (p) => p.tarea
  );
}

/**
 * La descripcion de un pendiente que salio de un correo: quien lo mando, a
 * quien, con copia a quien, y el texto del correo recortado. Asi el pendiente
 * se entiende sin ir a buscar el correo.
 */
export function descripcionDeCorreo(
  encabezado: EncabezadoCorreo,
  texto: string
): string {
  const lineas = [
    `De: ${encabezado.remitente}`,
    encabezado.para ? `Para: ${encabezado.para}` : undefined,
    encabezado.cc ? `CC: ${encabezado.cc}` : undefined,
    `Asunto: ${encabezado.asunto}`
  ].filter((l): l is string => !!l);
  const cuerpo = texto
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 1500);
  return cuerpo ? `${lineas.join('\n')}\n\n${cuerpo}` : lineas.join('\n');
}

export function detectarPendientesConEvidencia(
  encabezados: EncabezadoCorreo[],
  accountId: string,
  ahora = new Date()
): PendienteConEvidencia[] {
  const desde = ahora.getTime() - DIAS_DE_PENDIENTES * DIA_MS;
  const porAsunto = new Map<string, PendienteConEvidencia>();

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
    // Solo cuenta si viene de un proveedor de suscripciones o dominios: un
    // "vence hoy" de una tienda o una app es publicidad, no un pendiente.
    if (!esProveedorConocido(encabezado.remitente)) {
      continue;
    }
    const llave = encabezado.asunto.toLowerCase().replace(/\d+/g, '#');
    const anterior = porAsunto.get(llave);
    if (anterior && new Date(anterior.tarea.updatedAt).getTime() >= recibido) {
      continue;
    }
    const vence = new Date(recibido + regla.diasDeMargen * DIA_MS);
    porAsunto.set(llave, {
      encabezado,
      tarea: {
        id: `${accountId}-${encabezado.uid}`,
        title: encabezado.asunto,
        description: descripcionDeCorreo(encabezado, ''),
        status: 'pendiente',
        priority: regla.prioridad,
        dueDate: vence.toISOString(),
        accountId,
        origin: 'correo',
        project: 'Correo',
        tags: ['correo', regla.etiqueta],
        updatedAt: new Date(recibido).toISOString()
      }
    });
  }

  return [...porAsunto.values()].sort((a, b) =>
    (a.tarea.dueDate ?? '').localeCompare(b.tarea.dueDate ?? '')
  );
}
