import type { ConfiguracionPrometheus } from '../config/entorno.js';
import type { AlmacenJson } from './almacen-json.js';

/**
 * Un servidor (VPS) vigilado: su Prometheus, con sus propias credenciales.
 * Se capturan desde Integraciones → Servidores, uno por renglon. La
 * etiqueta es el nombre que se ve en el portal, el carrusel y Telegram.
 */
export interface ServidorVps {
  id: string;
  etiqueta: string;
  /** Raiz de Prometheus, por ejemplo http://74.208.151.19:9090. */
  url: string;
  usuario?: string;
  contrasena?: string;
  token?: string;
  /** Etiqueta de prometheus.yml con el nombre de cada VPS que ve; `nombre` por omision. */
  etiquetaNombre?: string;
  actualizadoEn: string;
}

/** Lo que se le enseña al portal: sin secretos. */
export interface ServidorVpsVisible {
  id: string;
  etiqueta: string;
  url: string;
  usuario?: string;
  conContrasena: boolean;
  conToken: boolean;
  etiquetaNombre?: string;
  actualizadoEn: string;
}

export function sinSecretos(s: ServidorVps): ServidorVpsVisible {
  return {
    id: s.id,
    etiqueta: s.etiqueta,
    url: s.url,
    usuario: s.usuario,
    conContrasena: !!s.contrasena,
    conToken: !!s.token,
    etiquetaNombre: s.etiquetaNombre,
    actualizadoEn: s.actualizadoEn
  };
}

export function comoFuente(s: ServidorVps): ConfiguracionPrometheus {
  return {
    url: s.url,
    nombre: s.etiqueta,
    usuario: s.usuario,
    contrasena: s.contrasena,
    token: s.token,
    etiquetaNombre: s.etiquetaNombre || 'nombre',
    accountId: 'vps'
  };
}

/** Un id estable a partir de la etiqueta. */
export function idDeServidor(etiqueta: string): string {
  return (
    etiqueta
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'servidor'
  );
}

/**
 * Valida lo que manda el portal y lo mezcla con lo guardado: una contraseña
 * o token vacios conservan los que habia (el portal nunca los recibe).
 */
export function validarServidor(
  crudo: unknown,
  previo: ServidorVps | undefined,
  ahora: string
): ServidorVps {
  const s = (crudo ?? {}) as Record<string, unknown>;
  const texto = (v: unknown) =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined;
  const etiqueta = texto(s['etiqueta']);
  if (!etiqueta) {
    throw new Error('Cada servidor necesita una etiqueta.');
  }
  const url = texto(s['url'])?.replace(/\/+$/, '');
  if (!url || !/^https?:\/\//.test(url)) {
    throw new Error(
      `La URL de "${etiqueta}" debe empezar con http:// o https://.`
    );
  }
  return {
    id: texto(s['id']) ?? previo?.id ?? idDeServidor(etiqueta),
    etiqueta: etiqueta.slice(0, 60),
    url,
    usuario: texto(s['usuario']),
    contrasena: texto(s['contrasena']) ?? previo?.contrasena,
    token: texto(s['token']) ?? previo?.token,
    etiquetaNombre: texto(s['etiquetaNombre']),
    actualizadoEn: ahora
  };
}

/** La misma URL escrita con o sin diagonal final, o con mayusculas, es la misma. */
function urlNormal(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase();
}

/**
 * Los Prometheus de PROMETHEUS_URL (la forma vieja, por variables de entorno)
 * como renglones de la lista, para que se vean y se puedan editar en
 * Integraciones → Servidores. La etiqueta es el nombre declarado o, si no
 * hay, el host de la URL.
 */
export function desdeEntorno(
  fuentes: ConfiguracionPrometheus[],
  ahora: string
): ServidorVps[] {
  return fuentes.map((f) => {
    let etiqueta = f.nombre;
    if (!etiqueta) {
      try {
        etiqueta = new URL(f.url).hostname;
      } catch {
        etiqueta = f.url;
      }
    }
    return {
      id: idDeServidor(etiqueta),
      etiqueta: etiqueta.slice(0, 60),
      url: f.url.replace(/\/+$/, ''),
      usuario: f.usuario,
      contrasena: f.contrasena,
      token: f.token,
      etiquetaNombre:
        f.etiquetaNombre && f.etiquetaNombre !== 'nombre'
          ? f.etiquetaNombre
          : undefined,
      actualizadoEn: ahora
    };
  });
}

/**
 * Las fuentes que de verdad se leen: las de la lista mas las del entorno que
 * no esten ya en la lista (misma URL). Asi un servidor que se migro del
 * entorno a la lista no se consulta dos veces.
 */
export function fuentesCombinadas(
  guardados: ServidorVps[],
  entorno: ConfiguracionPrometheus[]
): ConfiguracionPrometheus[] {
  const urls = new Set(guardados.map((s) => urlNormal(s.url)));
  return [
    ...guardados.map(comoFuente),
    ...entorno.filter((f) => !urls.has(urlNormal(f.url)))
  ];
}

/**
 * Primera vez con la lista vacia y PROMETHEUS_URL en el entorno: los pasa a
 * la lista para que aparezcan en Integraciones. Devuelve cuantos sembro.
 */
export async function sembrarDesdeEntorno(
  almacen: AlmacenJson<ServidorVps[]>,
  entorno: ConfiguracionPrometheus[],
  ahora = new Date().toISOString()
): Promise<number> {
  if (almacen.leer().length > 0 || entorno.length === 0) {
    return 0;
  }
  const nuevos = desdeEntorno(entorno, ahora);
  await almacen.escribir(nuevos);
  return nuevos.length;
}
