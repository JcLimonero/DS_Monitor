import type { ConfiguracionIa } from '../config/entorno.js';
import type { Person, TaskPriority } from '../nucleo/contrato.js';
import { personaDe } from './acuerdos.js';
import {
  contextoEmpresas,
  empresaPorPalabra,
  empresaValida,
  opcionesEmpresa
} from '../datos/empresas.js';
import { comoJson, fechaDe, preguntar, texto1 } from './modelo.js';
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
  /** venceEn trae hora dicha por quien dicta, no el mediodia por omision. */
  conHora?: boolean;
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
    sistema: `${contextoEmpresas()}\nQuien te habla dicta pendientes, juntas y recordatorios en lenguaje natural, a veces varios de corrido. Conviértelos en elementos del sistema. Responde SOLO JSON: {"elementos":[{"titulo":"verbo + objeto o 'Junta · lugar', máx. 90 caracteres","descripcion":"el detalle que dictó, sin el 'con <persona del equipo>', o null","personal":false,"empresa":"${opcionesEmpresa()}","prioridad":"baja|media|alta|urgente","venceEn":"YYYY-MM-DDTHH:mm en hora de México o YYYY-MM-DD o null","responsable":"nombre o correo de quien lo hace, o null","proyecto":"cliente o proyecto mencionado (Vanguardia, Birdom…) o null","esJunta":false,"lugar":"lugar físico o 'Teams' si lo dice, o null"}]}. "esJunta" es true cuando es una reunión, cita o llamada con alguien a una hora. "personal" es true solo cuando claramente no es del trabajo (médico, familia, casa). Resuelve fechas relativas con la fecha de hoy; 'el martes' es el próximo martes. Si dice 'para mí' o no dice quién, responsable null. Si dice "con <alguien del equipo>" (el arreglo de equipo que te paso), ESA persona es el responsable: no la dejes en el título ni en la descripción. Si "con X" no coincide con nadie del equipo, déjalo como está (es un cliente o un tercero). No inventes datos que no dijo.`,
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
      return aplicarConAlguien(
        {
          titulo: titulo.slice(0, 90),
          descripcion: texto1(e.descripcion),
          personal: e.personal === true,
          empresa: empresaValida(e.empresa),
          prioridad:
            (['baja', 'media', 'alta', 'urgente'] as const).find(
              (p) => p === e.prioridad
            ) ?? 'media',
          venceEn: fechaHora(e.venceEn),
          conHora: tieneHora(e.venceEn),
          responsable,
          persona: responsable ? personaDe(responsable, equipo) : undefined,
          proyecto: texto1(e.proyecto),
          esJunta: e.esJunta === true,
          lugar: texto1(e.lugar),
          origen: 'ia'
        },
        equipo
      );
    })
    .filter((p): p is Propuesta => p !== undefined);
}

/** Si el modelo devolvio fecha con hora ("YYYY-MM-DDTHH:mm"). */
function tieneHora(valor: unknown): boolean {
  return (
    typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(valor)
  );
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
    const empresa = empresaPorPalabra(frase);
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
    return aplicarConAlguien(
      {
        titulo: capitalizar(
          frase.replace(/^(y que|que|hay que|tengo que|pendiente:?)\s+/i, '')
        ).slice(0, 90),
        descripcion: frase,
        personal,
        empresa: personal ? undefined : empresa,
        prioridad,
        venceEn: fechaDeFrase(sinAcentos, ahora),
        conHora: HORA_EN_FRASE.test(sinAcentos),
        responsable: persona?.name,
        persona,
        proyecto: CLIENTES.find((c) => sinAcentos.includes(c.toLowerCase())),
        esJunta: /\b(junta|reunion|cita|llamada|call)\b/.test(sinAcentos),
        lugar: /\ben (el |la |los |las )?([A-Z][^,.]{2,40})/
          .exec(frase)?.[2]
          ?.trim(),
        origen: 'reglas'
      },
      equipo
    );
  });
}

/**
 * "…con Marco Ramos" en un audio: si Marco está en el equipo, es el
 * responsable y se quita del título y de la descripción. Si no hay
 * coincidencia (un cliente, un tercero) se deja el texto como estaba.
 * No pisa un responsable que ya salió de "que Efrén revise…".
 */
