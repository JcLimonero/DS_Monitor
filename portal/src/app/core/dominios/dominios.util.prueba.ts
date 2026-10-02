import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  Dominio,
  RegistroDns,
  Subdominio,
  ZonaCloudflare
} from '../sources/gateway/puente-admin.service';
import {
  claseVencimiento,
  destinoLegible,
  estadoDeZona,
  etiquetaTtl,
  filtrarSubdominios,
  textoVencimiento,
  unificarDominios,
  urlParaAbrir,
  zonasPorImportar
} from './dominios.util';

const AHORA = new Date('2026-10-02T12:00:00');

const manual = (nombre: string, extra: Partial<Dominio> = {}): Dominio => ({
  nombre,
  venceEn: '2027-01-01T12:00:00.000Z',
  ...extra
});
const zona = (nombre: string, extra: Partial<ZonaCloudflare> = {}) => ({
  id: nombre,
  nombre,
  estado: 'active',
  servidoresDeNombres: [],
  pausada: false,
  ...extra
});

describe('unificarDominios', () => {
  it('un dominio en los dos lados sale una vez con los dos origenes', () => {
    const lista = unificarDominios(
      [manual('a.com'), manual('b.com')],
      [zona('A.com'), zona('c.com')]
    );
    assert.deepEqual(
      lista.map((d) => [d.nombre, d.origenes.join('+')]),
      [
        ['a.com', 'manual+cloudflare'],
        ['b.com', 'manual'],
        ['c.com', 'cloudflare']
      ]
    );
    assert.ok(lista[0]!.manual && lista[0]!.zona);
  });

  it('ordena por vencimiento y deja al final los que no tienen fecha', () => {
    const lista = unificarDominios(
      [
        manual('tarde.com', { venceEn: '2028-01-01T00:00:00.000Z' }),
        manual('pronto.com', { venceEn: '2026-11-01T00:00:00.000Z' }),
        manual('sin.com', {
          sinFecha: true,
          venceEn: '9999-12-31T00:00:00.000Z'
        })
      ],
      [
        zona('zeta.com'),
        zona('alfa.com', {
          registro: { venceEn: '2027-06-01T00:00:00.000Z', autoRenovar: true }
        })
      ]
    );
    assert.deepEqual(
      lista.map((d) => d.nombre),
      ['pronto.com', 'alfa.com', 'tarde.com', 'sin.com', 'zeta.com']
    );
  });

  it('la fecha capturada manda; sin fecha usa la del Registrar; nunca el relleno', () => {
    const registro = {
      venceEn: '2027-06-01T00:00:00.000Z',
      autoRenovar: false
    };
    const [a, b, c] = unificarDominios(
      [
        manual('a.com'),
        manual('b.com', { sinFecha: true, venceEn: '9999-12-31T00:00:00.000Z' })
      ],
      [zona('a.com', { registro }), zona('b.com', { registro }), zona('c.com')]
    );
    assert.equal(a!.venceEn, '2027-01-01T12:00:00.000Z');
    assert.equal(b!.venceEn, registro.venceEn);
    assert.equal(c!.venceEn, undefined);
    const solo = unificarDominios(
      [
        manual('b.com', { sinFecha: true, venceEn: '9999-12-31T00:00:00.000Z' })
      ],
      []
    );
    assert.equal(solo[0]!.venceEn, undefined);
  });

  it('listas vacias', () => {
    assert.deepEqual(unificarDominios([], []), []);
  });
});

