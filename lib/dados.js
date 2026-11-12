// Monta o pacote de dados que o painel desenha (mesmo formato do painel antigo, mais itens e data de criação).
import { q } from './db.js';

const FAIXAS = { 'saudáveis': '0 a 29 dias', 'saudavel': '0 a 29 dias', 'saudável': '0 a 29 dias', 'atenção': '30 a 44 dias', 'risco': '45 a 59 dias',
  'crítico': '60 a 89 dias', 'inativo': '90 a 119 dias', 'inativo 90+': '90 a 119 dias', 'inativos 120+': '120 dias ou mais' };

async function escolhePipeline(idEnv, padraoNome) {
  if (idEnv) return idEnv;
  // Sem id configurado: o pipeline com esse nome que tem mais negócios (há cópias antigas com o mesmo nome).
  const r = await q(`SELECT p.id FROM pipelines p JOIN etapas e ON e.pipeline_id = p.id LEFT JOIN negocios n ON n.etapa_id = e.id
                     WHERE p.nome ILIKE $1 GROUP BY p.id ORDER BY count(n.id) DESC LIMIT 1`, [padraoNome]);
  return r[0]?.id || null;
}

export async function montarDados() {
  const vendasId = await escolhePipeline(process.env.PIPELINE_VENDAS_ID, '%[Vendas]%');
  const cicloId = await escolhePipeline(process.env.PIPELINE_CICLO_ID, '%Ciclo de Compra%');
  const ignorar = (process.env.ETAPAS_IGNORADAS || 'Duplicado').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const tz = process.env.FUSO || 'America/Sao_Paulo';

  const negocios = await q(`
    SELECT codigo AS negocio, id, etapa, status, total::float8 AS valor, upper(trim(cliente)) AS cliente, lead_id, vendedor, coalesce(qtd_produtos, 0) AS itens,
           to_char(coalesce(movido_em, criado_em) AT TIME ZONE $2, 'YYYY-MM-DD') AS data,
           to_char(criado_em AT TIME ZONE $2, 'YYYY-MM-DD') AS criado, external_id AS pedido
    FROM vw_negocios
    WHERE pipeline_id = $1 AND NOT (lower(etapa) = ANY($3::text[]))
    ORDER BY codigo DESC`, [vendasId, tz, ignorar]);

  const itens = await q(`
    SELECT n.codigo AS negocio, i.produto_id, coalesce(i.sku, '') AS sku, coalesce(nullif(trim(i.produto), ''), 'Produto sem nome') AS produto,
           i.quantidade::float8 AS qtd, i.total::float8 AS total
    FROM negocio_itens i JOIN vw_negocios n ON n.id = i.negocio_id
    WHERE n.pipeline_id = $1 AND NOT (lower(n.etapa) = ANY($2::text[]))`, [vendasId, ignorar]);

  const ciclo = cicloId ? await q(`
    SELECT e.indice AS ordem, e.nome AS etapa, count(n.id)::int AS negocios
    FROM etapas e LEFT JOIN negocios n ON n.etapa_id = e.id
    WHERE e.pipeline_id = $1 GROUP BY e.id, e.indice, e.nome ORDER BY e.indice`, [cicloId]) : [];

  const clientes = await q(`
    SELECT upper(trim(n.cliente)) AS cliente, max(l.documento) AS documento, max(l.cidade) AS cidade, max(l.uf) AS uf,
           max(l.telefone) AS telefone, max(l.email) AS email, count(DISTINCT n.lead_id)::int AS leads
    FROM vw_negocios n LEFT JOIN leads l ON l.id = n.lead_id
    WHERE n.pipeline_id = $1 GROUP BY 1`, [vendasId]);

  const vendedores = await q('SELECT nome AS vendedor, email FROM vendedores ORDER BY nome');
  const [sinc] = await q(`SELECT fim, tipo FROM sincronizacoes WHERE ok ORDER BY fim DESC LIMIT 1`);

  return {
    atualizado_em: sinc?.fim || null,
    negocios: negocios.map(({ id, lead_id, ...r }) => r),
    itens: itens.map(({ produto_id, ...r }) => r),
    ciclo_crm: ciclo.map((r, i) => ({ funil: 'Ciclo de Compra', ordem: i, etapa: r.etapa, faixa: FAIXAS[String(r.etapa).toLowerCase()] || '', negocios: r.negocios })),
    vendedores,
    clientes,
  };
}
