import type { Configuracion } from '../config/entorno.js';
import { licenciasAnthropic } from '../proveedores/anthropic.js';
import { licenciasCursor } from '../proveedores/cursor.js';
import { licenciasFigma } from '../proveedores/figma.js';
import { reposGithub, reposRecientes } from '../proveedores/github.js';
import { destinosMonitoreados } from '../proveedores/monitoreo.js';
import { crmOdoo } from '../proveedores/odoo.js';
import { desplieguesVercel } from '../proveedores/vercel.js';
import { enviarPorEmailJs } from '../acceso/acceso.js';
import { comprobarAplicacionMicrosoft } from '../proveedores/microsoft.js';

/**
 * Las integraciones que se configuran desde Ajustes.
 *
 * Cada una es un conjunto de variables de entorno: las mismas que documenta
 * `.env.example`. Capturarlas desde el portal no inventa otra forma de
 * configurar: lo guardado se pone encima del entorno y `leerConfiguracion`
 * lo lee igual. Por eso el catalogo habla de variables, no de campos.
 *
 * `probar` corre la misma consulta que usa la ruta del portal y resume en una
 * frase que paso; asi "Probar" en Ajustes prueba lo mismo que va a ver el
 * tablero, no una version light.
 */

export type TipoCampo =
  'texto' | 'secreto' | 'numero' | 'fecha' | 'lista' | 'largo';

export interface Campo {
  variable: string;
  etiqueta: string;
  tipo: TipoCampo;
  ayuda?: string;
  obligatoria?: boolean;
}

export interface Integracion {
  id: string;
  etiqueta: string;
  /** Con que `kind` del portal se corresponde. */
  kind: string;
  campos: Campo[];
  /** Corre la consulta real y describe en una frase lo que encontro. */
  probar: (config: Configuracion) => Promise<string>;
}

function exigir<T>(valor: T | undefined, que: string): T {
  if (valor === undefined) {
    throw new Error(`Falta ${que}.`);
  }
  return valor;
}

