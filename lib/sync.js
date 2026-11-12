// Sincroniza o CRM DataCrazy com o banco do painel. Só lê o CRM; nunca escreve nele.
//  - completa: relê tudo (negócios e leads por janelas mensais de criação) e remove do banco
//    os negócios que não existem mais no CRM.
//  - incremental: relê negócios movidos ou criados nos últimos dias e busca leads que faltam.
import { q } from './db.js';
import { api as apiPadrao, janelasMensais } from './datacrazy.js';

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const txt = (v) => (v == null ? null : String(v));

async function upsert(tabela, colunas, chave, linhas, tipos) {
  if (!linhas.length) return 0;
  // Um INSERT ... SELECT unnest(...) por lote: rápido e com poucos parâmetros.
  for (let i = 0; i < linhas.length; i += 1000) {
    const lote = linhas.slice(i, i + 1000);
    const params = colunas.map((c) => lote.map((l) => l[c]));
    const sel = colunas.map((c, j) => `$${j + 1}::${tipos[c]}[]`).join(', ');
    const upd = colunas.filter((c) => !chave.includes(c)).map((c) => `${c} = excluded.${c}`).join(', ');
    await q(`INSERT INTO ${tabela} (${colunas.join(', ')}) SELECT * FROM unnest(${sel})
             ON CONFLICT (${chave.join(', ')}) DO UPDATE SET ${upd}`, params);
  }
  return linhas.length;
}

async function salvarNegocios(lista, agora) {
  const vistos = new Map();
  for (const b of lista) if (b && b.id) vistos.set(b.id, b);
  const negocios = [...vistos.values()];
  await upsert('negocios',
    ['id', 'codigo', 'etapa_id', 'lead_id', 'vendedor_id', 'status', 'total', 'desconto', 'criado_em', 'movido_em', 'status_em', 'external_id', 'qtd_produtos', 'visto_em'],
    ['id'],
    negocios.map((b) => ({
      id: b.id, codigo: num(b.code), etapa_id: txt(b.stageId), lead_id: txt(b.leadId), vendedor_id: txt(b.attendantId), status: txt(b.status),
      total: num(b.total) ?? 0, desconto: num(b.discount), criado_em: txt(b.createdAt), movido_em: txt(b.lastMovedAt), status_em: txt(b.statusChangedAt),
      external_id: txt(b.externalId), qtd_produtos: num(b.productsCount), visto_em: agora,
    })),
    { id: 'text', codigo: 'integer', etapa_id: 'text', lead_id: 'text', vendedor_id: 'text', status: 'text', total: 'numeric', desconto: 'numeric',
      criado_em: 'timestamptz', movido_em: 'timestamptz', status_em: 'timestamptz', external_id: 'text', qtd_produtos: 'integer', visto_em: 'timestamptz' });

  // Itens: só substitui os dos negócios que vieram com a lista de produtos.
  const comItens = negocios.filter((b) => Array.isArray(b.products));
  if (comItens.length) {
    await q('DELETE FROM negocio_itens WHERE negocio_id = ANY($1::text[])', [comItens.map((b) => b.id)]);
    const itens = comItens.flatMap((b) => b.products.map((p, ordem) => ({
      negocio_id: b.id, ordem, produto_id: txt(p.product?.id ?? p.productId), sku: txt(p.product?.id_sku), produto: txt(p.product?.name ?? p.name),
      quantidade: num(p.quantity) ?? 0, preco: num(p.price), total: num(p.total) ?? (num(p.quantity) ?? 0) * (num(p.price) ?? 0),
    })));
    await upsert('negocio_itens', ['negocio_id', 'ordem', 'produto_id', 'sku', 'produto', 'quantidade', 'preco', 'total'], ['negocio_id', 'ordem'], itens,
      { negocio_id: 'text', ordem: 'integer', produto_id: 'text', sku: 'text', produto: 'text', quantidade: 'numeric', preco: 'numeric', total: 'numeric' });
  }
  return negocios.length;
}

async function salvarLeads(lista) {
  const m = new Map();
  for (const l of lista) if (l && l.id) m.set(l.id, l);
  return upsert('leads', ['id', 'nome', 'documento', 'empresa', 'telefone', 'email', 'cidade', 'uf', 'criado_em', 'atualizado'], ['id'],
    [...m.values()].map((l) => ({
      id: l.id, nome: txt(l.name), documento: txt(l.taxId), empresa: txt(typeof l.company === 'object' ? l.company?.name : l.company),
      telefone: txt(l.phone), email: txt(l.email), cidade: txt(l.address?.city), uf: txt(l.address?.state), criado_em: txt(l.createdAt), atualizado: new Date().toISOString(),
    })),
    { id: 'text', nome: 'text', documento: 'text', empresa: 'text', telefone: 'text', email: 'text', cidade: 'text', uf: 'text', criado_em: 'timestamptz', atualizado: 'timestamptz' });
}

