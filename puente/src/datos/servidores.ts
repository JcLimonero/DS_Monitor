import type { ConfiguracionPrometheus } from '../config/entorno.js';

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