describe('vencimiento y estado', () => {
  it('sin fecha dice "Sin fecha de vencimiento", no "Vence en"', () => {
    assert.equal(textoVencimiento(undefined), 'Sin fecha de vencimiento');
    assert.equal(
      textoVencimiento('2026-10-12T12:00:00', AHORA),
      'Vence en 10 días'
    );
    assert.equal(
      textoVencimiento('2026-10-03T12:00:00', AHORA),
      'Vence mañana'
    );
    assert.equal(
      textoVencimiento('2026-09-29T12:00:00', AHORA),
      'Vencido hace 3 días'
    );
    assert.match(claseVencimiento(undefined), /ink-muted/);
    assert.match(claseVencimiento('2026-09-29T12:00:00', AHORA), /danger/);
    assert.match(claseVencimiento('2026-10-05T12:00:00', AHORA), /warn/);
    assert.match(claseVencimiento('2027-10-05T12:00:00', AHORA), /ok/);
  });

  it('estado de la zona', () => {
    assert.deepEqual(estadoDeZona(zona('a.com')), {
      texto: 'Activo',
      tono: 'ok'
    });
    assert.equal(
      estadoDeZona(zona('a.com', { pausada: true })).texto,
      'En pausa'
    );
    assert.equal(
      estadoDeZona(zona('a.com', { estado: 'pending' })).tono,
      'warn'
    );
    assert.equal(estadoDeZona(zona('a.com', { estado: 'raro' })).texto, 'raro');
  });

  it('zonas por importar: las que aun no estan capturadas', () => {
    assert.deepEqual(
      zonasPorImportar(
        [manual('a.com')],
        [zona('A.com'), zona('b.com'), zona('c.com')]
      ).map((z) => z.nombre),
      ['b.com', 'c.com']
    );
  });
});

describe('subdominios', () => {
  const reg = (tipo: string, contenido: string, extra = {}): RegistroDns => ({
    id: `${tipo}${contenido}`,
    nombre: 'x',
    tipo,
    contenido,
    proxied: false,
    ttl: 1,
    ...extra
  });
  const sub = (
    host: string,
    registros: RegistroDns[],
    extra: Partial<Subdominio> = {}
  ): Subdominio => ({
    host,
    fqdn: host === '@' ? 'a.com' : `${host}.a.com`,
    registros,
    total: registros.length,
    proxied: false,
    web: registros.some((r) => ['A', 'AAAA', 'CNAME'].includes(r.tipo)),
    tecnico: host.startsWith('_'),
    ...extra
  });
  const lista = [
    sub('@', [
      reg('A', '203.0.113.1'),
      reg('MX', 'mx.correo.com', { prioridad: 10 })
    ]),
    sub('api', [reg('A', '10.0.0.5', { comentario: 'Servidor de Nexus' })]),
    sub('*', [reg('A', '203.0.113.9')]),
    sub('_dmarc', [reg('TXT', 'v=DMARC1; p=none')])
  ];

  it('el buscador mira host, nombre, tipo, destino y comentario', () => {
    const hosts = (t: string) =>
      filtrarSubdominios(lista, t).map((s) => s.host);
    assert.deepEqual(hosts(''), ['@', 'api', '*', '_dmarc']);
    assert.deepEqual(hosts('  API '), ['api']);
    assert.deepEqual(hosts('10.0.0'), ['api']);
    assert.deepEqual(hosts('nexus'), ['api']);
    assert.deepEqual(hosts('mx'), ['@']);
    assert.deepEqual(hosts('txt'), ['_dmarc']);
    assert.deepEqual(hosts('a.com'), ['@', 'api', '*', '_dmarc']);
    assert.deepEqual(hosts('no-existe'), []);
  });

  it('solo se puede abrir lo que es web, sin comodin ni tecnico', () => {
    assert.equal(urlParaAbrir(lista[0]!), 'https://a.com');
    assert.equal(urlParaAbrir(lista[1]!), 'https://api.a.com');
    assert.equal(urlParaAbrir(lista[2]!), undefined);
    assert.equal(urlParaAbrir(lista[3]!), undefined);
    assert.equal(
      urlParaAbrir(sub('x', [reg('A', '1')], { fqdn: 'x.com/<script>' })),
      undefined
    );
  });

  it('TTL y destino se leen como en Cloudflare', () => {
    assert.equal(etiquetaTtl(1), 'Auto');
    assert.equal(etiquetaTtl(300), '5 min');
    assert.equal(etiquetaTtl(3600), '1 h');
    assert.equal(etiquetaTtl(90), '90 s');
    assert.equal(
      destinoLegible(reg('MX', 'mx.correo.com', { prioridad: 10 })),
      '10 mx.correo.com'
    );
    assert.equal(destinoLegible(reg('A', '1.2.3.4')), '1.2.3.4');
  });
});
