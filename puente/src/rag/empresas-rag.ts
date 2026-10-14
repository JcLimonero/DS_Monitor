import { normalizarTexto } from '../proveedores/fireflies.js';

/**
 * Itech vive en las mismas tablas, con esta empresa. Las consultas la
 * excluyen salvo que quien pregunta la pida y tenga permiso.
 */
export const EMPRESA_ITECH = 'itech-dev';

/**
 * Slugs que ya usa el puente. Los alias cubren los nombres del frontmatter
 * y de las carpetas de Drive (la propuesta escribia nexus-q-tech y
 * operativ-ai; aqui se quedan los ids del catalogo).
 */
const ALIAS: Record<string, string> = {
  itech: EMPRESA_ITECH,
  'itech dev': EMPRESA_ITECH,
  'itech-dev': EMPRESA_ITECH,
  dealer: 'dealer-solutions',
  'dealer solutions': 'dealer-solutions',
  'dealer-solutions': 'dealer-solutions',
  nexus: 'nexusqtech',
  nexusqtech: 'nexusqtech',
  'nexus q tech': 'nexusqtech',
  'nexus-q-tech': 'nexusqtech',
  operativ: 'operativai',
  operativai: 'operativai',
  'operativ ai': 'operativai',
  'operativ-ai': 'operativai',
  limonlabs: 'limonlabs',
  'limon labs': 'limonlabs'
};

export interface EmpresaCatalogo {
  id: string;
  nombre: string;
}

/** Id canonico, o nada si el texto no es una empresa conocida. */
export function empresaIdDe(
  valor: string | undefined,
  catalogo: readonly EmpresaCatalogo[] = []
): string | undefined {
  if (!valor?.trim()) {
    return undefined;
  }
  const crudo = valor.trim();
  const plano = normalizarTexto(crudo);
  const slug = plano.replace(/ /g, '-');
  const alias = ALIAS[plano] ?? ALIAS[slug] ?? ALIAS[crudo.toLowerCase()];
  if (alias) {
    return alias;
  }
  const porId = catalogo.find((e) => e.id === crudo || e.id === slug);
  if (porId) {
    return porId.id;
  }
  const porNombre = catalogo.find((e) => normalizarTexto(e.nombre) === plano);
  return porNombre?.id;
}

/**
 * La empresa de una ruta de Drive. Solo acepta un segmento que sea alias o
 * empresa del catalogo: el nombre del cliente no se promueve a empresa.
 */
export function empresaDeRuta(
  ruta: string | undefined,
  catalogo: readonly EmpresaCatalogo[] = []
): string | undefined {
  if (!ruta?.trim()) {
    return undefined;
  }
  const partes = ruta.split(/[/\\]+/).filter(Boolean);
  const indice = partes.findIndex((p) => normalizarTexto(p) === 'empresas');
  const desde = indice >= 0 ? partes.slice(indice + 1) : partes;
  for (const parte of desde) {
    const id = empresaIdDe(parte, catalogo);
    if (id) {
      return id;
    }
  }
  return undefined;
}
