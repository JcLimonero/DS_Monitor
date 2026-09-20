import type {
  HostedApp,
  MonitorTarget,
  VpsHealth,
  VpsStatus
} from './contrato.js';

/**
 * Vigilancia de los sitios monitoreados para avisar por Telegram: cuando uno
 * cae se avisa una vez, y cuando vuelve, otra. Lo que ya se aviso se
 * recuerda por sitio con la hora en que se vio caido.
 */
export type SitiosAvisados = Record<string, { caidoDesde: string }>;

export function avisosDeSitios(
  sitios: MonitorTarget[],
  avisados: SitiosAvisados,
  ahora = new Date()
): { lineas: string[]; avisados: SitiosAvisados } {
  const lineas: string[] = [];
  const nuevos: SitiosAvisados = {};
  const vistos = new Set<string>();
  for (const s of sitios) {
    vistos.add(s.id);
    const previo = avisados[s.id];
    const nombre = `<b>${escapar(s.name)}</b>${s.environment && s.environment !== 'produccion' ? ` (${s.environment})` : ''}`;
    if (s.status === 'caido') {
      if (!previo) {
        lineas.push(
          `🔴 ${nombre} está caído${s.incident ? `: ${escapar(s.incident)}` : ''}. ${escapar(s.url)}`
        );
        nuevos[s.id] = { caidoDesde: s.lastCheck ?? ahora.toISOString() };
      } else {
        nuevos[s.id] = previo;
      }
    } else if (previo && s.status === 'desconocido') {
      // Sin dato no es que haya vuelto: se sigue esperando.
      nuevos[s.id] = previo;
    } else if (previo) {
      const fuera = ahora.getTime() - Date.parse(previo.caidoDesde);
      lineas.push(
        `🟢 ${nombre} volvió${fuera > 0 ? ` después de ${enPalabras(fuera)}` : ''}.`
      );
    }
  }
  // Un sitio que ya no se monitorea deja de contar.
  return { lineas, avisados: nuevos };
}

function escapar(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function enPalabras(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) {
    return `${Math.max(1, min)} min`;
  }
  const h = min / 60;
  return h < 48
    ? `${h < 10 ? h.toFixed(1) : Math.round(h)} h`
    : `${Math.round(h / 24)} días`;
}

/**
 * Vigilancia de los servidores (Prometheus): se avisa una vez cuando un VPS
 * deja de reportar o se pasa de umbral (disco, memoria, CPU) y otra cuando
 * vuelve a estar bien. Se recuerda por servidor la salud que ya se aviso.
 */
export type VpsAvisados = Record<string, { salud: VpsHealth; desde: string }>;

export function avisosDeVps(
  servidores: VpsStatus[],
  avisados: VpsAvisados,
  ahora = new Date()
): { lineas: string[]; avisados: VpsAvisados } {
  const lineas: string[] = [];
  const nuevos: VpsAvisados = {};
  for (const v of servidores) {
    const previo = avisados[v.id];
    const nombre = `<b>${escapar(v.name)}</b>`;
    const mal = v.health !== 'bien';
    if (mal) {
      if (!previo || previo.salud !== v.health) {
        const icono =
          v.health === 'sin_senal'
            ? '📡'
            : v.health === 'critico'
              ? '🔴'
              : '🟠';
        lineas.push(
          `${icono} ${nombre}: ${v.health === 'sin_senal' ? 'sin señal' : v.health === 'critico' ? 'crítico' : 'aviso'}${v.reason ? ` — ${escapar(v.reason)}` : ''}.`
        );
        nuevos[v.id] = {
          salud: v.health,
          desde: previo?.desde ?? ahora.toISOString()
        };
      } else {
        nuevos[v.id] = previo;
      }
    } else if (previo) {
      const fuera = ahora.getTime() - Date.parse(previo.desde);
      lineas.push(
        `🟢 ${nombre} volvió a estar bien${fuera > 0 ? ` después de ${enPalabras(fuera)}` : ''}.`
      );
    }
  }
  return { lineas, avisados: nuevos };
}

/**
 * Vigilancia de los portales montados en Coolify: se avisa una vez cuando
 * uno deja de correr (detenido, con error o sin salud) y otra cuando vuelve.
 */
export type PortalesAvisados = Record<
  string,
  { desde: string; estado: string }
>;

export function avisosDePortales(
  portales: HostedApp[],
  avisados: PortalesAvisados,
  ahora = new Date()
): { lineas: string[]; avisados: PortalesAvisados } {
  const lineas: string[] = [];
  const nuevos: PortalesAvisados = {};
  for (const p of portales) {
    const previo = avisados[p.id];
    const nombre = `<b>${escapar(p.name)}</b>${p.server ? ` (${escapar(p.server)})` : ''}`;
    const mal =
      p.status === 'stopped' ||
      p.status === 'error' ||
      (p.status === 'running' && p.healthy === false);
    const estado =
      p.status === 'running'
        ? 'sin salud'
        : p.status === 'error'
          ? 'con error'
          : 'detenido';
    if (mal) {
      if (!previo || previo.estado !== estado) {
        lineas.push(
          `🟥 ${nombre}: portal ${estado}${p.rawStatus ? ` (${escapar(p.rawStatus)})` : ''}${p.url ? ` · ${escapar(p.url)}` : ''}.`
        );
        nuevos[p.id] = { desde: previo?.desde ?? ahora.toISOString(), estado };
      } else {
        nuevos[p.id] = previo;
      }
    } else if (previo && p.status === 'running') {
      const fuera = ahora.getTime() - Date.parse(previo.desde);
      lineas.push(
        `🟩 ${nombre}: el portal volvió${fuera > 0 ? ` después de ${enPalabras(fuera)}` : ''}.`
      );
    } else if (previo) {
      nuevos[p.id] = previo;
    }
  }
  return { lineas, avisados: nuevos };
}
