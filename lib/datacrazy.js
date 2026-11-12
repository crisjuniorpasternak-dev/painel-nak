// Cliente da API do DataCrazy (somente leitura). Documentação: https://docs.datacrazy.io
// Limite da API: 60 requisições por minuto por rota; respeitamos o Retry-After quando vem 429.

const BASE = () => (process.env.DATACRAZY_API_URL || 'https://api.g1.datacrazy.io/api/v1').replace(/\/$/, '');
const POR_PAGINA = () => Number(process.env.DATACRAZY_POR_PAGINA || 500);
const LIMITE_SKIP = 10000; // acima disso a API devolve vazio

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

function montaUrl(caminho, params = {}) {
  const u = new URL(BASE() + caminho);
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue;
    if (typeof v === 'object') for (const [k2, v2] of Object.entries(v)) { if (v2 != null && v2 !== '') u.searchParams.set(`${k}[${k2}]`, String(v2)); }
    else u.searchParams.set(k, String(v));
  }
  return u;
}

export async function get(caminho, params = {}, tentativas = 5) {
  const token = process.env.DATACRAZY_TOKEN;
  if (!token) throw new Error('DATACRAZY_TOKEN não configurado nas variáveis de ambiente da Vercel.');
  const url = montaUrl(caminho, params);
  for (let i = 0; ; i++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (r.ok) return r.json();
    if ((r.status === 429 || r.status >= 500) && i < tentativas) {
      const s = Number(r.headers.get('retry-after')) || 2 ** i;
      await espera(Math.min(60, s) * 1000);
      continue;
    }
    const corpo = await r.text().catch(() => '');
    throw new Error(`DataCrazy ${r.status} em ${url.pathname}: ${corpo.slice(0, 300)}`);
  }
}

/** Lê todas as páginas de uma listagem ({count, data}). */
export async function todasPaginas(caminho, params = {}) {
  const take = POR_PAGINA();
  const itens = [];
  for (let skip = 0; ; skip += take) {
    if (skip >= LIMITE_SKIP) throw new Error(`Mais de ${LIMITE_SKIP} registros em ${caminho}; use janelas de data menores.`);
    const r = await get(caminho, { ...params, skip, take });
    const dados = Array.isArray(r) ? r : r.data || [];
    itens.push(...dados);
    if (dados.length < take) break;
  }
  return itens;
}

/** Janelas mensais [ini, fim) de `desde` até agora, em ISO, para não passar do limite de skip. */
export function janelasMensais(desde, ate = new Date()) {
  const j = [];
  let d = new Date(Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth(), 1));
  while (d <= ate) {
    const prox = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    j.push([d.toISOString(), new Date(prox.getTime() - 1).toISOString()]);
    d = prox;
  }
  return j;
}

export const api = {
  pipelines: () => todasPaginas('/pipelines'),
  etapas: (pipelineId) => get(`/pipelines/${pipelineId}/stages`).then((r) => r.data || r),
  vendedores: () => get('/attendants/crm').then((r) => r.data || r),
  lead: (id) => get(`/leads/${id}`),
  leadsCriadosEntre: (ini, fim) => todasPaginas('/leads', { filter: { createdAtGreaterOrEqual: ini, createdAtLessOrEqual: fim } }),
  negociosCriadosEntre: (ini, fim) => todasPaginas('/businesses', { filter: { createdAtGreaterOrEqual: ini, createdAtLessOrEqual: fim } }),
  negociosMovidosDesde: (ini) => todasPaginas('/businesses', { filter: { lastMovedAfter: ini } }),
};