async function salvarEstrutura(api) {
  const pipelines = await api.pipelines();
  await upsert('pipelines', ['id', 'nome', 'atualizado'], ['id'], pipelines.map((p) => ({ id: p.id, nome: txt(p.name) || '', atualizado: new Date().toISOString() })),
    { id: 'text', nome: 'text', atualizado: 'timestamptz' });
  const etapas = [];
  for (const p of pipelines) for (const e of await api.etapas(p.id)) etapas.push({ id: e.id, pipeline_id: p.id, nome: txt(e.name) || '', indice: num(e.index) ?? 0, cor: txt(e.color), atualizado: new Date().toISOString() });
  await upsert('etapas', ['id', 'pipeline_id', 'nome', 'indice', 'cor', 'atualizado'], ['id'], etapas,
    { id: 'text', pipeline_id: 'text', nome: 'text', indice: 'integer', cor: 'text', atualizado: 'timestamptz' });
  const vend = await api.vendedores();
  await upsert('vendedores', ['id', 'nome', 'email', 'atualizado'], ['id'], vend.map((v) => ({ id: v.id, nome: txt(v.name) || '', email: txt(v.email), atualizado: new Date().toISOString() })),
    { id: 'text', nome: 'text', email: 'text', atualizado: 'timestamptz' });
}

async function leadsQueFaltam(api, limite) {
  const faltam = await q(`SELECT DISTINCT n.lead_id FROM negocios n LEFT JOIN leads l ON l.id = n.lead_id
                          WHERE n.lead_id IS NOT NULL AND l.id IS NULL LIMIT ${Number(limite)}`);
  const achados = [];
  for (const { lead_id } of faltam) {
    try { achados.push(await api.lead(lead_id)); } catch (e) { if (!/ 404 /.test(e.message)) throw e; }
  }
  return salvarLeads(achados.map((r) => r?.data && !Array.isArray(r.data) ? r.data : r));
}

export async function sincronizar(tipo = 'incremental', { api = apiPadrao, agora = new Date() } = {}) {
  const [{ id }] = await q('INSERT INTO sincronizacoes (tipo) VALUES ($1) RETURNING id', [tipo]);
  const inicio = agora.toISOString();
  const res = { tipo, negocios: 0, leads: 0, removidos: 0 };
  try {
    await salvarEstrutura(api);
    if (tipo === 'completa') {
      const desde = new Date(process.env.SINCRONIZAR_DESDE || '2024-01-01T00:00:00Z');
      for (const [ini, fim] of janelasMensais(desde, agora)) {
        res.leads += await salvarLeads(await api.leadsCriadosEntre(ini, fim));
        res.negocios += await salvarNegocios(await api.negociosCriadosEntre(ini, fim), inicio);
      }
      // Negócios criados antes de SINCRONIZAR_DESDE, mas que mudaram de etapa depois, também entram.
      res.negocios += await salvarNegocios(await api.negociosMovidosDesde(desde.toISOString()), inicio);
      const rem = await q('DELETE FROM negocios WHERE visto_em < $1::timestamptz RETURNING id', [inicio]);
      res.removidos = rem.length;
    } else {
      const dias = Number(process.env.SINCRONIZAR_DIAS || 3);
      const desde = new Date(agora.getTime() - dias * 864e5).toISOString();
      res.negocios += await salvarNegocios(await api.negociosMovidosDesde(desde), inicio);
      res.negocios += await salvarNegocios(await api.negociosCriadosEntre(desde, agora.toISOString()), inicio);
      res.leads += await salvarLeads(await api.leadsCriadosEntre(desde, agora.toISOString()));
    }
    res.leads += await leadsQueFaltam(api, tipo === 'completa' ? 300 : 50);
    await q('UPDATE sincronizacoes SET fim = now(), ok = true, negocios = $2, leads = $3, removidos = $4 WHERE id = $1', [id, res.negocios, res.leads, res.removidos]);
    return { ok: true, ...res };
  } catch (e) {
    await q('UPDATE sincronizacoes SET fim = now(), ok = false, erro = $2 WHERE id = $1', [id, String(e.message || e).slice(0, 1000)]);
    return { ok: false, ...res, erro: String(e.message || e) };
  }
}
