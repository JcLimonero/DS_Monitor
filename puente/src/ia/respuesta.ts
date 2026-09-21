import type { ConfiguracionIa } from '../config/entorno.js';
import type { TaskItem } from '../nucleo/contrato.js';
import { contextoEmpresas } from '../datos/empresas.js';
import { comoJson, preguntar, texto1 } from './modelo.js';

/**
 * Un borrador de respuesta para un pendiente que llego por correo. La
 * descripcion del pendiente trae el correo (De, Para, Asunto y cuerpo), asi
 * que con eso y el nombre de quien firma alcanza. Se devuelve para que la
 * persona lo revise y lo mande desde su propio correo: el puente no envia
 * nada en nombre de nadie.
 */
export interface Borrador {
  para?: string;
  asunto: string;
  cuerpo: string;
}

export async function borradorDeRespuesta(
  config: ConfiguracionIa,
  tarea: TaskItem,
  firma: string,
  instrucciones?: string
): Promise<Borrador> {
  const correo = tarea.description ?? '';
  const de = /^De: (.+)$/m.exec(correo)?.[1]?.trim();
  const asunto = /^Asunto: (.+)$/m.exec(correo)?.[1]?.trim() ?? tarea.title;
  const texto = await preguntar(config, {
    uso: 'respuestas',
    sistema: `${contextoEmpresas()}\nRedacta la respuesta a un correo en nombre de ${firma}. Tono profesional y cercano, breve (máx. 120 palabras), sin promesas de fechas o precios que el correo no respalde; donde falte un dato pon [entre corchetes] para que quien firma lo llene. Responde SOLO JSON: {"asunto":"Re: ...","cuerpo":"texto plano con saltos de línea"}.`,
    usuario: JSON.stringify({
      pendiente: tarea.title,
      instrucciones: instrucciones?.slice(0, 500),
      correo: correo.slice(0, 5000)
    }),
    json: true,
    maxTokens: 800
  });
  const salida = comoJson<{ asunto?: unknown; cuerpo?: unknown }>(texto);
  return {
    para: de ? (/<([^>]+)>/.exec(de)?.[1] ?? de) : undefined,
    asunto: texto1(salida.asunto) ?? `Re: ${asunto}`,
    cuerpo: texto1(salida.cuerpo) ?? ''
  };
}