export function aplicarConAlguien(
  propuesta: Propuesta,
  equipo: Person[]
): Propuesta {
  const cuerpo = `${propuesta.titulo} ${propuesta.descripcion ?? ''}`;
  const porQue = personaPorQue(cuerpo, equipo);
  const enTitulo = personaDichaCon(propuesta.titulo, equipo);
  const enDesc = personaDichaCon(propuesta.descripcion ?? '', equipo);
  const porCon = enTitulo?.persona ?? enDesc?.persona;

  // "que Efrén revise … con Marco": Efrén manda; no se toca el "con".
  if (porQue && porCon && porQue.id !== porCon.id) {
    return { ...propuesta, persona: porQue, responsable: porQue.name };
  }

  const persona = porQue ?? porCon;
  if (!persona) {
    return propuesta;
  }
  if (!porQue && propuesta.persona && propuesta.persona.id !== persona.id) {
    return propuesta;
  }

  const titulo =
    enTitulo && enTitulo.persona.id === persona.id
      ? quitarCon(propuesta.titulo, enTitulo.dicho)
      : propuesta.titulo;
  const descripcion = propuesta.descripcion
    ? enDesc && enDesc.persona.id === persona.id
      ? quitarCon(propuesta.descripcion, enDesc.dicho)
      : enTitulo && enTitulo.persona.id === persona.id
        ? quitarCon(propuesta.descripcion, enTitulo.dicho)
        : propuesta.descripcion
    : undefined;
  return {
    ...propuesta,
    persona,
    responsable: persona.name,
    titulo: (titulo || propuesta.titulo).slice(0, 90),
    descripcion: descripcion || undefined
  };
}

/** Artículos y posesivos: "con el cliente" no es un nombre. */
const NO_ES_NOMBRE =
  /^(el|la|los|las|un|una|unos|unas|mi|mis|su|sus|este|esta|estos|estas)$/i;

/** "que Efrén revise": el de "que + nombre" manda sobre un "con" de otro. */
function personaPorQue(texto: string, equipo: Person[]): Person | undefined {
  return personaTrasPalabra(texto, /\bque\s+/gi, equipo)?.persona;
}

function personaDichaCon(
  texto: string,
  equipo: Person[]
): { persona: Person; dicho: string } | undefined {
  return personaTrasPalabra(texto, /\bcon\s+/gi, equipo);
}

/**
 * Tras "con"/"que" solo cuenta un nombre del equipo como prefijo (nombre
 * completo o nombre de pila, token entero). No "Marco el lunes" ni "datos
 * de Marco".
 */
function personaTrasPalabra(
  texto: string,
  ancla: RegExp,
  equipo: Person[]
): { persona: Person; dicho: string } | undefined {
  if (!texto.trim() || equipo.length === 0) {
    return undefined;
  }
  let m: RegExpExecArray | null;
  while ((m = ancla.exec(texto))) {
    const resto = texto.slice(m.index + m[0].length);
    const palabras = resto
      .split(/[\s,.;:]+/)
      .filter(Boolean)
      .slice(0, 4);
    if (palabras[0] && NO_ES_NOMBRE.test(palabras[0])) {
      continue;
    }
    const coincidencias: { persona: Person; dicho: string }[] = [];
    for (const p of equipo) {
      const dicho = prefijoDeNombre(palabras, p, equipo);
      if (dicho) {
        coincidencias.push({ persona: p, dicho });
      }
    }
    coincidencias.sort(
      (a, b) => b.dicho.split(/\s+/).length - a.dicho.split(/\s+/).length
    );
    if (coincidencias[0]) {
      return coincidencias[0];
    }
  }
  return undefined;
}

function prefijoDeNombre(
  palabras: string[],
  persona: Person,
  equipo: Person[]
): string | undefined {
  if (palabras.length === 0) {
    return undefined;
  }
  const tokensNombre = clave(persona.name).split(/\s+/).filter(Boolean);
  const tokensDicho = palabras.map(clave);
  if (
    tokensNombre.length > 0 &&
    tokensNombre.length <= tokensDicho.length &&
    tokensNombre.every((t, i) => t === tokensDicho[i])
  ) {
    return palabras.slice(0, tokensNombre.length).join(' ');
  }
  const pila = tokensNombre[0];
  if (!pila || pila.length < 3 || tokensDicho[0] !== pila) {
    return undefined;
  }
  const homonimos = equipo.filter(
    (p) => clave(p.name).split(/\s+/)[0] === pila
  );
  return homonimos.length === 1 ? palabras[0] : undefined;
}

function clave(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function quitarCon(texto: string, dicho: string): string {
  return texto
    .replace(new RegExp(`\\s*\\bcon\\s+${escaparRegex(dicho)}\\b`, 'gi'), '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();
}

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** "el martes a las 12", "hoy", "mañana a las 5 pm" → ISO, o nada. */
const HORA_EN_FRASE =
  /a las? (\d{1,2})(?::(\d{2}))?\s*(pm|am|de la tarde|de la noche)?/;

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
  const hora = HORA_EN_FRASE.exec(frase);
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
