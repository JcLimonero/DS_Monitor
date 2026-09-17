import type { ConfiguracionIa } from '../config/entorno.js';
import type { Alerta } from './alertas.js';
import {
  CONTEXTO_EMPRESAS,
  comoJson,
  enHorario,
  preguntar,
  texto1
} from './modelo.js';
import {
  abiertos,
  diaLocal,
  diasHasta,
  juntasDelDia,
  paraHoy,
  vencidos,
  type Tablero
} from './tablero.js';

/**
 * El resumen del dia para el carrusel: tres o cuatro lineas que digan lo que
 * importa hoy. Una llamada al modelo por dia (o cuando alguien lo pide), con
 * un tablero ya reducido a cifras y a los diez o veinte renglones que pesan.
 */
export interface ResumenDia {
  dia: string;
  lineas: string[];
  /** Un titular de seis u ocho palabras para la pantalla. */
  titular: string;
  generadoEn: string;
}

/** Lo del tablero que vale la pena contar, compacto para el modelo. */
export function contextoDelDia(
  tablero: Tablero,
  alertas: Alerta[],
  ahora: Date
): Record<string, unknown> {
  const pend = abiertos(tablero.pendientes);
  const venc = vencidos(tablero.pendientes, ahora);
  const hoy = paraHoy(tablero.pendientes, ahora);
  const urgentes = pend.filter((t) => t.priority === 'urgente');
  const juntas = juntasDelDia(tablero.juntas, ahora);
  const porEmpresa: Record<string, number> = {};
  for (const t of pend) {
    const e = t.company ?? 'Sin empresa';
    porEmpresa[e] = (porEmpresa[e] ?? 0) + 1;
  }
  const caidos = tablero.monitoreo.filter((m) => m.status === 'caido');
  const fallidos = tablero.despliegues.filter(
    (d) =>
      d.state === 'error' &&
      Date.parse(d.createdAt) > ahora.getTime() - 86_400_000
  );
  const dominios = tablero.dominios
    .map((d) => ({ nombre: d.nombre, dias: diasHasta(d.venceEn, ahora) }))
    .filter((d) => d.dias <= 30)
    .sort((a, b) => a.dias - b.dias);
  const cita = (t: (typeof pend)[number]) =>
    `${t.title}${t.company ? ` (${t.company})` : ''}${t.dueDate ? `, vence ${diaLocal(t.dueDate)}` : ''}`;
  return {
    hoy: diaLocal(ahora),
    pendientes: {
      abiertos: pend.length,
      vencidos: venc.length,
      paraHoy: hoy.length,
      urgentes: urgentes.length,
      porEmpresa
    },
    vencidosLista: venc.slice(0, 8).map(cita),
    paraHoyLista: hoy.slice(0, 8).map(cita),
    urgentesLista: urgentes.slice(0, 6).map(cita),
    juntas: juntas.map(
      (j) =>
        `${enHorario(j.start).split(', ').pop()} ${j.title}${j.attendees.length ? ` (${j.attendees.length} personas)` : ''}`
    ),
    juntasSinHomologar: tablero.juntasSinHomologar
      .slice(0, 5)
      .map(
        (u) =>
          `${u.junta.title} (${diaLocal(u.junta.start)}) falta en ${u.faltaEn.join(', ')}`
      ),
    sitiosCaidos: caidos.map((m) => m.name),
    desplieguesFallidos: fallidos.map((d) => d.project),
    dominiosPorVencer: dominios,
    alertas: alertas.slice(0, 8).map((a) => a.texto ?? a.titulo),
    fuentesConError: tablero.errores
  };
}

export async function resumirDia(
  config: ConfiguracionIa,
  tablero: Tablero,
  alertas: Alerta[],
  ahora = new Date()
): Promise<ResumenDia> {
  const contexto = contextoDelDia(tablero, alertas, ahora);
  const texto = await preguntar(config, {
    sistema: `${CONTEXTO_EMPRESAS}\nEscribes el resumen del día para una pantalla que el equipo ve de reojo. Te doy el estado del tablero en JSON. Responde SOLO JSON: {"titular":"6 a 8 palabras, lo más importante del día","lineas":["...","...","..."]} con 3 o 4 líneas de máximo 110 caracteres, cada una un hecho concreto con cifras y nombres (qué vence, qué junta, qué está caído, qué alerta). Nada de saludos ni de relleno; si todo está en orden, dilo en una línea.`,
    usuario: JSON.stringify(contexto),
    json: true,
    maxTokens: 600
  });
  const salida = comoJson<{ titular?: unknown; lineas?: unknown[] }>(texto);
  const lineas = (Array.isArray(salida.lineas) ? salida.lineas : [])
    .map(texto1)
    .filter((l): l is string => !!l)
    .slice(0, 4);
  return {
    dia: diaLocal(ahora),
    titular: texto1(salida.titular) ?? 'Resumen del día',
    lineas: lineas.length ? lineas : ['Sin novedades que reportar.'],
    generadoEn: ahora.toISOString()
  };
}
