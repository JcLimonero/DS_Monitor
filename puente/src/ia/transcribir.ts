import type { ConfiguracionIa } from '../config/entorno.js';
import { ErrorProveedor } from '../nucleo/errores.js';

/**
 * Voz a texto por OpenRouter con un modelo que escucha (Gemini Flash): el
 * audio va en base64 dentro del mensaje. Lo usa el bot de Telegram para las
 * notas de voz (OGG/Opus). Es otro modelo distinto al del texto porque el
 * que se elija para clasificar no tiene por que oir.
 */
const MODELO_AUDIO = 'google/gemini-2.5-flash';

export async function transcribir(
  config: ConfiguracionIa,
  audio: Buffer,
  formato: 'ogg' | 'mp3' | 'wav' | 'm4a' = 'ogg'
): Promise<string> {
  const respuesta = await fetch(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
        'x-title': 'DS Monitor'
      },
      body: JSON.stringify({
        model: MODELO_AUDIO,
        temperature: 0,
        max_tokens: 1500,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Transcribe este audio en español de México tal cual se dice, sin comentarios ni encabezados. Si no se entiende nada, responde solo: (inaudible).'
              },
              {
                type: 'input_audio',
                input_audio: { data: audio.toString('base64'), format: formato }
              }
            ]
          }
        ]
      })
    }
  );
  const datos = (await respuesta.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };
  if (!respuesta.ok) {
    throw new ErrorProveedor(
      'openrouter',
      `no pudo transcribir (${respuesta.status}): ${(datos.error?.message ?? '').slice(0, 160)}`
    );
  }
  const texto = (datos.choices?.[0]?.message?.content ?? '').trim();
  if (!texto || /^\(?inaudible\)?$/i.test(texto)) {
    throw new ErrorProveedor('openrouter', 'no se entendió el audio');
  }
  return texto;
}
