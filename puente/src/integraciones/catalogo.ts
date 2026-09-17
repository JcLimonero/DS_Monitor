import type { Configuracion } from '../config/entorno.js';
import { licenciasAnthropic } from '../proveedores/anthropic.js';
import { licenciasCursor } from '../proveedores/cursor.js';
import { licenciasFigma } from '../proveedores/figma.js';
import { reposGithub, reposRecientes } from '../proveedores/github.js';
import { destinosMonitoreados } from '../proveedores/monitoreo.js';
import { crmOdoo } from '../proveedores/odoo.js';
import { desplieguesVercel } from '../proveedores/vercel.js';
import { enviarPorEmailJs } from '../acceso/acceso.js';

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
        'La plantilla de siempre: el correo lleva título "Access Monitor" y el código va en {{message}} y en {{code}}.'
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
    await enviarPorEmailJs(acceso, destino, '000000');
    return `Correo de prueba enviado a ${destino} con el código 000000 (no sirve para entrar).`;
  }
});

export function integracion(id: string): Integracion | undefined {
  return INTEGRACIONES.find((i) => i.id === id);
}
