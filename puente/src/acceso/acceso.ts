import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { ConfiguracionAcceso } from '../config/entorno.js';
import { AlmacenJson } from '../datos/almacen-json.js';
import { ErrorPuente } from '../nucleo/errores.js';

/**
 * Acceso al portal con un codigo que llega por correo.
 *
 * No hay contraseñas: quien quiera entrar escribe su correo, y si esta en la
 * lista de correos autorizados le llega un codigo de seis digitos por EmailJS
 * (el mismo servicio y plantilla que ya se usan, con el titulo "Access
 * Monitor"). Con el codigo se le entrega un token de sesion que el portal
 * guarda en el navegador y manda en cada peticion.
 *
 * El codigo vive diez minutos y se gasta al usarse; la sesion dura treinta
 * dias. Las sesiones se escriben a disco para que un reinicio no saque a
 * nadie, y los codigos no: perder un codigo por un reinicio solo cuesta pedir
 * otro.
 */

const CODIGO_MINUTOS = 10;
const SESION_DIAS = 30;
const INTENTOS_MAXIMOS = 5;

interface Codigo {
  correo: string;
  codigo: string;
  vence: number;
  intentos: number;
}

export interface Sesion {
  token: string;
  correo: string;
  creada: string;
  vence: string;
}

export class Acceso {
  private readonly codigos = new Map<string, Codigo>();

  constructor(
    private readonly sesiones: AlmacenJson<Sesion[]>,
    private readonly enviar: (
      config: ConfiguracionAcceso,
      correo: string,
      codigo: string
    ) => Promise<void> = enviarPorEmailJs
  ) {}

  /** Manda un codigo si el correo esta autorizado. Nunca dice si lo esta. */
  async pedirCodigo(
    config: ConfiguracionAcceso,
    correoCrudo: string
  ): Promise<void> {
    const correo = normalizar(correoCrudo);
    if (!correo || !config.correos.includes(correo)) {
      // Se tarda lo mismo que un envio real para no delatar la lista.
      await new Promise((r) => setTimeout(r, 400));
      return;
    }
    const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.codigos.set(correo, {
      correo,
      codigo,
      vence: Date.now() + CODIGO_MINUTOS * 60_000,
      intentos: 0
    });
    await this.enviar(config, correo, codigo);
  }

  /**
   * Cambia un codigo por una sesion. Si hay clave maestra configurada y se
   * escribe (en el correo o en el codigo), entra sin codigo por correo como
   * el primer correo autorizado: es la puerta de emergencia cuando el correo
   * no llega.
   */
  async entrar(
    correoCrudo: string,
    codigoCrudo: string,
    maestra?: { clave: string; correo: string }
  ): Promise<Sesion> {
    if (
      maestra?.clave &&
      (iguales(maestra.clave, (codigoCrudo ?? '').trim()) ||
        iguales(maestra.clave, (correoCrudo ?? '').trim()))
    ) {
      return this.abrirSesion(normalizar(maestra.correo));
    }
    const correo = normalizar(correoCrudo);
    const pendiente = this.codigos.get(correo);
    const codigo = (codigoCrudo ?? '').replace(/\D/g, '');
    if (!pendiente || pendiente.vence < Date.now()) {
      this.codigos.delete(correo);
      throw new ErrorPuente(
        'El código no es válido o ya venció. Pide uno nuevo.',
        401
      );
    }
    pendiente.intentos++;
    if (
      pendiente.intentos > INTENTOS_MAXIMOS ||
      !iguales(pendiente.codigo, codigo)
    ) {
      if (pendiente.intentos > INTENTOS_MAXIMOS) {
        this.codigos.delete(correo);
      }
      throw new ErrorPuente('El código no coincide.', 401);
    }
    this.codigos.delete(correo);
    return this.abrirSesion(correo);
  }

  private async abrirSesion(correo: string): Promise<Sesion> {
    const ahora = new Date();
    const sesion: Sesion = {
      token: randomBytes(32).toString('base64url'),
      correo,
      creada: ahora.toISOString(),
      vence: new Date(ahora.getTime() + SESION_DIAS * 86_400_000).toISOString()
    };
    const vigentes = this.sesiones
      .leer()
      .filter((s) => Date.parse(s.vence) > ahora.getTime());
    await this.sesiones.escribir([...vigentes, sesion]);
    return sesion;
  }

  async salir(token: string): Promise<void> {
    await this.sesiones.escribir(
      this.sesiones.leer().filter((s) => !iguales(s.token, token))
    );
  }

