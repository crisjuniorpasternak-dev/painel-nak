// Ferramentas de teste: Postgres em memória (PGlite) e uma API DataCrazy falsa, montada a partir de dados de exemplo.
import { PGlite } from '@electric-sql/pglite';
import { definirExecutor } from '../lib/db.js';

export async function bancoEmMemoria() {
  const db = new PGlite();
  definirExecutor(async (t, p) => (await db.query(t, p)).rows);
  return db;
}

function rnd(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

/** Gera um CRM falso: { pipelines, etapas, vendedores, leads, negocios } no formato da API. */
export function crmFalso(linhas) {
  const r = rnd(42);
  const P_V = 'pipe-vendas', P_C = 'pipe-ciclo', P_OLD = 'pipe-ciclo-antigo';
  const etapasV = ['Orçamento Gerado', 'Separação de Estoque', 'Aguardando Faturamento', 'Faturado', 'Duplicado'].map((n, i) => ({ id: 'ev' + i, name: n, index: i, color: '#000' }));
  const etapasC = ['Saudáveis', 'Atenção', 'Risco', 'Crítico', 'Inativo 90+', 'Inativos 120+'].map((n, i) => ({ id: 'ec' + i, name: n, index: i }));
  const pipelines = [{ id: P_V, name: '[Vendas] [Omie]' }, { id: P_C, name: '[Ciclo de Compra]' }, { id: P_OLD, name: '[Ciclo de Compra]' }];
  const etapas = { [P_V]: etapasV, [P_C]: etapasC, [P_OLD]: [{ id: 'eold', name: 'Saudáveis', index: 0 }] };
  const nomesV = [...new Set(linhas.map((l) => l.vendedor))].filter((v) => v !== 'Sem vendedor');
  const vendedores = nomesV.map((n, i) => ({ id: 'v' + i, name: n, email: `v${i}@nak.test` }));
  const vid = new Map(vendedores.map((v) => [v.name, v.id]));
  const nomesL = [...new Set(linhas.map((l) => l.cliente))];
  const leads = nomesL.map((n, i) => ({ id: 'l' + i, name: n, taxId: String(10000000000000 + i), createdAt: '2025-03-01T10:00:00.000Z', address: { city: 'Joinville', state: 'SC' } }));
  const lid = new Map(leads.map((l) => [l.name, l.id]));
  const produtos = Array.from({ length: 60 }, (_, i) => ({ id: 'p' + i, id_sku: String(990000 + i), name: 'PRODUTO TESTE ' + i, price: 50 + i * 13 }));
  const eid = new Map(etapasV.map((e) => [e.name, e.id]));
  const negocios = linhas.map((l, i) => {
    const mov = l.data + 'T15:00:00.000Z';
    const criado = new Date(Date.parse(mov) - Math.floor(r() * 20) * 864e5).toISOString();
    const n = 1 + Math.floor(r() * 3);
    const itens = Array.from({ length: n }, () => { const p = produtos[Math.floor(r() ** 2 * produtos.length)]; return { p, q: 1 + Math.floor(r() * 4) }; });
    const soma = itens.reduce((s, x) => s + x.q * x.p.price, 0) || 1;
    return {
      id: 'b' + i, code: l.negocio, status: l.status, total: l.valor, stageId: eid.get(l.etapa), leadId: lid.get(l.cliente), attendantId: vid.get(l.vendedor) || null,
      createdAt: criado, lastMovedAt: mov, statusChangedAt: mov, externalId: String(100000 + i), productsCount: n,
      products: itens.map((x, k) => ({ id: `bp${i}-${k}`, product: x.p, quantity: x.q, price: x.p.price, total: Math.round(l.valor * (x.q * x.p.price) / soma * 100) / 100 })),
    };
  });
  // 30 duplicados e 300 negócios do ciclo de compra
  for (let i = 0; i < 30; i++) negocios.push({ ...negocios[i], id: 'dup' + i, stageId: 'ev4' });
  for (let i = 0; i < 300; i++) negocios.push({ id: 'c' + i, code: 90000 + i, status: 'in_process', total: 0, stageId: 'ec' + (i % 6), leadId: 'l' + i, createdAt: '2026-10-01T10:00:00Z', lastMovedAt: '2026-11-01T10:00:00Z', products: [] });
  return { pipelines, etapas, vendedores, leads, negocios };
}

/** Substitui fetch por uma API DataCrazy falsa. Devolve um contador de chamadas. */
export function apiFalsa(crm, base = 'https://api.g1.datacrazy.io/api/v1') {
  const chamadas = [];
  globalThis.fetch = async (url, opt) => {
    const u = new URL(url);
    chamadas.push(u.pathname + u.search);
    if (opt?.headers?.Authorization !== 'Bearer token-teste') return new Response('{"message":"unauthorized"}', { status: 401 });
    const caminho = u.pathname.replace(new URL(base).pathname, '');
    const f = (k) => u.searchParams.get(`filter[${k}]`);
    const pag = (lista) => {
      const skip = Number(u.searchParams.get('skip') || 0), take = Number(u.searchParams.get('take') || 50);
      if (skip > 10000) return Response.json({ count: lista.length, data: [], details: 'skip máximo 10000' });
      return Response.json({ count: lista.length, data: lista.slice(skip, skip + take) });
    };
    let m;
    if (caminho === '/pipelines') return pag(crm.pipelines);
    if ((m = caminho.match(/^\/pipelines\/([^/]+)\/stages$/))) return Response.json({ count: crm.etapas[m[1]].length, data: crm.etapas[m[1]] });
    if (caminho === '/attendants/crm') return Response.json({ count: crm.vendedores.length, data: crm.vendedores });
    if ((m = caminho.match(/^\/leads\/([^/]+)$/))) { const l = crm.leads.find((x) => x.id === m[1]); return l ? Response.json(l) : new Response('{}', { status: 404 }); }
    if (caminho === '/leads') return pag(crm.leads.filter((l) => (!f('createdAtGreaterOrEqual') || l.createdAt >= f('createdAtGreaterOrEqual')) && (!f('createdAtLessOrEqual') || l.createdAt <= f('createdAtLessOrEqual'))));
    if (caminho === '/businesses') return pag(crm.negocios.filter((b) =>
      (!f('createdAtGreaterOrEqual') || b.createdAt >= f('createdAtGreaterOrEqual')) && (!f('createdAtLessOrEqual') || b.createdAt <= f('createdAtLessOrEqual')) &&
      (!f('lastMovedAfter') || b.lastMovedAt >= f('lastMovedAfter'))));
    return new Response('{}', { status: 404 });
  };
  return chamadas;
}
