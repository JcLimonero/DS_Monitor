export interface ArchivoVisto {
  driveFileId: string;
  ruta: string;
  modificadoEn?: string;
}

export interface DocumentoVigente {
  driveFileId: string;
  ruta: string | null;
  modificadoEn: string | null;
}

export interface PlanReconciliacion {
  /** Hay que bajarlos y mandarlos a la ingesta (nueva, movida o editada). */
  bajar: ArchivoVisto[];
  /** Estan en la base y ya no aparecieron en Drive. */
  borrar: string[];
}

/**
 * Compara lo que hay en Drive con lo guardado.
 *
 * No borra si el recorrido vino incompleto: un fallo a medias no debe
 * vaciar la base. El contenido igual se omite por huella al ingerir.
 */
export function planearReconciliacion(
  vistos: readonly ArchivoVisto[],
  guardados: readonly DocumentoVigente[],
  recorridoCompleto: boolean
): PlanReconciliacion {
  const porId = new Map(guardados.map((g) => [g.driveFileId, g]));
  const bajar: ArchivoVisto[] = [];
  const presentes = new Set<string>();
  for (const visto of vistos) {
    if (!visto.driveFileId || presentes.has(visto.driveFileId)) {
      continue;
    }
    presentes.add(visto.driveFileId);
    const guardado = porId.get(visto.driveFileId);
    if (!guardado) {
      bajar.push(visto);
      continue;
    }
    const rutaCambio = (guardado.ruta ?? '') !== visto.ruta;
    const edicion = esMasNuevo(visto.modificadoEn, guardado.modificadoEn);
    if (rutaCambio || edicion) {
      bajar.push(visto);
    }
  }
  const borrar = recorridoCompleto
    ? guardados
        .map((g) => g.driveFileId)
        .filter((id) => id && !presentes.has(id))
    : [];
  return { bajar, borrar };
}

function esMasNuevo(
  visto: string | undefined,
  guardado: string | null
): boolean {
  if (!visto) {
    return false;
  }
  const a = Date.parse(visto);
  if (Number.isNaN(a)) {
    return false;
  }
  if (!guardado) {
    return true;
  }
  const b = Date.parse(guardado);
  if (Number.isNaN(b)) {
    return true;
  }
  return a > b + 2000;
}
