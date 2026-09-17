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

  /** Cambia un codigo por una sesion. */
  async entrar(correoCrudo: string, codigoCrudo: string): Promise<Sesion> {
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

/**
 * El correo con el codigo, por la API de EmailJS.
 *
 * Desde un servidor EmailJS exige la llave privada ademas de la publica. Los
 * parametros de la plantilla van con varios nombres a la vez (title, subject,
 * message, code, to_email, email...) para que la plantilla que ya existe los
 * tome sin tener que editarla.
 */
export async function enviarPorEmailJs(
  config: ConfiguracionAcceso,
  correo: string,
  codigo: string,
  /** True para el correo de prueba de Ajustes: no lleva codigo. */
  prueba = false
): Promise<void> {
  const mensaje = prueba
    ? 'Correo de prueba: el envío de códigos de acceso a DS Monitor funciona. Los códigos reales son seis dígitos al azar y llegan al pedir acceso.'
    : `Tu código de acceso a DS Monitor es ${codigo}. Vence en ${CODIGO_MINUTOS} minutos.`;
  const cuerpo = prueba
    ? `<p>${mensaje}</p>`
    : `<p>Tu código de acceso a <strong>DS Monitor</strong> es</p>` +
      `<p style="font-size:28px;letter-spacing:6px;font-family:monospace"><strong>${codigo}</strong></p>` +
      `<p>Vence en ${CODIGO_MINUTOS} minutos. Si no pediste entrar, ignora este correo.</p>`;
  const respuesta = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      service_id: config.serviceId,
      template_id: config.templateId,
      user_id: config.publicKey,
      accessToken: config.privateKey,
      template_params: {
        // La plantilla "General_Contact Us" de Total One: {{title}} es el
        // asunto, {{{html_content}}} el cuerpo, {{to_email}} el destinatario,
        // {{name}} el remitente y {{email}} el Responder a. Los demas nombres
        // van por si la plantilla cambia a la de las landings.
        title: 'Access Monitor',
        subject: 'Access Monitor',
        html_content: cuerpo,
        to_email: correo,
        email: correo,
        reply_to: correo,
        cc_email: '',
        name: 'DS Monitor',
        from_name: 'DS Monitor',
        origen: 'Access Monitor',
        area_interes: 'Access Monitor',
        comentarios: mensaje,
        message: mensaje,
        code: codigo
      }
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
