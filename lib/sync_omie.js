// Sincroniza a Omie (ERP) com tabelas próprias do banco (omie_*). Só lê a Omie; nunca escreve nela.
//  - completa: relê vendedores, clientes e todos os pedidos de venda. Pode levar mais de uma chamada: quando o tempo
//    da função está acabando, guarda a página em omie_estado e a próxima chamada continua dali. No fim, tira do banco
//    os pedidos que não existem mais na Omie.
//  - incremental: relê vendedores, clientes e pedidos incluídos ou alterados nos últimos dias.
import { q } from './db.js';
import { upsert } from './sync.js';
import { omie as apiPadrao } from './omie.js';

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const txt = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
const sn = (v) => String(v || '').toUpperCase() === 'S';
export const numeroPedido = (v) => { const s = txt(v); return s ? s.replace(/^0+(?=\d)/, '') : null; };

/** "17/11/2026" + "10:22:33" (horário de Brasília) → ISO. */
export function dataOmie(d, h) {
  const m = String(d || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const hm = String(h || '').match(/^(\d{2}):(\d{2})(?::(\d{2}))?/);
  return `${m[3]}-${m[2]}-${m[1]}T${hm ? `${hm[1]}:${hm[2]}:${hm[3] || '00'}` : '12:00:00'}-03:00`;
}

async function salvarVendedores(lista) {
  return upsert('omie_vendedores', ['codigo', 'nome', 'email', 'inativo', 'atualizado'], ['codigo'],
    lista.filter((v) => num(v.codigo) != null).map((v) => ({ codigo: num(v.codigo), nome: txt(v.nome), email: txt(v.email)?.toLowerCase() ?? null, inativo: sn(v.inativo), atualizado: new Date().toISOString() })),
    { codigo: 'bigint', nome: 'text', email: 'text', inativo: 'boolean', atualizado: 'timestamptz' });
}

async function salvarClientes(lista) {
  const m = new Map();
  for (const c of lista) if (num(c?.codigo_cliente_omie) != null) m.set(num(c.codigo_cliente_omie), c);
  return upsert('omie_clientes', ['codigo', 'razao_social', 'nome_fantasia', 'documento', 'cidade', 'uf', 'telefone', 'email', 'inativo', 'atualizado'], ['codigo'],
    [...m.values()].map((c) => ({
      codigo: num(c.codigo_cliente_omie), razao_social: txt(c.razao_social), nome_fantasia: txt(c.nome_fantasia), documento: txt(c.cnpj_cpf),
      cidade: txt(String(c.cidade || '').replace(/\s*\([A-Z]{2}\)\s*$/, '')), uf: txt(c.estado),
      telefone: txt([c.telefone1_ddd, c.telefone1_numero].filter(Boolean).join(' ')), email: txt(c.email), inativo: sn(c.inativo), atualizado: new Date().toISOString(),
    })),
    { codigo: 'bigint', razao_social: 'text', nome_fantasia: 'text', documento: 'text', cidade: 'text', uf: 'text', telefone: 'text', email: 'text', inativo: 'boolean', atualizado: 'timestamptz' });
}

async function salvarPedidos(lista, agora) {
  const m = new Map();
  for (const p of lista) if (num(p?.cabecalho?.codigo_pedido) != null) m.set(num(p.cabecalho.codigo_pedido), p);
  const pedidos = [...m.values()];
  if (!pedidos.length) return 0;
  const itensDe = (p) => (Array.isArray(p.det) ? p.det : []).map((d, ordem) => {
    const pr = d.produto || {};
    const qtd = num(pr.quantidade) ?? 0, preco = num(pr.valor_unitario);
    return {
      codigo_pedido: num(p.cabecalho.codigo_pedido), ordem, codigo_produto: num(pr.codigo_produto), sku: txt(pr.codigo), produto: txt(pr.descricao),
      quantidade: qtd, preco, total: num(pr.valor_total) ?? Math.round((qtd * (preco ?? 0) - (num(pr.valor_desconto) ?? 0)) * 100) / 100,
    };
  });
  await upsert('omie_pedidos',
    ['codigo_pedido', 'numero', 'codigo_cliente', 'codigo_vendedor', 'etapa', 'faturado', 'cancelado', 'devolvido', 'total', 'incluido_em', 'alterado_em', 'faturado_em', 'qtd_itens', 'visto_em'],
    ['codigo_pedido'],
    pedidos.map((p) => {
      const c = p.cabecalho, i = p.infoCadastro || {}, t = p.total_pedido || {}, a = p.informacoes_adicionais || {};
      const itens = itensDe(p);
      return {
        codigo_pedido: num(c.codigo_pedido), numero: numeroPedido(c.numero_pedido), codigo_cliente: num(c.codigo_cliente), codigo_vendedor: num(a.codVend ?? c.codigo_vendedor),
        etapa: txt(c.etapa), faturado: sn(i.faturado), cancelado: sn(i.cancelado), devolvido: sn(i.devolvido),
        total: num(t.valor_total_pedido) ?? itens.reduce((s, x) => s + x.total, 0),
        incluido_em: dataOmie(i.dInc, i.hInc), alterado_em: dataOmie(i.dAlt, i.hAlt), faturado_em: dataOmie(i.dFat, i.hFat),
        qtd_itens: num(c.quantidade_itens) ?? itens.length, visto_em: agora,
      };
    }),
    { codigo_pedido: 'bigint', numero: 'text', codigo_cliente: 'bigint', codigo_vendedor: 'bigint', etapa: 'text', faturado: 'boolean', cancelado: 'boolean', devolvido: 'boolean',
      total: 'numeric', incluido_em: 'timestamptz', alterado_em: 'timestamptz', faturado_em: 'timestamptz', qtd_itens: 'integer', visto_em: 'timestamptz' });
  const comItens = pedidos.filter((p) => Array.isArray(p.det));
  if (comItens.length) {
    await q('DELETE FROM omie_pedido_itens WHERE codigo_pedido = ANY($1::bigint[])', [comItens.map((p) => num(p.cabecalho.codigo_pedido))]);
    await upsert('omie_pedido_itens', ['codigo_pedido', 'ordem', 'codigo_produto', 'sku', 'produto', 'quantidade', 'preco', 'total'], ['codigo_pedido', 'ordem'], comItens.flatMap(itensDe),
      { codigo_pedido: 'bigint', ordem: 'integer', codigo_produto: 'bigint', sku: 'text', produto: 'text', quantidade: 'numeric', preco: 'numeric', total: 'numeric' });
  }
  return pedidos.length;
}

const FASES = ['vendedores', 'clientes', 'pedidos'];

export async function sincronizarOmie(tipo = 'incremental', { api = apiPadrao, agora = new Date(), tempoMs = Number(process.env.OMIE_TEMPO_MS || 240000) } = {}) {
  const prazo = Date.now() + tempoMs;
  const [{ id }] = await q('INSERT INTO sincronizacoes (tipo) VALUES ($1) RETURNING id', ['omie-' + tipo]);
  const res = { fonte: 'omie', tipo, vendedores: 0, clientes: 0, pedidos: 0, removidos: 0, parcial: false };
  let agoraIso = agora.toISOString();
  const salvar = { vendedores: salvarVendedores, clientes: salvarClientes, pedidos: (l) => salvarPedidos(l, agoraIso) };
  try {
    const [pend] = await q("SELECT valor FROM omie_estado WHERE chave = 'completa'");
    const [{ n: temDados }] = await q('SELECT count(*)::int AS n FROM omie_pedidos');
    // 1) Incremental primeiro (rápido): mantém o painel em dia mesmo enquanto uma carga completa anda em partes.
    if (temDados) {
      // Últimos dias, ou desde a última sincronização que deu certo (se faz mais tempo), para não deixar buraco.
      const dias = Number(process.env.SINCRONIZAR_DIAS || 3);
      const [ult] = await q(`SELECT max(inicio) AS t FROM sincronizacoes WHERE tipo LIKE 'omie-%' AND ok`);
      const desde = new Date(Math.min(agora.getTime() - dias * 864e5, ult?.t ? new Date(ult.t).getTime() - 864e5 : Infinity));
      for (const fase of FASES) {
        for (let n = 1; ; n++) {
          const { itens, totalPaginas } = fase === 'vendedores' ? await api.vendedores(n) : await api[fase](n, desde);
          res[fase] += await salvar[fase](itens);
          if (!itens.length || n >= totalPaginas) break;
        }
      }
    }
    // 2) Carga completa (nova, ou continuando de onde parou) com o tempo que sobrar.
    // Depois da primeira carga, só relê tudo quando pedirem explicitamente (tipo=completa); no dia a dia, só a incremental.
    const [feita] = await q(`SELECT 1 FROM omie_estado WHERE chave = 'primeira_carga'
      UNION ALL SELECT 1 FROM sincronizacoes WHERE tipo LIKE 'omie-%' AND ok AND erro IS NULL LIMIT 1`);
    let st = pend?.valor || null;
    if (st && feita && tipo !== 'completa') { await q("DELETE FROM omie_estado WHERE chave = 'completa'"); st = null; }
    if (!st && (tipo === 'completa' || !temDados)) st = { fase: 'vendedores', pagina: 1, inicio: agoraIso };
    if (st) {
      res.tipo = 'completa'; res.continuou = Boolean(pend);
      agoraIso = st.inicio; // todas as partes marcam o mesmo visto_em, para achar os pedidos apagados no fim
      let feitas = 0; // cada chamada avança pelo menos uma página
      for (let f = FASES.indexOf(st.fase); f < FASES.length; f++) {
        const fase = FASES[f];
        for (let n = fase === st.fase ? st.pagina : 1; ; n++) {
          if (feitas > 0 && Date.now() > prazo) {
            await q(`INSERT INTO omie_estado (chave, valor) VALUES ('completa', $1::jsonb)
                     ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor, atualizado = now()`, [JSON.stringify({ ...st, fase, pagina: n })]);
            res.parcial = true; res.proxima = { fase, pagina: n };
            break;
          }
          const { itens, totalPaginas } = await api[fase](n);
          res[fase] += await salvar[fase](itens);
          feitas++;
          if (!itens.length || n >= totalPaginas) break;
        }
        if (res.parcial) break;
      }
      if (!res.parcial) {
        // Só apaga o que nenhuma parte desta carga nem a incremental viu (pedidos excluídos na Omie).
        const rem = await q('DELETE FROM omie_pedidos WHERE visto_em < $1::timestamptz RETURNING codigo_pedido', [st.inicio]);
        res.removidos = rem.length;
        await q("DELETE FROM omie_estado WHERE chave = 'completa'");
        await q(`INSERT INTO omie_estado (chave, valor) VALUES ('primeira_carga', $1::jsonb) ON CONFLICT (chave) DO NOTHING`, [JSON.stringify({ fim: new Date().toISOString() })]);
      }
    }
    // Clientes dos pedidos que ainda não estão no banco (ex.: cadastrados antes do período da incremental).
    if (!res.parcial && api.cliente) {
      const faltam = await q(`SELECT DISTINCT p.codigo_cliente FROM omie_pedidos p LEFT JOIN omie_clientes c ON c.codigo = p.codigo_cliente
                              WHERE p.codigo_cliente IS NOT NULL AND c.codigo IS NULL LIMIT ${res.tipo === 'completa' ? 300 : 50}`);
      const achados = [];
      for (const { codigo_cliente } of faltam) {
        if (Date.now() > prazo + 30000) break; // folga: a função tem 300 s e o prazo padrão é 240 s
        // Erro num cliente (não cadastrado, consumo redundante...) não derruba a sincronização: tenta de novo na próxima.
        try { const c = await api.cliente(codigo_cliente); if (c) achados.push(c); } catch (e) { res.avisos = (res.avisos || 0) + 1; }
      }
      res.clientes += await salvarClientes(achados);
    }
    await q('UPDATE sincronizacoes SET fim = now(), ok = true, tipo = $6, negocios = $2, leads = $3, removidos = $4, erro = $5 WHERE id = $1',
      [id, res.pedidos, res.clientes, res.removidos, res.parcial ? `parcial: continua em ${res.proxima.fase}, página ${res.proxima.pagina}` : null, 'omie-' + res.tipo]);
    return { ok: true, ...res };
  } catch (e) {
    await q('UPDATE sincronizacoes SET fim = now(), ok = false, erro = $2 WHERE id = $1', [id, String(e.message || e).slice(0, 1000)]);
    return { ok: false, ...res, erro: String(e.message || e) };
  }
}
