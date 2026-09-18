import type { ConfiguracionIa } from '../config/entorno.js';
import type { Person, TaskPriority } from '../nucleo/contrato.js';
import { personaDe } from './acuerdos.js';
import {
  CONTEXTO_EMPRESAS,
  EMPRESAS,
  comoJson,
  fechaDe,
  preguntar,
  texto1
} from './modelo.js';
import { diaLocal } from './tablero.js';

/**
 * Dictado: texto libre (hablado o escrito) que se convierte en cosas del
 * sistema. "Junta con Felipe el lunes a las 12 en el Italian Coffee, y que
 * Efrén revise el alta de proveedores de Vanguardia, es urgente" se vuelve
 * dos pendientes con fecha, empresa, prioridad y responsable.
 *
 * Con modelo lo interpreta la IA. Sin modelo hay un interprete por reglas
 * mas modesto: separa por renglones o por "y que", reconoce empresa,
 * prioridad, dias de la semana, "hoy" y "mañana", horas y nombres del
 * equipo. Lo que sale son PROPUESTAS: el portal las enseña para corregir o
 * quitar antes de guardar.
 */
export interface Propuesta {
  titulo: string;
  descripcion?: string;
  /** Personal (no del negocio) o del negocio. */
  personal: boolean;
  empresa?: string;
  prioridad: TaskPriority;
  venceEn?: string;
  responsable?: string;
  persona?: Person;
  proyecto?: string;
  /** Parece una junta (tiene hora y habla de reunirse); el portal ofrece agendarla. */
  esJunta?: boolean;
  lugar?: string;
  /** Buzon (Microsoft) en cuyo calendario crearla; lo pone el portal. */
  agendarEn?: string;
  /** Quien lo entendio: el modelo o las reglas. */
  origen: 'ia' | 'reglas';
}

export async function interpretarDictado(
  config: ConfiguracionIa | undefined,
  texto: string,
  equipo: Person[],
  ahora = new Date()
): Promise<Propuesta[]> {
  const limpio = texto.replace(/\s+/g, ' ').trim();
  if (!limpio) {
    return [];
  }
  if (!config) {
    return interpretarPorReglas(texto, equipo, ahora);
  }
  const salida = await preguntar(config, {
    uso: 'dictado',
    sistema: `${CONTEXTO_EMPRESAS}\nQuien te habla dicta pendientes, juntas y recordatorios en lenguaje natural, a veces varios de corrido. Conviértelos en elementos del sistema. Responde SOLO JSON: {"elementos":[{"titulo":"verbo + objeto o 'Junta con X · lugar', máx. 90 caracteres","descripcion":"el detalle que dictó, tal cual, o null","personal":false,"empresa":"Itech Dev|Dealer Solutions|NexusQTech|OperativAI|null","prioridad":"baja|media|alta|urgente","venceEn":"YYYY-MM-DDTHH:mm en hora de México o YYYY-MM-DD o null","responsable":"nombre o correo de quien lo hace, o null","proyecto":"cliente o proyecto mencionado (Vanguardia, Birdom…) o null","esJunta":false,"lugar":"lugar físico o 'Teams' si lo dice, o null"}]}. "esJunta" es true cuando es una reunión, cita o llamada con alguien a una hora. "personal" es true solo cuando claramente no es del trabajo (médico, familia, casa). Resuelve fechas relativas con la fecha de hoy; 'el martes' es el próximo martes. Si dice 'para mí' o no dice quién, responsable null. No inventes datos que no dijo.`,
    usuario: JSON.stringify({
      hoy: diaLocal(ahora),
      diaSemana: new Date(ahora).toLocaleDateString('es-MX', {
        weekday: 'long',
        timeZone: 'America/Mexico_City'
      }),
      equipo: equipo.map((p) => `${p.name} <${p.email ?? ''}>`),
      dictado: limpio.slice(0, 4000)
    }),
    json: true,
    maxTokens: 2000
  });
  const parseado = comoJson<{ elementos?: Partial<Propuesta>[] }>(salida);
  return (Array.isArray(parseado.elementos) ? parseado.elementos : [])
    .map((e): Propuesta | undefined => {
      const titulo = texto1(e.titulo);
      if (!titulo) {
        return undefined;
      }
      const responsable = texto1(e.responsable);
      return {
        titulo: titulo.slice(0, 90),
        descripcion: texto1(e.descripcion),
        personal: e.personal === true,
        empresa: EMPRESAS.find((x) => x === e.empresa),
        prioridad:
          (['baja', 'media', 'alta', 'urgente'] as const).find(
            (p) => p === e.prioridad
          ) ?? 'media',
        venceEn: fechaHora(e.venceEn),
        responsable,
        persona: responsable ? personaDe(responsable, equipo) : undefined,
        proyecto: texto1(e.proyecto),
        esJunta: e.esJunta === true,
        lugar: texto1(e.lugar),
        origen: 'ia'
      };
    })
    .filter((p): p is Propuesta => p !== undefined);
}

