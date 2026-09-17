import type { Programable } from '../servidor/rutas-ia.js';

/**
 * Lo que el puente hace solo, sin que nadie abra el portal: releer los
 * buzones para registrar pendientes nuevos, mandar el correo del lunes,
 * tener listo el resumen del dia. Cada tarea corre a su intervalo, nunca dos
 * veces a la vez, y un error se anota en la bitacora sin tirar el proceso.
 * Los temporizadores no mantienen vivo el proceso (`unref`).
 */
export function programar(tareas: Programable[]): () => void {
  const temporizadores: NodeJS.Timeout[] = [];
  for (const tarea of tareas) {
    if (tarea.cadaMinutos <= 0) {
      continue;
    }
    let corriendo = false;
    const tick = async () => {
      if (corriendo) {
        return;
      }
      corriendo = true;
      try {
        await tarea.correr();
      } catch (error) {
        console.warn(
          `[puente] tarea "${tarea.nombre}": ${error instanceof Error ? error.message : String(error)}`
        );
      } finally {
        corriendo = false;
      }
    };
    const t = setInterval(tick, tarea.cadaMinutos * 60_000);
    t.unref();
    temporizadores.push(t);
    // La primera corrida va un minuto despues de arrancar, para no competir
    // con las primeras peticiones del portal.
    const primera = setTimeout(tick, 60_000);
    primera.unref();
    temporizadores.push(primera);
  }
  return () => temporizadores.forEach((t) => clearTimeout(t));
}
