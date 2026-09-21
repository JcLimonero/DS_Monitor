import type { ConfiguracionIa } from '../config/entorno.js';
import type { Dominio } from '../datos/dominios.js';
import type { LicenseUsage } from '../nucleo/contrato.js';
import { contextoEmpresas } from '../datos/empresas.js';
import { comoJson, preguntar, texto1 } from './modelo.js';
import { diasHasta } from './tablero.js';

/**
 * Anomalias en licencias y dominios.
 *
 * Aqui no hace falta un modelo para detectar: son reglas. Un cargo que sube
 * respecto al ultimo registrado, la misma suscripcion cobrada en dos buzones,
 * una licencia con costo y sin uso, un dominio que vence sin renovacion
 * automatica. El modelo solo redacta el aviso en lenguaje claro, y si no hay
 * modelo el aviso sale igual, mas seco.
 */

export interface Alerta {
  id: string;
  tipo: 'sube' | 'duplicada' | 'sin_uso' | 'dominio' | 'renueva';
  gravedad: 'aviso' | 'grave';
  titulo: string;
  detalle: string;
  /** Lo que la IA redacto encima del detalle, si hubo modelo. */
  texto?: string;
  accountId?: string;
  producto: string;
}

/** Costo por licencia y mes, para comparar contra el anterior. */
export type HistorialCostos = Record<string, { mes: string; costo: number }[]>;

const SUBIDA_MINIMA = 0.15;
const DIAS_AVISO_DOMINIO = 30;
const DIAS_AVISO_RENOVACION = 7;
const MESES_HISTORIAL = 13;

/** Llave de una licencia que no cambia entre lecturas. */
export function llaveDeLicencia(l: LicenseUsage): string {
  return `${l.accountId}:${l.provider}:${l.product.toLowerCase()}`;
}

/**
 * Registra el costo del mes de cada licencia. Devuelve el historial nuevo;
 * quien llama lo guarda.
 */
export function registrarCostos(
  historial: HistorialCostos,
  licencias: LicenseUsage[],
  ahora: Date
): HistorialCostos {
  const mes = ahora.toISOString().slice(0, 7);
  const nuevo: HistorialCostos = { ...historial };
  for (const l of licencias) {
    if (l.cost === undefined || l.cost <= 0) {
      continue;
    }
    const llave = llaveDeLicencia(l);
    const previos = (nuevo[llave] ?? []).filter((p) => p.mes !== mes);
    nuevo[llave] = [...previos, { mes, costo: l.cost }].slice(-MESES_HISTORIAL);
  }
  return nuevo;
}

