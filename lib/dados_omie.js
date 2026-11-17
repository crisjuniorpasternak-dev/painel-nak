// Dados do painel a partir da Omie (ERP) e conferência pedido a pedido entre a Omie e o CRM.
// Mesmo formato de lib/dados.js (negocios, itens, vendedores, clientes), para o painel desenhar igual.
import { q } from './db.js';

const tz = () => process.env.FUSO || 'America/Sao_Paulo';
const desde = () => process.env.SINCRONIZAR_DESDE || '2024-01-01T00:00:00Z';

// Etapa da Omie com o mesmo nome das etapas do funil de vendas do CRM, para as telas e a conferência.
const ETAPA_SQL = `CASE WHEN p.cancelado THEN 'Cancelado' WHEN p.devolvido THEN 'Devolvido'
  WHEN p.faturado OR p.etapa IN ('60', '70', '80') THEN 'Faturado'
  WHEN p.etapa = '10' THEN 'Orçamento Gerado' WHEN p.etapa = '20' THEN 'Separação de Estoque' WHEN p.etapa = '50' THEN 'Aguardando Faturamento'
  ELSE 'Etapa ' || coalesce(p.etapa, '?') END`;
const STATUS_SQL = `CASE WHEN p.cancelado OR p.devolvido THEN 'lost' WHEN p.faturado OR p.etapa IN ('60', '70', '80') THEN 'won' ELSE 'in_process' END`;
const DATA_SQL = `coalesce(CASE WHEN p.faturado THEN p.faturado_em END, p.alterado_em, p.incluido_em)`;
const CLIENTE_SQL = `upper(coalesce(nullif(trim(c.razao_social), ''), nullif(trim(c.nome_fantasia), ''), 'Cliente ' || p.codigo_cliente::text))`;

/** E-mail do vendedor (atendente do CRM) ligado ao usuário; a Omie liga pelo e-mail do vendedor. */
async function emailDoVendedor(usuario) {
  if (usuario?.perfil !== 'vendedor') return null;
  if (!usuario.vendedor_id) return '__nenhum__';
  const [v] = await q('SELECT lower(email) AS email FROM vendedores WHERE id = $1', [usuario.vendedor_id]);
  return v?.email || '__nenhum__';
}

export async function montarDadosOmie(usuario = null) {
  const email = await emailDoVendedor(usuario);
  const filtroVend = `($2::text IS NULL OR lower(v.email) = $2)`;
  const base = `FROM omie_pedidos p LEFT JOIN omie_clientes c ON c.codigo = p.codigo_cliente LEFT JOIN omie_vendedores v ON v.codigo = p.codigo_vendedor
                WHERE ${DATA_SQL} >= $3::timestamptz AND ${filtroVend}`;

  const negocios = await q(`
    SELECT p.codigo_pedido AS id, coalesce(nullif(regexp_replace(p.numero, '\\D', '', 'g'), '')::bigint, p.codigo_pedido) AS negocio,
           ${ETAPA_SQL} AS etapa, ${STATUS_SQL} AS status, p.total::float8 AS valor, ${CLIENTE_SQL} AS cliente,
           coalesce(v.nome, 'Sem vendedor') AS vendedor, coalesce(p.qtd_itens, 0) AS itens,
           to_char(${DATA_SQL} AT TIME ZONE $1, 'YYYY-MM-DD') AS data, to_char(p.incluido_em AT TIME ZONE $1, 'YYYY-MM-DD') AS criado, p.numero AS pedido
    ${base} ORDER BY 2 DESC`, [tz(), email, desde()]);

  const itens = await q(`
    SELECT coalesce(nullif(regexp_replace(p.numero, '\\D', '', 'g'), '')::bigint, p.codigo_pedido) AS negocio, coalesce(i.sku, '') AS sku,
           coalesce(nullif(trim(i.produto), ''), 'Produto sem nome') AS produto, i.quantidade::float8 AS qtd, i.total::float8 AS total
    FROM omie_pedido_itens i JOIN omie_pedidos p ON p.codigo_pedido = i.codigo_pedido
    LEFT JOIN omie_vendedores v ON v.codigo = p.codigo_vendedor
    WHERE ${DATA_SQL} >= $3::timestamptz AND ${filtroVend} AND $1::text IS NOT NULL`, [tz(), email, desde()]);

  const clientes = await q(`
    SELECT ${CLIENTE_SQL} AS cliente, max(c.documento) AS documento, max(c.cidade) AS cidade, max(c.uf) AS uf,
           max(c.telefone) AS telefone, max(c.email) AS email, count(DISTINCT p.codigo_cliente)::int AS leads
    ${base} AND $1::text IS NOT NULL GROUP BY 1`, [tz(), email, desde()]);

  const vendedores = await q(`SELECT nome AS vendedor, email FROM omie_vendedores v WHERE ($1::text IS NULL OR lower(v.email) = $1) AND nome IS NOT NULL ORDER BY nome`, [email]);
  const [sinc] = await q(`SELECT fim FROM sincronizacoes WHERE ok AND tipo LIKE 'omie-%' ORDER BY fim DESC LIMIT 1`);
  const [pend] = await q(`SELECT valor FROM omie_estado WHERE chave = 'completa'`);

  return {
    fonte: 'omie',
    atualizado_em: sinc?.fim || null,
    carga_incompleta: Boolean(pend),
    negocios: negocios.map(({ id, ...r }) => ({ ...r, negocio: Number(r.negocio) })),
    itens: itens.map((r) => ({ ...r, negocio: Number(r.negocio) })),
    ciclo_crm: [],
    vendedores,
    clientes,
  };
}