/** "YYYY-MM-DDTHH:mm" en hora de Mexico, o solo fecha (mediodia). */
function fechaHora(valor: unknown): string | undefined {
  if (typeof valor !== 'string') {
    return undefined;
  }
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(valor);
  if (m) {
    return new Date(`${m[1]}T${m[2]}:${m[3]}:00-06:00`).toISOString();
  }
  return fechaDe(valor);
}

// --- Reglas, para cuando no hay modelo ---

const DIAS = [
  'domingo',
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'sabado'
];

const EMPRESA_POR_PALABRA: [RegExp, string][] = [
  [/\bitech\b/i, 'Itech Dev'],
  [/\bdealer\b/i, 'Dealer Solutions'],
  [/\bnexus/i, 'NexusQTech'],
  [/\boperativ/i, 'OperativAI']
];

const CLIENTES = ['Vanguardia', 'Birdom', 'AutoDeal'];

export function interpretarPorReglas(
  texto: string,
  equipo: Person[],
  ahora = new Date()
): Propuesta[] {
  const frases = texto
    .split(/\n+|;|\.\s+|\s+y que\s+|\s+también\s+|\s+ademas\s+|\s+además\s+/i)
    .map((f) => f.trim())
    .filter((f) => f.length > 3);
  return frases.map((frase): Propuesta => {
    const sinAcentos = frase.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const empresa = EMPRESA_POR_PALABRA.find(([re]) => re.test(frase))?.[1];
    const prioridad: TaskPriority = /urgente|ya mismo|hoy mismo/.test(
      sinAcentos
    )
      ? 'urgente'
      : /alta|importante|prioridad/.test(sinAcentos)
        ? 'alta'
        : /baja|cuando se pueda|sin prisa/.test(sinAcentos)
          ? 'baja'
          : 'media';
    const persona = equipo.find((p) => {
      const nombre =
        p.name
          .split(' ')[0]
          ?.normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .toLowerCase() ?? '';
      return (
        nombre.length > 2 && new RegExp(`\\b${nombre}\\b`).test(sinAcentos)
      );
    });
    const personal =
      /\b(dentista|doctor|medico|familia|casa|escuela|hijos?|coche|carro)\b/.test(
        sinAcentos
      );
    return {
      titulo: capitalizar(
        frase.replace(/^(y que|que|hay que|tengo que|pendiente:?)\s+/i, '')
      ).slice(0, 90),
      descripcion: frase,
      personal,
      empresa: personal ? undefined : empresa,
      prioridad,
      venceEn: fechaDeFrase(sinAcentos, ahora),
      responsable: persona?.name,
      persona,
      proyecto: CLIENTES.find((c) => sinAcentos.includes(c.toLowerCase())),
      esJunta: /\b(junta|reunion|cita|llamada|call)\b/.test(sinAcentos),
      lugar: /\ben (el |la |los |las )?([A-Z][^,.]{2,40})/
        .exec(frase)?.[2]
        ?.trim(),
      origen: 'reglas'
    };
  });
}

/** "el martes a las 12", "hoy", "mañana a las 5 pm" → ISO, o nada. */
export function fechaDeFrase(frase: string, ahora: Date): string | undefined {
  const hoy = new Date(
    ahora.toLocaleString('en-US', { timeZone: 'America/Mexico_City' })
  );
  let dias: number | undefined;
  if (/\bhoy\b/.test(frase)) {
    dias = 0;
  } else if (/\bmanana\b/.test(frase)) {
    dias = 1;
  } else {
    const dia = DIAS.findIndex((d) => new RegExp(`\\b${d}\\b`).test(frase));
    if (dia >= 0) {
      dias = (dia - hoy.getDay() + 7) % 7 || 7;
    }
  }
  if (dias === undefined) {
    return undefined;
  }
  const hora =
    /a las? (\d{1,2})(?::(\d{2}))?\s*(pm|am|de la tarde|de la noche)?/.exec(
      frase
    );
  let h = 12;
  let m = 0;
  if (hora) {
    h = Number(hora[1]);
    m = Number(hora[2] ?? 0);
    if ((hora[3] === 'pm' || hora[3]?.startsWith('de la')) && h < 12) {
      h += 12;
    }
  }
  const fecha = new Date(hoy);
  fecha.setDate(hoy.getDate() + dias);
  const y = fecha.getFullYear();
  const mo = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return new Date(
    `${y}-${mo}-${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-06:00`
  ).toISOString();
}

function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
