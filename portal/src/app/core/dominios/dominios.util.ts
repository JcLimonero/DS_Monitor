import type {
  Dominio,
  RegistroDns,
  Subdominio,
  ZonaCloudflare
} from '../sources/gateway/puente-admin.service';
import { diasRestantes, textoPlazo, tonoPlazo } from '../util/plazo.util';

/** De dónde se sabe de un dominio: lo capturado a mano o Cloudflare. */
export type OrigenDominio = 'manual' | 'cloudflare';

/** Un dominio de la lista: uno solo aunque esté en los dos lados. */
export interface DominioUnificado {
  nombre: string;
  origenes: OrigenDominio[];
  manual?: Dominio;
  zona?: ZonaCloudflare;
  /** Cuándo vence, si se sabe (lo capturado manda sobre Cloudflare Registrar). */
  venceEn?: string;
}

/**
 * Junta los dominios capturados a mano con las zonas de Cloudflare. Mismo
 * nombre (sin importar mayúsculas) es el mismo dominio. Primero los que
 * vencen antes; los que no tienen fecha, al final y por nombre.
 */
export function unificarDominios(
  manuales: Dominio[],
  zonas: ZonaCloudflare[]
): DominioUnificado[] {
  const mapa = new Map<string, DominioUnificado>();
  for (const manual of manuales) {
    const nombre = manual.nombre.trim().toLowerCase();
    mapa.set(nombre, { nombre, origenes: ['manual'], manual });
  }
  for (const zona of zonas) {
    const nombre = zona.nombre.trim().toLowerCase();
    const previo = mapa.get(nombre);
    mapa.set(
      nombre,
      previo
        ? { ...previo, origenes: ['manual', 'cloudflare'], zona }
        : { nombre, origenes: ['cloudflare'], zona }
    );
  }
  const lista = [...mapa.values()].map((d) => ({
    ...d,
    venceEn: fechaDe(d)
  }));
  return lista.sort((a, b) => {
    if (a.venceEn && b.venceEn) {
      return (
        a.venceEn.localeCompare(b.venceEn) || a.nombre.localeCompare(b.nombre)
      );
    }
    if (a.venceEn || b.venceEn) {
      return a.venceEn ? -1 : 1;
    }
    return a.nombre.localeCompare(b.nombre);
  });
}

function fechaDe(d: DominioUnificado): string | undefined {
  if (d.manual && d.manual.sinFecha !== true && d.manual.venceEn) {
    return d.manual.venceEn;
  }
  return d.zona?.registro?.venceEn;
}

/** Lo que dice el chip de vencimiento: nunca un "vence" inventado. */
export function textoVencimiento(
  venceEn: string | undefined,
  ahora = new Date()
): string {
  if (!venceEn) {
    return 'Sin fecha de vencimiento';
  }
  const dias = diasRestantes(venceEn, ahora);
  return dias < 0
    ? `Vencido ${textoPlazo(venceEn, ahora).replace('vencido ', '')}`
    : `Vence ${textoPlazo(venceEn, ahora)}`;
}

/** Clases del chip de vencimiento (tokens del tema, sin colores nuevos). */
export function claseVencimiento(
  venceEn: string | undefined,
  ahora = new Date()
): string {
  if (!venceEn) {
    return 'bg-surface-muted text-ink-muted';
  }
  switch (tonoPlazo(venceEn, ahora)) {
    case 'vencido':
    case 'hoy':
      return 'bg-danger/10 text-danger';
    case 'urgente':
    case 'pronto':
      return 'bg-warn/10 text-warn';
    default:
      return 'bg-ok/10 text-ok';
  }
}

/** El estado de la zona en palabras y su tono. */
export function estadoDeZona(zona: ZonaCloudflare): {
  texto: string;
  tono: 'ok' | 'warn' | 'danger' | 'neutro';
} {
  if (zona.pausada) {
    return { texto: 'En pausa', tono: 'warn' };
  }
  switch (zona.estado) {
    case 'active':
      return { texto: 'Activo', tono: 'ok' };
    case 'pending':
      return { texto: 'Pendiente de nameservers', tono: 'warn' };
    case 'initializing':
      return { texto: 'Inicializando', tono: 'warn' };
    case 'moved':
    case 'deleted':
      return { texto: 'Fuera de Cloudflare', tono: 'danger' };
    default:
      return { texto: zona.estado, tono: 'neutro' };
  }
}

/** Zonas que todavía no están capturadas, las que se pueden importar. */
export function zonasPorImportar(
  manuales: Dominio[],
  zonas: ZonaCloudflare[]
): ZonaCloudflare[] {
  const tiene = new Set(manuales.map((m) => m.nombre.trim().toLowerCase()));
  return zonas.filter((z) => !tiene.has(z.nombre.toLowerCase()));
}

/**
 * Subdominios que coinciden con lo escrito: en el host, el nombre completo, el
 * tipo, el destino o el comentario de cualquiera de sus registros. Sin texto,
 * todos.
 */
export function filtrarSubdominios(
  subdominios: Subdominio[],
  texto: string
): Subdominio[] {
  const buscado = texto.trim().toLowerCase();
  if (!buscado) {
    return subdominios;
  }
  return subdominios.filter(
    (s) =>
      s.host.toLowerCase().includes(buscado) ||
      s.fqdn.toLowerCase().includes(buscado) ||
      s.registros.some(
        (r) =>
          r.tipo.toLowerCase() === buscado ||
          r.contenido.toLowerCase().includes(buscado) ||
          (r.comentario ?? '').toLowerCase().includes(buscado)
      )
  );
}

/**
 * La liga para abrir un subdominio en el navegador. Solo hosts con A, AAAA o
 * CNAME; sin comodín (no es una dirección) ni nombres técnicos. El nombre se
 * valida porque viene de un DNS ajeno.
 */
export function urlParaAbrir(s: Subdominio): string | undefined {
  if (!s.web || s.tecnico || s.host.startsWith('*')) {
    return undefined;
  }
  return /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(s.fqdn)
    ? `https://${s.fqdn}`
    : undefined;
}

/** "Auto", "5 min", "1 h": el TTL como se lee en Cloudflare. */
export function etiquetaTtl(ttl: number): string {
  if (ttl <= 1) {
    return 'Auto';
  }
  if (ttl % 3600 === 0) {
    return `${ttl / 3600} h`;
  }
  if (ttl % 60 === 0) {
    return `${ttl / 60} min`;
  }
  return `${ttl} s`;
}

/** El destino tal como se lee: los MX y SRV llevan su prioridad delante. */
export function destinoLegible(r: RegistroDns): string {
  return r.prioridad !== undefined
    ? `${r.prioridad} ${r.contenido}`
    : r.contenido;
}
