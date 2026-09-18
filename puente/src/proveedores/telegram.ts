import { ErrorProveedor } from '../nucleo/errores.js';

/**
 * Telegram como entrada del dictado: un bot al que se le escribe (o se le
 * manda un audio, si hay quien lo transcriba) y lo que dice entra igual que
 * desde la pantalla Dictar. Solo atiende a los chats autorizados.
 */
export interface ConfiguracionTelegram {
  token: string;
  /** Ids de chat que pueden dictar; vacio = nadie hasta que se autorice. */
  chats: string[];
  /** Secreto que Telegram manda en cada webhook, para saber que es el. */
  secreto: string;
}

const BASE = 'https://api.telegram.org';

export interface MensajeTelegram {
  chatId: string;
  texto?: string;
  nombre?: string;
  /** file_id de la nota de voz, si mando audio. */
  voz?: string;
}

/** Saca lo util de un update de Telegram, o nada si no es un mensaje. */
export function leerUpdate(cuerpo: unknown): MensajeTelegram | undefined {
  const u = (cuerpo ?? {}) as {
    message?: {
      chat?: { id?: number | string };
      from?: { first_name?: string; username?: string };
      text?: string;
      voice?: { file_id?: string };
    };
  };
  const m = u.message;
  if (!m?.chat?.id) {
    return undefined;
  }
  return {
    chatId: String(m.chat.id),
    texto: m.text,
    nombre: m.from?.first_name ?? m.from?.username,
    voz: m.voice?.file_id
  };
}

export async function responder(
  config: ConfiguracionTelegram,
  chatId: string,
  texto: string
): Promise<void> {
  const r = await fetch(`${BASE}/bot${config.token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: texto, parse_mode: 'HTML' })
  });
  if (!r.ok) {
    throw new ErrorProveedor('telegram', `sendMessage respondió ${r.status}`);
  }
}

/** Registra el webhook en Telegram apuntando al puente. */
export async function registrarWebhook(
  config: ConfiguracionTelegram,
  url: string
): Promise<string> {
  const r = await fetch(`${BASE}/bot${config.token}/setWebhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url,
      secret_token: config.secreto,
      allowed_updates: ['message'],
      drop_pending_updates: true
    })
  });
  const datos = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    description?: string;
  };
  if (!r.ok || !datos.ok) {
    throw new ErrorProveedor(
      'telegram',
      datos.description ?? `setWebhook respondió ${r.status}`
    );
  }
  return datos.description ?? 'Webhook registrado.';
}

export async function quienEsElBot(
  config: ConfiguracionTelegram
): Promise<string> {
  const r = await fetch(`${BASE}/bot${config.token}/getMe`);
  const datos = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: { username?: string; first_name?: string };
  };
  if (!r.ok || !datos.ok) {
    throw new ErrorProveedor('telegram', 'el token del bot no sirve', 503);
  }
  return datos.result?.username
    ? `@${datos.result.username}`
    : (datos.result?.first_name ?? 'bot');
}
