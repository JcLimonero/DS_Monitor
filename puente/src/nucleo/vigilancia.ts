import type { MonitorTarget } from './contrato.js';

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