export const INTEGRACIONES: Integracion[] = [
  {
    id: 'github',
    etiqueta: 'GitHub',
    kind: 'github',
    campos: [
      {
        variable: 'GITHUB_TOKEN',
        etiqueta: 'Token',
        tipo: 'secreto',
        obligatoria: true,
        ayuda:
          'Token clásico con permiso "repo", o de grano fino con contents:read, pull_requests:read y checks:read.'
      },
      {
        variable: 'GITHUB_REPOS',
        etiqueta: 'Repositorios',
        tipo: 'lista',
        ayuda:
          'Como "propietario/repo", separados por coma. Vacío: los diez con cambios más recientes.'
      },
      {
        variable: 'GITHUB_LIMITE_PR',
        etiqueta: 'Pull requests por repositorio',
        tipo: 'numero',
        ayuda: 'Por omisión 10.'
      }
    ],
    probar: async (config) => {
      const github = exigir(config.github, 'el token de GitHub');
      const nombres =
        github.repos.length > 0 ? github.repos : await reposRecientes(github);
      const repos = await reposGithub(github);
      return `${repos.length} de ${nombres.length} repositorios leídos: ${repos
        .slice(0, 5)
        .map((r) => r.name)
        .join(', ')}${repos.length > 5 ? '…' : ''}.`;
    }
  },
  {
    id: 'anthropic',
    etiqueta: 'Claude',
    kind: 'anthropic',
    campos: [
      {
        variable: 'ANTHROPIC_ADMIN_KEY',
        etiqueta: 'Admin API key',
        tipo: 'secreto',
        obligatoria: true,
        ayuda:
          'sk-ant-admin…, de Settings → Admin keys en la consola. No es una llave normal de API.'
      },
      {
        variable: 'ANTHROPIC_ASIENTOS',
        etiqueta: 'Asientos de Claude Code',
        tipo: 'numero'
      },
      {
        variable: 'ANTHROPIC_COSTO_ASIENTOS',
        etiqueta: 'Costo mensual de los asientos',
        tipo: 'numero'
      },
      {
        variable: 'ANTHROPIC_RENUEVA_EN',
        etiqueta: 'Renueva el',
        tipo: 'fecha'
      }
    ],
    probar: async (config) => {
      const licencias = await licenciasAnthropic(
        exigir(config.anthropic, 'la Admin API key de Anthropic')
      );
      return `${licencias.length} licencias leídas de la Admin API.`;
    }
  },
  {
    id: 'cursor',
    etiqueta: 'Cursor',
    kind: 'cursor',
    campos: [
      {
        variable: 'CURSOR_API_KEY',
        etiqueta: 'Team API key',
        tipo: 'secreto',
        obligatoria: true,
        ayuda: 'Con permiso admin o usage.'
      },
      {
        variable: 'CURSOR_ASIENTOS',
        etiqueta: 'Asientos contratados',
        tipo: 'numero'
      },
      {
        variable: 'CURSOR_COSTO_MENSUAL',
        etiqueta: 'Costo mensual',
        tipo: 'numero'
      },
      {
        variable: 'CURSOR_SOLICITUDES_INCLUIDAS',
        etiqueta: 'Solicitudes incluidas',
        tipo: 'numero'
      },
      { variable: 'CURSOR_RENUEVA_EN', etiqueta: 'Renueva el', tipo: 'fecha' }
    ],
    probar: async (config) => {
      const licencias = await licenciasCursor(
        exigir(config.cursor, 'la Team API key de Cursor')
      );
      return `${licencias.length} licencias leídas de api.cursor.com.`;
    }
  },
  {
    id: 'figma',
    etiqueta: 'Figma',
    kind: 'figma',
    campos: [
      {
        variable: 'FIGMA_TOKEN',
        etiqueta: 'Token',
        tipo: 'secreto',
        obligatoria: true
      },
      {
        variable: 'FIGMA_TEAM_ID',
        etiqueta: 'Team ID',
        tipo: 'texto',
        obligatoria: true
      },
      {
        variable: 'FIGMA_ASIENTOS',
        etiqueta: 'Asientos contratados',
        tipo: 'numero',
        ayuda: 'Figma no lo publica por API; se captura aquí.'
      },
      {
        variable: 'FIGMA_COSTO_MENSUAL',
        etiqueta: 'Costo mensual',
        tipo: 'numero'
      },
      { variable: 'FIGMA_RENUEVA_EN', etiqueta: 'Renueva el', tipo: 'fecha' }
    ],
    probar: async (config) => {
      const licencias = await licenciasFigma(
        exigir(config.figma, 'el token y el Team ID de Figma')
      );
      const ocupados = licencias.reduce((n, l) => n + l.members.length, 0);
      return `${ocupados} asientos ocupados en el equipo.`;
    }
  },
  {
    id: 'vercel',
    etiqueta: 'Vercel',
    kind: 'vercel',
    campos: [
      {
        variable: 'VERCEL_TOKEN',
        etiqueta: 'Access token',
        tipo: 'secreto',
        obligatoria: true
      },
      {
        variable: 'VERCEL_TEAM_ID',
        etiqueta: 'Team ID',
        tipo: 'texto',
        ayuda: 'Vacío para la cuenta personal.'
      },
      {
        variable: 'VERCEL_LIMITE',
        etiqueta: 'Despliegues por consulta',
        tipo: 'numero',
        ayuda: 'Por omisión 20.'
      },
      {
        variable: 'VERCEL_PRESUPUESTO',
        etiqueta: 'Presupuesto mensual',
        tipo: 'numero'
      },
      { variable: 'VERCEL_GASTO', etiqueta: 'Gasto del mes', tipo: 'numero' },
      { variable: 'VERCEL_RENUEVA_EN', etiqueta: 'Renueva el', tipo: 'fecha' }
    ],
    probar: async (config) => {
      const despliegues = await desplieguesVercel(
        exigir(config.vercel, 'el token de Vercel')
      );
      return `${despliegues.length} despliegues leídos.`;
    }
  },
  {
    id: 'odoo',
    etiqueta: 'Odoo',
    kind: 'odoo',
    campos: [
      {
        variable: 'ODOO_URL',
        etiqueta: 'URL de la instancia',
        tipo: 'texto',
        obligatoria: true
      },
      {
        variable: 'ODOO_DB',
        etiqueta: 'Base de datos',
        tipo: 'texto',
        obligatoria: true
      },
      {
        variable: 'ODOO_USUARIO',
        etiqueta: 'Usuario',
        tipo: 'texto',
        obligatoria: true
      },
      {
        variable: 'ODOO_API_KEY',
        etiqueta: 'API key',
        tipo: 'secreto',
        obligatoria: true
      }
    ],
    probar: async (config) => {
      const crm = await crmOdoo(exigir(config.odoo, 'la conexión a Odoo'));
      return `${crm.oportunidades.length} oportunidades y ${crm.actividades.length} actividades leídas.`;
    }
  },
  {
    id: 'prometheus',
    etiqueta: 'Servidores (Prometheus)',
    kind: 'prometheus',
    campos: [
      {
        variable: 'PROMETHEUS_URL',
        etiqueta: 'Servidores (uno por línea: nombre|url)',
        tipo: 'largo',
        obligatoria: true,
        ayuda:
          'Un Prometheus por VPS (el kit central en cada uno) o uno que vea a varios. Por ejemplo: nexus-1|http://74.208.151.19:9090. Sin /api. Todos con el mismo usuario y contraseña. Guía: infra/vps-monitoreo/README.md.'
      },
      {
        variable: 'PROMETHEUS_USUARIO',
        etiqueta: 'Usuario (basic auth)',
        tipo: 'texto',
        ayuda: 'Si Prometheus pide usuario y contraseña (web.config.yml).'
      },
      {
        variable: 'PROMETHEUS_CONTRASENA',
        etiqueta: 'Contraseña',
        tipo: 'secreto'
      },
      {
        variable: 'PROMETHEUS_TOKEN',
        etiqueta: 'Bearer token',
        tipo: 'secreto',
        ayuda: 'Solo si va detrás de un proxy que pide token en vez de usuario.'
      },
      {
        variable: 'PROMETHEUS_ETIQUETA_NOMBRE',
        etiqueta: 'Etiqueta con el nombre del servidor',
        tipo: 'texto',
        ayuda:
          'Déjalo vacío. Es el NOMBRE de la etiqueta de prometheus.yml (por omisión "nombre"), no el nombre del servidor.'
      }
    ],
    probar: async (config) => {
      const { estadoServidores } = await import('../proveedores/prometheus.js');
      const lista = await estadoServidores(
        exigir(config.prometheus, 'la URL de Prometheus')
      );
      const arriba = lista.filter((v) => v.online).length;
      return lista.length === 0
        ? 'Prometheus responde, pero no hay ningún servidor con job "node" (node_exporter).'
        : `${lista.length} servidores, ${arriba} reportando; ${lista.reduce((n, v) => n + v.containers.length, 0)} contenedores.`;
    }
  },
  {
    id: 'monitoreo',
    etiqueta: 'Monitoreo',
    kind: 'monitor',
    campos: [
      {
        variable: 'MONITOREO_DESTINOS',
        etiqueta: 'Destinos a vigilar',
        tipo: 'largo',
        obligatoria: true,
        ayuda:
          'Uno por línea o separados por punto y coma: id|nombre|url|tipo|entorno. Tipo: sitio, api, servicio, proceso. Entorno: produccion, pruebas, desarrollo.'
      }
    ],
    probar: async (config) => {
      const destinos = await destinosMonitoreados(
        exigir(config.monitoreo, 'la lista de destinos')
      );
      const arriba = destinos.filter((d) => d.status === 'operativo').length;
      return `${destinos.length} destinos revisados, ${arriba} operativos.`;
    }
  }
];