export function detectarAlertas(
  licencias: LicenseUsage[],
  dominios: Dominio[],
  historial: HistorialCostos,
  ahora: Date
): Alerta[] {
  const alertas: Alerta[] = [];
  const mes = ahora.toISOString().slice(0, 7);

  // Cargos que suben respecto al mes anterior registrado.
  for (const l of licencias) {
    if (l.cost === undefined || l.cost <= 0) {
      continue;
    }
    const previos = (historial[llaveDeLicencia(l)] ?? []).filter(
      (p) => p.mes < mes
    );
    const anterior = previos[previos.length - 1];
    if (anterior && anterior.costo > 0) {
      const cambio = (l.cost - anterior.costo) / anterior.costo;
      if (cambio >= SUBIDA_MINIMA) {
        alertas.push({
          id: `sube:${llaveDeLicencia(l)}`,
          tipo: 'sube',
          gravedad: cambio >= 0.5 ? 'grave' : 'aviso',
          titulo: `${l.product} subió ${Math.round(cambio * 100)} %`,
          detalle: `De ${dinero(anterior.costo, l.currency)} (${anterior.mes}) a ${dinero(l.cost, l.currency)}.`,
          accountId: l.accountId,
          producto: l.product
        });
      }
    }
  }

  // La misma suscripcion en mas de una cuenta.
  const porProducto = new Map<string, LicenseUsage[]>();
  for (const l of licencias) {
    const k = l.product.toLowerCase().replace(/\s+/g, ' ').trim();
    porProducto.set(k, [...(porProducto.get(k) ?? []), l]);
  }
  for (const [, lista] of porProducto) {
    const cuentas = new Set(lista.map((l) => l.accountId));
    if (cuentas.size > 1 && lista.some((l) => (l.cost ?? 0) > 0)) {
      const l = lista[0] as LicenseUsage;
      alertas.push({
        id: `duplicada:${l.product.toLowerCase()}`,
        tipo: 'duplicada',
        gravedad: 'aviso',
        titulo: `${l.product} se cobra en ${cuentas.size} cuentas`,
        detalle: [...cuentas].join(', '),
        producto: l.product
      });
    }
  }

  // Con costo y sin uso reportado (solo donde la unidad mide uso real).
  for (const l of licencias) {
    if (
      (l.cost ?? 0) > 0 &&
      l.unit !== 'dinero' &&
      l.limit !== undefined &&
      l.limit > 0 &&
      l.used === 0
    ) {
      alertas.push({
        id: `sin_uso:${llaveDeLicencia(l)}`,
        tipo: 'sin_uso',
        gravedad: 'aviso',
        titulo: `${l.product} se paga y no se usa`,
        detalle: `${dinero(l.cost as number, l.currency)} al periodo, 0 de ${l.limit} ${l.unit}.`,
        accountId: l.accountId,
        producto: l.product
      });
    }
  }

  // Renovaciones proximas de licencias. Los dominios ya tienen su propia
  // alerta abajo, con mas contexto; aqui se saltan.
  const nombresDominios = new Set(dominios.map((d) => d.nombre.toLowerCase()));
  for (const l of licencias) {
    const producto = l.product.toLowerCase();
    if (
      !l.renewsAt ||
      [...nombresDominios].some(
        (n) => producto === n || producto.endsWith(` ${n}`)
      )
    ) {
      continue;
    }
    const dias = diasHasta(l.renewsAt, ahora);
    if (dias >= 0 && dias <= DIAS_AVISO_RENOVACION && (l.cost ?? 0) > 0) {
      alertas.push({
        id: `renueva:${llaveDeLicencia(l)}`,
        tipo: 'renueva',
        gravedad: 'aviso',
        titulo: `${l.product} se renueva ${dias === 0 ? 'hoy' : dias === 1 ? 'mañana' : `en ${dias} días`}`,
        detalle: `${dinero(l.cost as number, l.currency)}.`,
        accountId: l.accountId,
        producto: l.product
      });
    }
  }

  // Dominios que vencen sin renovacion automatica (o ya vencidos).
  for (const d of dominios) {
    const dias = diasHasta(d.venceEn, ahora);
    if (dias < 0) {
      alertas.push({
        id: `dominio:${d.nombre}`,
        tipo: 'dominio',
        gravedad: 'grave',
        titulo: `${d.nombre} venció hace ${-dias === 1 ? '1 día' : `${-dias} días`}`,
        detalle: `${d.registrador ?? 'registrador desconocido'}${d.automatico ? ', con renovación automática (verificar que se haya cobrado)' : ', sin renovación automática'}.`,
        producto: d.nombre
      });
    } else if (dias <= DIAS_AVISO_DOMINIO && !d.automatico) {
      alertas.push({
        id: `dominio:${d.nombre}`,
        tipo: 'dominio',
        gravedad: dias <= 7 ? 'grave' : 'aviso',
        titulo: `${d.nombre} ${dias === 0 ? 'vence hoy' : dias === 1 ? 'vence mañana' : `vence en ${dias} días`} sin renovación automática`,
        detalle: `${d.registrador ?? 'registrador desconocido'}${d.costo ? `, ${dinero(d.costo, d.moneda)}` : ''}.`,
        producto: d.nombre
      });
    }
  }

  return alertas.sort((a, b) =>
    a.gravedad === b.gravedad ? 0 : a.gravedad === 'grave' ? -1 : 1
  );
}

/** El modelo redacta cada alerta en una frase util; sin modelo, quedan como estan. */
export async function redactarAlertas(
  config: ConfiguracionIa | undefined,
  alertas: Alerta[]
): Promise<Alerta[]> {
  if (!config || alertas.length === 0) {
    return alertas;
  }
  const texto = await preguntar(config, {
    uso: 'alertas',
    sistema: `${contextoEmpresas()}\nTe doy alertas de licencias y dominios detectadas por reglas. Para cada una escribe UNA frase (máx. 140 caracteres) que diga qué pasa y qué conviene hacer, sin repetir el título. Responde SOLO JSON: {"alertas":[{"id":"...","texto":"..."}]}`,
    usuario: JSON.stringify(
      alertas.map((a) => ({
        id: a.id,
        tipo: a.tipo,
        titulo: a.titulo,
        detalle: a.detalle
      }))
    ),
    json: true,
    maxTokens: 1500
  });
  const salida = comoJson<{ alertas?: { id?: string; texto?: unknown }[] }>(
    texto
  );
  const porId = new Map(
    (salida.alertas ?? []).map((a) => [a.id, texto1(a.texto)])
  );
  return alertas.map((a) => ({ ...a, texto: porId.get(a.id) ?? a.texto }));
}

function dinero(monto: number, moneda?: string): string {
  return `${monto.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${moneda ?? 'MXN'}`;
}
