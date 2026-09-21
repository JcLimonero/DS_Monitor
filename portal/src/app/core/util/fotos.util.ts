/** Fotos del detalle de un pendiente: data URLs que el puente también acepta. */

export const MAX_FOTOS = 8;
const MAX_LADO = 1280;
const CALIDAD = 0.82;
const FOTO =
  /^data:image\/(?:jpeg|jpg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

export function esFotoDataUrl(valor: string): boolean {
  return FOTO.test(valor.replace(/\s/g, ''));
}

export function fotosVisibles(urls: readonly string[] | undefined): string[] {
  return (urls ?? []).filter((u) => esFotoDataUrl(u)).slice(0, MAX_FOTOS);
}

/**
 * Comprime una imagen del portapapeles o de un archivo a JPEG para no
 * inflar el pendiente. Si no se puede pintar, se deja el data URL original.
 */
export async function archivoAFoto(archivo: Blob): Promise<string> {
  if (!archivo.type.startsWith('image/')) {
    throw new Error('Solo se aceptan fotos.');
  }
  const bitmap = await createImageBitmap(archivo);
  const escala = Math.min(1, MAX_LADO / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * escala));
  const h = Math.max(1, Math.round(bitmap.height * escala));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return leerComoDataUrl(archivo);
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', CALIDAD);
}

function leerComoDataUrl(archivo: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => {
      const r = lector.result;
      typeof r === 'string'
        ? resolve(r)
        : reject(new Error('No se leyó la foto.'));
    };
    lector.onerror = () =>
      reject(lector.error ?? new Error('No se leyó la foto.'));
    lector.readAsDataURL(archivo);
  });
}