INTEGRACIONES.push({
  id: 'microsoft',
  etiqueta: 'Microsoft (Entra ID)',
  kind: 'microsoft',
  campos: [
    {
      variable: 'MICROSOFT_CLIENT_ID',
      etiqueta: 'Client ID (Id. de aplicación)',
      tipo: 'texto',
      obligatoria: true
    },
    {
      variable: 'MICROSOFT_CLIENT_SECRET',
      etiqueta: 'Client secret',
      tipo: 'secreto',
      obligatoria: true,
      ayuda: 'El valor del secreto (no su ID), de Certificados y secretos.'
    },
    {
      variable: 'MICROSOFT_TENANT',
      etiqueta: 'Tenant',
      tipo: 'texto',
      ayuda:
        '"common" acepta cuentas de trabajo y personales (Outlook.com). El Id. de directorio limita a una organización.'
    }
  ],
  probar: async (config) => {
    const app = exigir(
      config.microsoftApp,
      'el client ID y el client secret de Entra ID'
    );
    return await comprobarAplicacionMicrosoft(app);
  }
});

INTEGRACIONES.push({
  id: 'google',
  etiqueta: 'Google (Gmail)',
  kind: 'google',
  campos: [
    {
      variable: 'GOOGLE_CLIENT_ID',
      etiqueta: 'Client ID',
      tipo: 'texto',
      obligatoria: true,
      ayuda:
        'Cliente OAuth "Aplicación web" en Google Cloud → APIs y servicios → Credenciales.'
    },
    {
      variable: 'GOOGLE_CLIENT_SECRET',
      etiqueta: 'Client secret',
      tipo: 'secreto',
      obligatoria: true,
      ayuda:
        'En el proyecto: habilitar Gmail API y Google Calendar API; en la pantalla de consentimiento, agregar el correo como usuario de prueba.'
    }
  ],
  probar: async (config) => {
    exigir(config.googleApp, 'el client ID y el client secret de Google');
    return 'Aplicación guardada. Conecta cada buzón de Gmail con "Conectar con Google" en Correo.';
  }
});

