import type {
  ConfiguracionIa,
  ConfiguracionVercel
} from '../config/entorno.js';
import type { Deployment, MonitorTarget } from '../nucleo/contrato.js';
import { bitacoraDeConstruccion } from '../proveedores/vercel.js';
import { contextoEmpresas } from '../datos/empresas.js';
import { comoJson, preguntar, texto1 } from './modelo.js';

/**
 * Diagnostico de caidas y de despliegues fallidos.
 *
 * Cuando el monitoreo marca un sitio caido, se le vuelve a pegar para traer
 * evidencia fresca (codigo, tiempo, error de red, encabezados); cuando un
 * despliegue de Vercel falla, se traen las ultimas lineas de su bitacora. El
 * modelo lo resume en una linea entendible y propone la causa. Cada
 * diagnostico se guarda por id de incidente para no repetir la llamada.
 */
export interface Diagnostico {
  /** `sitio:<id>:<ultimo check>` o `despliegue:<id>`. */
  id: string;
  clase: 'sitio' | 'despliegue';
  objetivo: string;
  resumen: string;
  causa: string;
  accion: string;
  evidencia: string;
  generadoEn: string;
}

export function idDeIncidente(
  clase: 'sitio' | 'despliegue',
  m: MonitorTarget | Deployment
): string {
  return clase === 'sitio'
    ? `sitio:${m.id}:${(m as MonitorTarget).lastCheck ?? ''}`
    : `despliegue:${m.id}`;
}

/** Evidencia fresca de un sitio: se le pega una vez con GET. */
export async function evidenciaDeSitio(
  destino: MonitorTarget
): Promise<string> {
  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), 10_000);
  const inicio = Date.now();
  try {
    const r = await fetch(destino.url, {
      method: 'GET',
      redirect: 'manual',
      signal: control.signal,
      headers: { 'user-agent': 'DSMonitor/0.1 (diagnostico)' }
    });
    const cuerpo = (await r.text().catch(() => '')).replace(/\s+/g, ' ');
    const encabezados = [
      'server',
      'location',
      'content-type',
      'x-vercel-error',
      'cf-ray',
      'retry-after'
    ]
      .map((h) => (r.headers.get(h) ? `${h}: ${r.headers.get(h)}` : undefined))
      .filter((x) => x)
      .join('; ');
    return `GET ${destino.url} → ${r.status} ${r.statusText} en ${Date.now() - inicio} ms. ${encabezados}. Cuerpo: ${cuerpo.slice(0, 400)}`;
  } catch (error) {
    const e = error as Error & { cause?: { code?: string; message?: string } };
    return `GET ${destino.url} falló en ${Date.now() - inicio} ms: ${e.name} ${e.message}${e.cause?.code ? ` (${e.cause.code} ${e.cause.message ?? ''})` : ''}`;
  } finally {
    clearTimeout(temporizador);
  }
}

export async function evidenciaDeDespliegue(
  vercel: ConfiguracionVercel | undefined,
  despliegue: Deployment
): Promise<string> {
  if (!vercel) {
    return `Despliegue ${despliegue.project} (${despliegue.branch ?? ''}) en error; sin token de Vercel no se puede leer la bitácora.`;
  }
  try {
    const lineas = await bitacoraDeConstruccion(vercel, despliegue.id);
    return lineas.join('\n').slice(-6000);
  } catch (error) {
    return `No se pudo leer la bitácora: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function diagnosticar(
  config: ConfiguracionIa,
  clase: 'sitio' | 'despliegue',
  objetivo: string,
  evidencia: string,
  id: string,
  ahora = new Date()
): Promise<Diagnostico> {
  const texto = await preguntar(config, {
    uso: 'diagnosticos',
    sistema: `${contextoEmpresas()}\nEres quien atiende la guardia técnica. Te doy la evidencia de ${clase === 'sitio' ? 'un sitio que el monitoreo marca caído' : 'un despliegue de Vercel que falló'}. Responde SOLO JSON: {"resumen":"qué pasa, en una línea de máx. 120 caracteres","causa":"la causa más probable, máx. 160 caracteres","accion":"qué hacer primero, máx. 160 caracteres"}. Sé concreto: cita el código HTTP, el error o la línea de la bitácora que lo delata. Si la evidencia no alcanza, dilo.`,
    usuario: `Objetivo: ${objetivo}\n\nEvidencia:\n${evidencia}`,
    json: true,
    maxTokens: 500
  });
  const salida = comoJson<{
    resumen?: unknown;
    causa?: unknown;
    accion?: unknown;
  }>(texto);
  return {
    id,
    clase,
    objetivo,
    resumen: texto1(salida.resumen) ?? 'Sin diagnóstico.',
    causa: texto1(salida.causa) ?? '',
    accion: texto1(salida.accion) ?? '',
    evidencia: evidencia.slice(-1500),
    generadoEn: ahora.toISOString()
  };
}
