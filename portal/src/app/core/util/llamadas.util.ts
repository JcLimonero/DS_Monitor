import { LlamadaArchivada } from '../models';

/** Sin acentos ni mayúsculas, para comparar lo que se escribe en el buscador. */
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Las llamadas cuyo título o participantes contienen todas las palabras buscadas. */
export function filtrarLlamadas(
  llamadas: LlamadaArchivada[],
  busqueda: string
): LlamadaArchivada[] {
  const palabras = normalizar(busqueda).split(/\s+/).filter(Boolean);
  if (palabras.length === 0) {
    return llamadas;
  }
  return llamadas.filter((llamada) => {
    const texto = normalizar(
      `${llamada.titulo} ${llamada.participantes.join(' ')}`
    );
    return palabras.every((palabra) => texto.includes(palabra));
  });
}

/** "45 min", "1 h", "1 h 05 min". Vacío si no se conoce la duración. */
export function duracionLlamada(minutos: number | undefined): string {
  if (!minutos || minutos <= 0) {
    return '';
  }
  const h = Math.floor(minutos / 60);
  const m = Math.round(minutos % 60);
  if (h === 0) {
    return `${m} min`;
  }
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')} min`;
}

/** Los primeros participantes y cuántos más hay: "ana@x.mx, beto@y.mx y 3 más". */
export function resumenParticipantes(
  participantes: string[],
  maximo = 3
): string {
  if (participantes.length <= maximo) {
    return participantes.join(', ');
  }
  const resto = participantes.length - maximo;
  return `${participantes.slice(0, maximo).join(', ')} y ${resto} más`;
}
