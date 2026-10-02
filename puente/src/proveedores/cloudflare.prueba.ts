import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { ConfiguracionCloudflare } from '../config/entorno.js';
import { ErrorProveedor } from '../nucleo/errores.js';
import {
  ErrorCloudflareSinPermiso,
  MAXIMO_PAGINAS,
  agruparSubdominios,
  registradas,
  registros,
  zonas,
  type RegistroDns
} from './cloudflare.js';

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

const config: ConfiguracionCloudflare = {
  token: 'token-de-prueba',
  apiUrl: 'https://cf.prueba/client/v4'
};
const ZONA = 'a'.repeat(32);
const CUENTA = 'b'.repeat(32);

interface Llamado {
  url: URL;
  autorizacion: string;
}

function simular(responder: (l: Llamado, n: number) => Response): Llamado[] {
  const llamados: Llamado[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const l: Llamado = {
      url: new URL(String(url)),
      autorizacion: String(
        (init?.headers as Record<string, string>)?.['authorization'] ?? ''
      )
    };
    llamados.push(l);
    return responder(l, llamados.length);
  }) as typeof fetch;
  return llamados;
}

const sobre = (result: unknown, info?: Record<string, number>, status = 200) =>
  new Response(
    JSON.stringify({ success: true, errors: [], result, result_info: info }),
    { status, headers: { 'content-type': 'application/json' } }
  );

const zona = (n: number) => ({
  id: n.toString(16).padStart(32, '0'),
  name: `Dominio${n}.com`,
  status: 'active',
  paused: false,
  plan: { name: 'Free Website' },
  name_servers: ['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com'],
  account: { id: CUENTA }
});

const dns = (
  n: number,
  nombre: string,
  tipo = 'A',
  extra: Record<string, unknown> = {}
) => ({
  id: n.toString(16).padStart(32, '0'),
  name: nombre,
  type: tipo,
  content: '203.0.113.7',
  proxied: false,
  ttl: 1,
  ...extra
});

describe('zonas de Cloudflare', () => {
  it('lee todas las paginas con el token bearer y traduce los campos', async () => {
    const llamados = simular((l) => {
      const pagina = Number(l.url.searchParams.get('page'));
      return sobre(pagina === 1 ? [zona(2), zona(1)] : [zona(3)], {
        total_pages: 2
      });
    });
    const lista = await zonas(config);
    assert.equal(llamados.length, 2);
    assert.equal(llamados[0]!.url.pathname, '/client/v4/zones');
    assert.equal(llamados[0]!.url.searchParams.get('per_page'), '50');
    assert.equal(llamados[0]!.autorizacion, 'Bearer token-de-prueba');
    assert.deepEqual(
      lista.map((z) => z.nombre),
      ['dominio1.com', 'dominio2.com', 'dominio3.com']
    );
    assert.deepEqual(lista[0], {
      id: zona(1).id,
      nombre: 'dominio1.com',
      estado: 'active',
      plan: 'Free Website',
      servidoresDeNombres: ['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com'],
      pausada: false,
      cuentaId: CUENTA
    });
  });

  it('filtra por cuenta si hay CLOUDFLARE_ACCOUNT_ID', async () => {
    const llamados = simular(() => sobre([], { total_pages: 1 }));
    await zonas({ ...config, accountId: CUENTA });
    assert.equal(llamados[0]!.url.searchParams.get('account.id'), CUENTA);
  });

  it('401 y 403 dicen que el token no tiene permiso', async () => {
    for (const status of [401, 403]) {
      simular(
        () =>
          new Response(
            JSON.stringify({ success: false, errors: [{ message: 'x' }] }),
            { status }
          )
      );
      await assert.rejects(
        () => zonas(config),
        (e: unknown) =>
          e instanceof ErrorCloudflareSinPermiso &&
          /Zone:Read y DNS:Read/.test(e.message)
      );
    }
  });

  it('con 429 reintenta una vez y respeta Retry-After', async () => {
    const llamados = simular((_, n) =>
      n === 1
        ? new Response('{}', { status: 429, headers: { 'retry-after': '0' } })
        : sobre([zona(1)], { total_pages: 1 })
    );
    const lista = await zonas(config);
    assert.equal(llamados.length, 2);
    assert.equal(lista.length, 1);
  });

  it('si el 429 sigue, falla con un mensaje claro y no insiste', async () => {
    const llamados = simular(
      () => new Response('{}', { status: 429, headers: { 'retry-after': '0' } })
    );
    await assert.rejects(
      () => zonas(config),
      (e: unknown) =>
        e instanceof ErrorProveedor && e.estado === 429 && /429/.test(e.message)
    );
    assert.equal(llamados.length, 2);
  });

  it('red caida y errores del API salen con el motivo', async () => {
    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    await assert.rejects(
      () => zonas(config),
      (e: unknown) =>
        e instanceof ErrorProveedor && /ECONNREFUSED/.test(e.message)
    );
    simular(
      () =>
        new Response(
          JSON.stringify({
            success: false,
            errors: [{ code: 1, message: 'zona rara' }]
          }),
          { status: 400 }
        )
    );
    await assert.rejects(
      () => zonas(config),
      (e: unknown) => e instanceof ErrorProveedor && /zona rara/.test(e.message)
    );
  });
});