INTEGRACIONES.push({
  id: 'openrouter',
  etiqueta: 'Inteligencia artificial (OpenRouter)',
  kind: 'openrouter',
  campos: [
    {
      variable: 'OPENROUTER_API_KEY',
      etiqueta: 'API key',
      tipo: 'secreto',
      obligatoria: true,
      ayuda:
        'sk-or-…, de openrouter.ai → Keys. Una sola llave para todo lo que el portal resuelva con un modelo; el primer uso es clasificar el correo.'
    },
    {
      variable: 'OPENROUTER_MODEL',
      etiqueta: 'Modelo',
      tipo: 'texto',
      ayuda:
        'Elige uno de los recomendados (solo salen los que tu cuenta puede usar, con su precio) o escribe cualquier id de openrouter.ai/models. Por omisión openai/gpt-oss-120b.'
    },
    {
      variable: 'OPENROUTER_DIAS',
      etiqueta: 'Días hacia atrás',
      tipo: 'numero',
      ayuda: 'Cuántos días de correo se analizan (7 por omisión).'
    },
    {
      variable: 'OPENROUTER_MAXIMO',
      etiqueta: 'Correos por lectura',
      tipo: 'numero',
      ayuda:
        'Tope de correos nuevos que se mandan al modelo cada vez (40 por omisión).'
    }
  ],
  probar: async (config) => {
    const ia = exigir(config.ia, 'la API key de OpenRouter');
    const respuesta = await fetch('https://openrouter.ai/api/v1/models/user', {
      headers: { authorization: `Bearer ${ia.apiKey}` }
    });
    if (!respuesta.ok) {
      throw new Error(
        `OpenRouter respondió ${respuesta.status}: revisa la API key.`
      );
    }
    const datos = (await respuesta.json()) as { data?: { id: string }[] };
    const modelos = datos.data ?? [];
    const hay = modelos.some((m) => m.id === ia.modelo);
    return hay || modelos.length === 0
      ? `Llave válida. Modelo: ${ia.modelo}; ${ia.maximo} correos por lectura, ${ia.dias} días atrás.`
      : `Llave válida, pero el modelo "${ia.modelo}" no aparece entre los ${modelos.length} disponibles: revisa el id en openrouter.ai/models.`;
  }
});

