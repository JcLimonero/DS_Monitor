import { pathToFileURL } from 'node:url';
import { leerConfiguracion } from '../config/entorno.js';
import {
  listarHijosDrive,
  textoDeArchivo,
  tokenDeCuentaServicio
} from '../proveedores/google.js';
import { juntarMarkdown } from '../rag/drive-markdown.js';
import { configuracionRag } from '../rag/config.js';
import { empresaDeRuta, empresaIdDe } from '../rag/empresas-rag.js';

/**
 * Carga inicial del RAG: recorre las carpetas de Drive y manda cada .md a
 * POST /ingesta/rag. Si el archivo no cambio, el puente responde omitido.
 *
 *   npm run rag:backfill -- --puente http://localhost:8787 --token TOKEN
 *
 * Variables: GOOGLE_DRIVE_CUENTA_SERVICIO, RAG_DRIVE_RAIZ (o las carpetas por
 * empresa), RAG_BACKFILL_PUENTE, RAG_BACKFILL_TOKEN.
 */

interface Argumentos {
  puente: string;
  token: string;
  limite?: number;
  empresa?: string;
}

function argumentos(argv: string[]): Argumentos {
  const tomar = (nombre: string): string | undefined => {
    const i = argv.indexOf(nombre);
    const valor = i >= 0 ? argv[i + 1] : undefined;
    return valor && !valor.startsWith('--') ? valor : undefined;
  };
  const puente = (
    tomar('--puente') ??
    process.env['RAG_BACKFILL_PUENTE'] ??
    'http://localhost:8787'
  ).replace(/\/+$/, '');
  const token = tomar('--token') ?? process.env['RAG_BACKFILL_TOKEN'] ?? '';
  const limite = Number(tomar('--limite'));
  const empresa = tomar('--empresa');
  return {
    puente,
    token,
    ...(Number.isInteger(limite) && limite > 0 ? { limite } : {}),
    ...(empresa ? { empresa } : {})
  };
}

export async function correrBackfill(args: Argumentos): Promise<{
  enviados: number;
  omitidos: number;
  fallos: number;
}> {
  if (!args.token) {
    throw new Error(
      'Falta el token de un emisor con tipo rag (--token o RAG_BACKFILL_TOKEN).'
    );
  }
  const config = leerConfiguracion();
  const rag = config.ragDrive ?? configuracionRag((n) => process.env[n]);
  if (!rag) {
    throw new Error(
      'Falta GOOGLE_DRIVE_CUENTA_SERVICIO y una carpeta (RAG_DRIVE_RAIZ o RAG_DRIVE_CARPETA_*).'
    );
  }
  const tokenDrive = await tokenDeCuentaServicio(rag.cuenta);
  const raices = rag.raizId
    ? [{ id: rag.raizId, nombre: 'Empresas' }]
    : rag.carpetas.map((c) => ({ id: c.carpetaId, nombre: c.empresaId }));
  const recorrido = await juntarMarkdown(
    raices,
    (id) => listarHijosDrive(tokenDrive, id),
    { limite: args.limite, excluir: rag.excluir }
  );
  const pedido = args.empresa ? empresaIdDe(args.empresa) : undefined;
  const archivos = args.empresa
    ? recorrido.archivos.filter((a) => {
        const deRuta = empresaDeRuta(a.ruta);
        if (pedido && deRuta === pedido) {
          return true;
        }
        return a.ruta
          .toLowerCase()
          .includes((args.empresa as string).toLowerCase());
      })
    : recorrido.archivos;
  let enviados = 0;
  let omitidos = 0;
  let fallos = 0;
  for (const archivo of archivos) {
    try {
      const markdown = await textoDeArchivo(tokenDrive, archivo.id);
      const respuesta = await fetch(`${args.puente}/ingesta/rag`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${args.token}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          driveFileId: archivo.id,
          driveUrl:
            archivo.webViewLink ??
            `https://drive.google.com/file/d/${archivo.id}/view`,
          ruta: archivo.ruta,
          markdown,
          modificadoEn: archivo.modifiedTime
        })
      });
      const cuerpo = (await respuesta.json().catch(() => ({}))) as {
        omitido?: boolean;
        error?: string;
      };
      if (!respuesta.ok) {
        fallos += 1;
        console.warn(
          `[rag-backfill] ${archivo.ruta}: ${respuesta.status} ${cuerpo.error ?? ''}`
        );
        continue;
      }
      if (cuerpo.omitido) {
        omitidos += 1;
      } else {
        enviados += 1;
      }
      console.log(
        `[rag-backfill] ${cuerpo.omitido ? 'omitido' : 'indexado'} ${archivo.ruta}`
      );
    } catch (error) {
      fallos += 1;
      console.warn(
        `[rag-backfill] ${archivo.ruta}: ${error instanceof Error ? error.message : error}`
      );
    }
  }
  return { enviados, omitidos, fallos };
}

const esPrincipal =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (esPrincipal) {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Sin .env se usan las variables del entorno.
  }
  const resumen = await correrBackfill(argumentos(process.argv.slice(2)));
  console.log(
    `[rag-backfill] indexados ${resumen.enviados}, omitidos ${resumen.omitidos}, fallos ${resumen.fallos}`
  );
  if (resumen.fallos > 0) {
    process.exitCode = 1;
  }
}