describe('registros DNS', () => {
  it('lee todas las paginas de 100 y los ordena por nombre y tipo', async () => {
    const llamados = simular((l) => {
      const pagina = Number(l.url.searchParams.get('page'));
      const filas =
        pagina === 1
          ? Array.from({ length: 100 }, (_, i) =>
              dns(i + 1, `h${String(i).padStart(3, '0')}.dominio1.com`)
            )
          : [
              dns(900, 'a.dominio1.com', 'TXT'),
              dns(901, 'a.dominio1.com', 'A'),
              dns(902, 'dominio1.com', 'MX', { priority: 10 })
            ];
      return sobre(filas, { total_pages: 2, total_count: 103 });
    });
    const r = await registros(config, ZONA);
    assert.equal(llamados.length, 2);
    assert.equal(
      llamados[0]!.url.pathname,
      `/client/v4/zones/${ZONA}/dns_records`
    );
    assert.equal(llamados[0]!.url.searchParams.get('per_page'), '100');
    assert.equal(r.registros.length, 103);
    assert.equal(r.total, 103);
    assert.equal(r.truncado, false);
    assert.deepEqual(
      r.registros.slice(0, 3).map((x) => `${x.nombre} ${x.tipo}`),
      ['a.dominio1.com A', 'a.dominio1.com TXT', 'dominio1.com MX']
    );
    assert.equal(r.registros[2]!.prioridad, 10);
  });

  it('no sigue mas alla del tope de paginas y lo avisa', async () => {
    const llamados = simular(() =>
      sobre([dns(1, 'x.dominio1.com')], {
        total_pages: 5000,
        total_count: 500000
      })
    );
    const r = await registros(config, ZONA);
    assert.equal(llamados.length, MAXIMO_PAGINAS);
    assert.equal(r.truncado, true);
    assert.equal(r.total, 500000);
  });

  it('el id de la zona se valida antes de pedir nada', async () => {
    const llamados = simular(() => sobre([]));
    await assert.rejects(() => registros(config, '../zones'));
    assert.equal(llamados.length, 0);
  });

  it('un token sin DNS:Read da el mismo error de permiso', async () => {
    simular(() => new Response('{}', { status: 403 }));
    await assert.rejects(
      () => registros(config, ZONA),
      (e: unknown) => e instanceof ErrorCloudflareSinPermiso
    );
  });
});

describe('Cloudflare Registrar', () => {
  it('trae el vencimiento de los dominios registrados ahi', async () => {
    const llamados = simular(() =>
      sobre(
        [
          {
            name: 'Dominio1.com',
            expires_at: '2027-03-01T00:00:00Z',
            auto_renew: true
          },
          { name: 'sinfecha.com' }
        ],
        { total_pages: 1 }
      )
    );
    const lista = await registradas(config, [CUENTA, CUENTA]);
    assert.equal(llamados.length, 1);
    assert.equal(
      llamados[0]!.url.pathname,
      `/client/v4/accounts/${CUENTA}/registrar/domains`
    );
    assert.deepEqual(lista, [
      {
        nombre: 'dominio1.com',
        venceEn: '2027-03-01T12:00:00.000Z',
        autoRenovar: true
      }
    ]);
  });

  it('sin permiso, sin Registrar o con la red caida devuelve [] sin error', async () => {
    simular(() => new Response('{}', { status: 403 }));
    assert.deepEqual(await registradas(config, [CUENTA]), []);
    simular(() => new Response('{}', { status: 404 }));
    assert.deepEqual(await registradas(config, [CUENTA]), []);
    globalThis.fetch = (async () => {
      throw new Error('red');
    }) as typeof fetch;
    assert.deepEqual(await registradas(config, [CUENTA]), []);
    // Sin cuenta que consultar no hay ni peticion.
    const llamados = simular(() => sobre([]));
    assert.deepEqual(await registradas(config, []), []);
    assert.equal(llamados.length, 0);
  });

  it('con CLOUDFLARE_ACCOUNT_ID usa esa cuenta y no las de las zonas', async () => {
    const otra = 'c'.repeat(32);
    const llamados = simular(() => sobre([], { total_pages: 1 }));
    await registradas({ ...config, accountId: otra }, [CUENTA]);
    assert.equal(llamados.length, 1);
    assert.match(llamados[0]!.url.pathname, new RegExp(otra));
  });
});