INTEGRACIONES.push({
  id: 'fireflies',
  etiqueta: 'Fireflies (notas de juntas)',
  kind: 'fireflies',
  campos: [
    {
      variable: 'FIREFLIES_API_KEY',
      etiqueta: 'API key',
      tipo: 'secreto',
      obligatoria: true,
      ayuda:
        'En app.fireflies.ai → Settings → Developer settings → API key. Con ella cada junta del calendario se empareja con su transcripción y los acuerdos salen de las notas reales.'
    }
  ],
  probar: async (config) => {
    const { transcripcionesRecientes } =
      await import('../proveedores/fireflies.js');
    const lista = await transcripcionesRecientes(
      exigir(config.fireflies, 'la API key de Fireflies'),
      30,
      10
    );
    return `${lista.length} transcripciones en los últimos 30 días${lista[0] ? `; la última: "${lista[0].titulo}"` : ''}.`;
  }
});

INTEGRACIONES.push({
  id: 'telegram',
  etiqueta: 'Telegram (dictar por chat)',
  kind: 'telegram',
  campos: [
    {
      variable: 'TELEGRAM_BOT_TOKEN',
      etiqueta: 'Token del bot',
      tipo: 'secreto',
      obligatoria: true,
      ayuda:
        'Crea el bot con @BotFather en Telegram (/newbot) y pega el token. Al probar, el puente registra el webhook solo.'
    },
    {
      variable: 'TELEGRAM_CHATS',
      etiqueta: 'Chats autorizados',
      tipo: 'texto',
      ayuda:
        'Ids de chat separados por coma. Escríbele cualquier cosa al bot y te responde tu id para ponerlo aquí.'
    }
  ],
  probar: async (config) => {
    const { quienEsElBot, registrarWebhook } =
      await import('../proveedores/telegram.js');
    const telegram = exigir(config.telegram, 'el token del bot de Telegram');
    const bot = await quienEsElBot(telegram);
    await registrarWebhook(telegram, `${config.urlPublica}/telegram/webhook`);
    return `Bot ${bot} listo y webhook registrado. ${telegram.chats.length === 0 ? 'Escríbele al bot para obtener tu id de chat y autorízalo aquí.' : `${telegram.chats.length} chat(s) autorizados.`}`;
  }
});

INTEGRACIONES.push({
  id: 'acceso',
  etiqueta: 'Acceso al portal',
  kind: 'acceso',
  campos: [
    {
      variable: 'ACCESO_CORREOS',
      etiqueta: 'Correos que pueden entrar',
      tipo: 'lista',
      obligatoria: true,
      ayuda:
        'Separados por coma. A cada uno le llega su código de seis dígitos.'
    },
    {
      variable: 'ACCESO_MAESTRA',
      etiqueta: 'Clave maestra',
      tipo: 'secreto',
      ayuda:
        'Escrita en el campo de correo o en el del código, entra al portal sin código (como el primer correo autorizado). Para cuando el correo no llega.'
    },
    {
      variable: 'EMAILJS_SERVICE_ID',
      etiqueta: 'EmailJS · Service ID',
      tipo: 'texto',
      obligatoria: true
    },
    {
      variable: 'EMAILJS_TEMPLATE_ID',
      etiqueta: 'EmailJS · Template ID',
      tipo: 'texto',
      obligatoria: true,
      ayuda:
        'La plantilla "General_Contact Us" de Total One: {{title}} lleva "Access Monitor" y {{{html_content}}} el código. Los nombres de las landings también van, por si se cambia.'
    },
    {
      variable: 'EMAILJS_PUBLIC_KEY',
      etiqueta: 'EmailJS · Public key',
      tipo: 'texto',
      obligatoria: true
    },
    {
      variable: 'EMAILJS_PRIVATE_KEY',
      etiqueta: 'EmailJS · Private key',
      tipo: 'secreto',
      obligatoria: true,
      ayuda:
        'Account → Security. Sin ella EmailJS rechaza los envíos desde un servidor.'
    }
  ],
  probar: async (config) => {
    const acceso = exigir(
      config.acceso,
      'la configuración de EmailJS y la lista de correos'
    );
    const destino = acceso.correos[0] as string;
    await enviarPorEmailJs(acceso, destino, '', true);
    return `Correo de prueba enviado a ${destino}. Los códigos reales llegan al pedir acceso.`;
  }
});

export function integracion(id: string): Integracion | undefined {
  return INTEGRACIONES.find((i) => i.id === id);
}