  /** La sesion detras de un token, si sigue vigente. */
  sesionDe(token: string | undefined): Sesion | undefined {
    if (!token) {
      return undefined;
    }
    return this.sesiones
      .leer()
      .find((s) => iguales(s.token, token) && Date.parse(s.vence) > Date.now());
  }
}

function normalizar(correo: string | undefined): string {
  return (correo ?? '').trim().toLowerCase();
}

function iguales(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Lo que va a la plantilla de EmailJS. */
export interface ParametrosEmailJs {
  title: string;
  subject: string;
  html_content: string;
  to_email: string;
  email: string;
  reply_to: string;
  /** Con copia: varias direcciones separadas por coma; vacio si no hay. */
  cc_email: string;
  name: string;
  from_name: string;
  origen: string;
  area_interes: string;
  comentarios: string;
  message: string;
  code: string;
}

/** Otro correo por la misma via: titulo y cuerpo propios, y con copia si hay. */
export interface CorreoPropio {
  titulo: string;
  html: string;
  /** Quienes van con copia (cc_email de la plantilla). */
  cc?: string[];
}

/**
 * Arma los parametros de la plantilla. Van con varios nombres a la vez
 * (title, subject, message, code, to_email, email...) para que la plantilla
 * que ya existe los tome sin tener que editarla. Las copias van en
 * `cc_email` separadas por coma, sin repetir al destinatario.
 */
export function parametrosEmailJs(
  correo: string,
  codigo: string,
  prueba = false,
  propio?: CorreoPropio
): ParametrosEmailJs {
  const mensaje = prueba
    ? 'Correo de prueba: el envío de códigos de acceso a DS Monitor funciona. Los códigos reales son seis dígitos al azar y llegan al pedir acceso.'
    : `Tu código de acceso a DS Monitor es ${codigo}. Vence en ${CODIGO_MINUTOS} minutos.`;
  const cuerpo = propio
    ? propio.html
    : prueba
      ? `<p>${mensaje}</p>`
      : `<p>Tu código de acceso a <strong>DS Monitor</strong> es</p>` +
        `<p style="font-size:28px;letter-spacing:6px;font-family:monospace"><strong>${codigo}</strong></p>` +
        `<p>Vence en ${CODIGO_MINUTOS} minutos. Si no pediste entrar, ignora este correo.</p>`;
  const principal = correo.trim().toLowerCase();
  const copias = [
    ...new Set(
      (propio?.cc ?? [])
        .map((c) => c.trim())
        .filter((c) => c.includes('@') && c.toLowerCase() !== principal)
    )
  ];
  return {
    // La plantilla "General_Contact Us" de Total One: {{title}} es el
    // asunto, {{{html_content}}} el cuerpo, {{to_email}} el destinatario,
    // {{cc_email}} las copias, {{name}} el remitente y {{email}} el
    // Responder a. Los demas nombres van por si la plantilla cambia a la de
    // las landings.
    // El asunto se queda en "Access Monitor" para todos los correos, como
    // hasta ahora; el titulo propio no llega a la plantilla.
    title: 'Access Monitor',
    subject: 'Access Monitor',
    html_content: cuerpo,
    to_email: correo,
    email: correo,
    reply_to: correo,
    cc_email: copias.join(','),
    name: 'DS Monitor',
    from_name: 'DS Monitor',
    origen: 'Access Monitor',
    area_interes: 'Access Monitor',
    comentarios: propio ? propio.html.replace(/<[^>]+>/g, ' ') : mensaje,
    message: propio ? propio.html.replace(/<[^>]+>/g, ' ') : mensaje,
    code: codigo
  };
}

/**
 * El correo con el codigo, por la API de EmailJS.
 *
 * Desde un servidor EmailJS exige la llave privada ademas de la publica.
 */
export async function enviarPorEmailJs(
  config: ConfiguracionAcceso,
  correo: string,
  codigo: string,
  /** True para el correo de prueba de Ajustes: no lleva codigo. */
  prueba = false,
  /** Otro correo por la misma via: titulo y cuerpo propios. */
  propio?: CorreoPropio
): Promise<void> {
  const respuesta = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      service_id: config.serviceId,
      template_id: config.templateId,
      user_id: config.publicKey,
      accessToken: config.privateKey,
      template_params: parametrosEmailJs(correo, codigo, prueba, propio)
    })
  });
  if (!respuesta.ok) {
    const texto = await respuesta.text().catch(() => '');
    throw new ErrorPuente(
      `EmailJS respondió ${respuesta.status}${texto ? ` · ${texto.slice(0, 200)}` : ''}`,
      502
    );
  }
}