const classe = (etapa, status) => (status === 'lost' || /^(perdido|cancelado|devolvido)$/i.test(etapa || '') ? 'perdido' : etapa === 'Faturado' ? 'faturado' : 'aberto');

/** Conferência pedido a pedido: número do pedido na Omie = externalId do negócio no CRM. */
export async function conferencia() {
  const ignorar = (process.env.ETAPAS_IGNORADAS || 'Duplicado').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const omie = await q(`
    SELECT p.numero AS pedido, ${ETAPA_SQL} AS etapa, ${STATUS_SQL} AS status, p.total::float8 AS valor, ${CLIENTE_SQL} AS cliente,
           coalesce(v.nome, 'Sem vendedor') AS vendedor, to_char(${DATA_SQL} AT TIME ZONE $1, 'YYYY-MM-DD') AS data
    FROM omie_pedidos p LEFT JOIN omie_clientes c ON c.codigo = p.codigo_cliente LEFT JOIN omie_vendedores v ON v.codigo = p.codigo_vendedor
    WHERE p.numero IS NOT NULL AND ${DATA_SQL} >= $2::timestamptz`, [tz(), desde()]);

  const vendasId = process.env.PIPELINE_VENDAS_ID || (await q(`SELECT p.id FROM pipelines p JOIN etapas e ON e.pipeline_id = p.id LEFT JOIN negocios n ON n.etapa_id = e.id
     WHERE p.nome ILIKE '%[Vendas]%' GROUP BY p.id ORDER BY count(n.id) DESC LIMIT 1`))[0]?.id || null;
  const crm = await q(`
    SELECT nullif(regexp_replace(trim(coalesce(external_id, '')), '^0+(\\d)', '\\1'), '') AS pedido, codigo AS negocio, etapa, status, total::float8 AS valor,
           upper(trim(cliente)) AS cliente, vendedor, to_char(coalesce(movido_em, criado_em) AT TIME ZONE $2, 'YYYY-MM-DD') AS data,
           to_char(criado_em AT TIME ZONE $2, 'YYYY-MM-DD') AS criado
    FROM vw_negocios WHERE pipeline_id = $1 AND NOT (lower(etapa) = ANY($3::text[]))`, [vendasId, tz(), ignorar]);

  // Pedidos da Omie anteriores ao primeiro negócio do CRM não entram como "só na Omie" (a integração ainda não existia).
  const crmDesde = crm.map((r) => r.criado || r.data).filter(Boolean).sort()[0] || null;
  const porPedido = new Map();
  const semNumero = [];
  for (const r of crm) {
    if (!r.pedido) { semNumero.push(r); continue; }
    const l = porPedido.get(r.pedido) || []; l.push(r); porPedido.set(r.pedido, l);
  }
  const linhas = [];
  const vistos = new Set();
  for (const o of omie) {
    vistos.add(o.pedido);
    const ns = porPedido.get(o.pedido) || [];
    if (!ns.length && (o.status === 'lost' || (crmDesde && o.data < crmDesde))) continue;
    const n = [...ns].sort((a, b) => String(b.data).localeCompare(String(a.data)))[0];
    let situacao = 'Confere';
    if (!n) situacao = 'Só na Omie';
    else if (ns.length > 1) situacao = 'Repetido no CRM';
    else if (classe(o.etapa, o.status) !== classe(n.etapa, n.status)) situacao = 'Etapa diferente';
    else if (Math.abs(o.valor - n.valor) > 0.05) situacao = 'Valor diferente';
    linhas.push({
      pedido: o.pedido, cliente: o.cliente, vendedor: o.vendedor, data: o.data,
      omie_etapa: o.etapa, omie_valor: o.valor, crm_etapa: n ? n.etapa : null, crm_valor: n ? n.valor : null, crm_cliente: n ? n.cliente : null,
      crm_negocios: ns.map((x) => x.negocio), dif: n ? Math.round((n.valor - o.valor) * 100) / 100 : null, situacao,
    });
  }
  for (const [pedido, ns] of porPedido) {
    if (vistos.has(pedido)) continue;
    const n = ns[0];
    linhas.push({ pedido, cliente: n.cliente, vendedor: n.vendedor, data: n.data, omie_etapa: null, omie_valor: null, crm_etapa: n.etapa, crm_valor: n.valor,
      crm_cliente: n.cliente, crm_negocios: ns.map((x) => x.negocio), dif: null, situacao: 'Só no CRM' });
  }
  for (const n of semNumero) {
    linhas.push({ pedido: null, cliente: n.cliente, vendedor: n.vendedor, data: n.data, omie_etapa: null, omie_valor: null, crm_etapa: n.etapa, crm_valor: n.valor,
      crm_cliente: n.cliente, crm_negocios: [n.negocio], dif: null, situacao: 'CRM sem nº do pedido' });
  }
  const [so] = await q(`SELECT fim FROM sincronizacoes WHERE ok AND tipo LIKE 'omie-%' ORDER BY fim DESC LIMIT 1`);
  const [sc] = await q(`SELECT fim FROM sincronizacoes WHERE ok AND tipo NOT LIKE 'omie-%' ORDER BY fim DESC LIMIT 1`);
  const [pend] = await q(`SELECT valor FROM omie_estado WHERE chave = 'completa'`);
  const sincronizacoes = await q(`SELECT tipo, inicio, fim, ok, negocios, leads, erro FROM sincronizacoes ORDER BY id DESC LIMIT 8`);
  return { sincronizacoes, crm_desde: crmDesde, omie_atualizado_em: so?.fim || null, crm_atualizado_em: sc?.fim || null, carga_incompleta: Boolean(pend), linhas };
}