describe('agruparSubdominios', () => {
  const reg = (
    nombre: string,
    tipo: string,
    contenido: string,
    extra: Partial<RegistroDns> = {}
  ): RegistroDns => ({
    id: `${nombre}-${tipo}-${contenido}`,
    nombre,
    tipo,
    contenido,
    proxied: false,
    ttl: 1,
    ...extra
  });

  const lista: RegistroDns[] = [
    reg('dominio1.com', 'A', '203.0.113.1', { proxied: true }),
    reg('dominio1.com', 'MX', 'mx2.correo.com', { prioridad: 20 }),
    reg('dominio1.com', 'MX', 'mx1.correo.com', { prioridad: 10 }),
    reg('dominio1.com', 'TXT', 'v=spf1 -all'),
    reg('www.dominio1.com', 'CNAME', 'dominio1.com', { proxied: true }),
    reg('api.dominio1.com', 'A', '203.0.113.2'),
    reg('api.dominio1.com', 'AAAA', '2001:db8::2'),
    reg('*.dominio1.com', 'A', '203.0.113.3'),
    reg('*.api.dominio1.com', 'CNAME', 'api.dominio1.com'),
    reg('_dmarc.dominio1.com', 'TXT', 'v=DMARC1; p=none'),
    reg('x._domainkey.dominio1.com', 'TXT', 'k=rsa')
  ];

  it('agrupa por host: el apex es @ y el comodin es *', () => {
    const g = agruparSubdominios('dominio1.com', lista);
    assert.deepEqual(
      g.map((s) => s.host),
      ['@', '*', '*.api', 'api', 'www', '_dmarc', 'x._domainkey']
    );
    const apex = g[0]!;
    assert.equal(apex.total, 4);
    assert.equal(apex.fqdn, 'dominio1.com');
    assert.equal(apex.proxied, true);
  });

  it('cuenta los registros, ordena los tipos y la prioridad de los MX', () => {
    const g = agruparSubdominios('dominio1.com', lista);
    const apex = g.find((s) => s.host === '@')!;
    assert.deepEqual(
      apex.registros.map((r) => `${r.tipo}:${r.prioridad ?? ''}`),
      ['A:', 'MX:10', 'MX:20', 'TXT:']
    );
    const api = g.find((s) => s.host === 'api')!;
    assert.equal(api.total, 2);
    assert.deepEqual(
      api.registros.map((r) => r.tipo),
      ['A', 'AAAA']
    );
  });

  it('marca proxied solo si un A/AAAA/CNAME lo esta, y web si hay alguno', () => {
    const g = agruparSubdominios('dominio1.com', lista);
    const por = (h: string) => g.find((s) => s.host === h)!;
    assert.equal(por('www').proxied, true);
    assert.equal(por('api').proxied, false);
    assert.equal(por('_dmarc').web, false);
    assert.equal(por('api').web, true);
    // Un TXT con proxied=true (no existe, pero por si acaso) no cuenta.
    const raro = agruparSubdominios('dominio1.com', [
      reg('t.dominio1.com', 'TXT', 'x', { proxied: true })
    ]);
    assert.equal(raro[0]!.proxied, false);
  });

  it('no oculta nada: los tecnicos salen al final y marcados', () => {
    const g = agruparSubdominios('dominio1.com', lista);
    assert.equal(
      g.reduce((n, s) => n + s.total, 0),
      lista.length
    );
    assert.deepEqual(
      g.filter((s) => s.tecnico).map((s) => s.host),
      ['_dmarc', 'x._domainkey']
    );
    assert.equal(g.at(-1)!.tecnico, true);
  });

  it('sin registros no hay subdominios', () => {
    assert.deepEqual(agruparSubdominios('dominio1.com', []), []);
  });
});
