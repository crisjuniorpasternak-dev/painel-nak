import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bancoEmMemoria, crmFalso, apiFalsa } from './simulado.js';
import { aplicarSchema } from '../lib/schema.js';
import { sincronizar } from '../lib/sync.js';
import { sincronizarOmie, dataOmie, numeroPedido } from '../lib/sync_omie.js';
import { montarDadosOmie, conferencia } from '../lib/dados_omie.js';
import { q } from '../lib/db.js';

const linhas = JSON.parse(fs.readFileSync(new URL('./amostra_negocios.json', import.meta.url)));
process.env.DATACRAZY_TOKEN = 'token-teste';
process.env.SINCRONIZAR_DESDE = '2025-01-01T00:00:00Z';
process.env.OMIE_APP_KEY = 'chave-teste';
process.env.OMIE_APP_SECRET = 'segredo-teste';
process.env.OMIE_POR_PAGINA = '50';

const BR = (iso) => { const [a, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${a}`; };

/** Omie falsa a partir do CRM falso: os mesmos pedidos, com algumas diferenças de propósito. */
function omieFalsa(crm) {
  const vendas = crm.negocios.filter((b) => /^b\d+$/.test(b.id));
  const etapaOmie = { ev0: '10', ev1: '20', ev2: '50', ev3: '60' };
  const vend = crm.vendedores.map((v, i) => ({ codigo: 5000 + i, nome: v.name, email: v.email, inativo: 'N' }));
  const vcod = new Map(crm.vendedores.map((v, i) => [v.id, 5000 + i]));
  const cli = crm.leads.map((l, i) => ({ codigo_cliente_omie: 7000 + i, razao_social: l.name, cnpj_cpf: l.taxId, cidade: 'JOINVILLE (SC)', estado: 'SC', telefone1_ddd: '47', telefone1_numero: '9999-0000', email: 'c@x.test' }));
  const ccod = new Map(crm.leads.map((l, i) => [l.id, 7000 + i]));
  const pedidos = vendas.map((b, i) => {
    const fat = b.stageId === 'ev3';
    let total = b.total;
    if (i === 3) total = b.total + 100;              // valor diferente
    const etapa = i === 4 ? (fat ? '20' : '60') : etapaOmie[b.stageId];  // etapa diferente
    return {
      cabecalho: { codigo_pedido: 900000 + i, numero_pedido: '0000' + b.externalId, codigo_cliente: ccod.get(b.leadId), etapa, quantidade_itens: b.products.length },
      det: b.products.map((p) => ({ produto: { codigo_produto: Number(p.product.id.slice(1)) + 1, codigo: p.product.id_sku, descricao: p.product.name, quantidade: p.quantity, valor_unitario: p.price, valor_total: p.total } })),
      total_pedido: { valor_total_pedido: total },
      infoCadastro: { faturado: (i === 4 ? !fat : fat) ? 'S' : 'N', cancelado: 'N', dInc: BR(b.createdAt), hInc: '09:00:00', dAlt: BR(b.lastMovedAt), hAlt: '12:00:00', ...(fat || i === 4 ? { dFat: BR(b.lastMovedAt), hFat: '12:00:00' } : {}) },
      informacoes_adicionais: { codVend: vcod.get(b.attendantId) },
    };
  }).filter((_, i) => i !== 5); // pedido 5 só no CRM
  // só na Omie (e um cancelado que nunca foi ao CRM, que não deve aparecer)
  pedidos.push({ cabecalho: { codigo_pedido: 999001, numero_pedido: '777777', codigo_cliente: 7000, etapa: '60' }, det: [], total_pedido: { valor_total_pedido: 500 },
    infoCadastro: { faturado: 'S', cancelado: 'N', dInc: '01/11/2026', hInc: '10:00:00', dAlt: '02/11/2026', dFat: '02/11/2026', hFat: '10:00:00' }, informacoes_adicionais: {} });
  pedidos.push({ cabecalho: { codigo_pedido: 999002, numero_pedido: '777778', codigo_cliente: 99999, etapa: '10' }, det: [], total_pedido: { valor_total_pedido: 80 },
    infoCadastro: { faturado: 'N', cancelado: 'S', dInc: '01/11/2026', dAlt: '02/11/2026' }, informacoes_adicionais: {} });
  return { vend, cli, pedidos };
}

function omieFetch(dados, crmFetch, chamadas) {
  return async (url, opt) => {
    const u = String(url);
    if (!u.startsWith('https://app.omie.com.br/api/v1')) return crmFetch(url, opt);
    const b = JSON.parse(opt.body);
    chamadas.push(b.call + ':' + (b.param[0].pagina || ''));
    if (b.app_key !== 'chave-teste' || b.app_secret !== 'segredo-teste') return Response.json({ faultstring: 'ERROR: Chave de acesso inválida', faultcode: 'SOAP-ENV:Client-100' }, { status: 500 });
    const p = b.param[0], n = p.pagina, tam = p.registros_por_pagina;
    const pag = (lista, chave) => {
      const tot = Math.max(1, Math.ceil(lista.length / tam));
      if (n > tot || !lista.length) return Response.json({ faultstring: `ERROR: Não existem registros para a página [${n}]!`, faultcode: 'SOAP-ENV:Client-5113' }, { status: 500 });
      return Response.json({ pagina: n, total_de_paginas: tot, registros: Math.min(tam, lista.length - (n - 1) * tam), total_de_registros: lista.length, [chave]: lista.slice((n - 1) * tam, n * tam) });
    };
    if (b.call === 'ListarVendedores') return pag(dados.vend, 'cadastro');
    if (b.call === 'ListarClientes') return pag(p.filtrar_por_data_de ? [] : dados.cli.slice(5), 'clientes_cadastro'); // os 5 primeiros vêm pelo ConsultarCliente
    if (b.call === 'ConsultarCliente') { const c = dados.cli.find((x) => x.codigo_cliente_omie === p.codigo_cliente_omie); return c ? Response.json(c) : Response.json({ faultstring: 'ERROR: Cliente não cadastrado', faultcode: 'SOAP-ENV:Client-103' }, { status: 500 }); }
    const ord = (br) => br.split('/').reverse().join('');
    const desde = (l, campo) => (p.filtrar_por_data_de ? l.filter((x) => ord(campo(x) || '00/00/0000') >= ord(p.filtrar_por_data_de)) : l);
    if (b.call === 'ListarPedidos') return pag(desde(dados.pedidos, (x) => x.infoCadastro.dAlt), 'pedido_venda_produto');
    return Response.json({ faultstring: 'método desconhecido' }, { status: 500 });
  };
}

test('conversões da Omie', () => {
  assert.equal(dataOmie('17/11/2026', '10:22:33'), '2026-11-17T10:22:33-03:00');
  assert.equal(dataOmie('', ''), null);
  assert.equal(numeroPedido(' 0014843 '), '14843');
  assert.equal(numeroPedido('0'), '0');
});

test('carga completa da Omie em partes, painel pela Omie e conferência com o CRM', async () => {
  await bancoEmMemoria();
  await aplicarSchema();
  const crm = crmFalso(linhas);
  apiFalsa(crm);
  const crmFetch = globalThis.fetch;
  assert.equal((await sincronizar('completa', { agora: new Date('2026-11-12T20:00:00Z') })).ok, true);

  const dados = omieFalsa(crm), chamadas = [];
  globalThis.fetch = omieFetch(dados, crmFetch, chamadas);

  // tempo zero: cada chamada faz uma página e para; repete até terminar
  let r, partes = 0;
  do {
    r = await sincronizarOmie('completa', { tempoMs: 0, agora: new Date('2026-11-13T08:45:00Z') }); assert.equal(r.ok, true, r.erro); partes++;
    if (partes === 3) assert.equal((await montarDadosOmie()).carga_incompleta, true, 'aviso aparece durante a primeira carga');
  } while (r.parcial && partes < 400);
  assert.ok(partes > 3, 'precisou de várias partes');
  const [{ n }] = await q('SELECT count(*)::int AS n FROM omie_pedidos');
  assert.equal(n, dados.pedidos.length);
  const [{ e }] = await q("SELECT count(*)::int AS e FROM omie_estado WHERE chave = 'completa'");
  assert.equal(e, 0, 'estado limpo ao terminar');
  const [{ semCli }] = await q('SELECT count(*)::int AS "semCli" FROM omie_pedidos p LEFT JOIN omie_clientes c ON c.codigo = p.codigo_cliente WHERE c.codigo IS NULL');
  assert.ok(semCli <= 1, 'clientes que faltavam vieram pelo ConsultarCliente (fica só o inexistente)');
  assert.ok(!JSON.stringify(chamadas).includes('segredo-teste'));

  const d = await montarDadosOmie();
  assert.equal(d.fonte, 'omie');
  assert.ok(d.negocios.length > 100);
  assert.ok(d.negocios.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.data)));
  assert.ok(d.itens.length > d.negocios.length);
  assert.ok(d.negocios.some((x) => x.etapa === 'Faturado' && x.status === 'won'));
  assert.ok(d.negocios.some((x) => x.etapa === 'Cancelado' && x.status === 'lost'));
  const p0 = d.negocios.find((x) => x.pedido === crm.negocios[0].externalId);
  assert.equal(p0.cliente, linhas[0].cliente.toUpperCase());
  assert.equal(p0.vendedor, linhas[0].vendedor);
  assert.ok(d.clientes.find((c) => c.cliente === linhas[0].cliente.toUpperCase()).documento);

  const c = await conferencia();
  const sit = (s) => c.linhas.filter((l) => l.situacao === s);
  const por = (num) => c.linhas.find((l) => l.pedido === num);
  assert.equal(por(crm.negocios[3].externalId).situacao, 'Valor diferente');
  assert.equal(por(crm.negocios[3].externalId).dif, -100);
  assert.equal(por(crm.negocios[4].externalId).situacao, 'Etapa diferente');
  assert.equal(por(crm.negocios[5].externalId).situacao, 'Só no CRM');
  assert.equal(por('777777').situacao, 'Só na Omie');
  assert.equal(por('777778'), undefined, 'cancelado que nunca foi ao CRM fica de fora');
  assert.ok(sit('Confere').length > 100);
  assert.equal(sit('Repetido no CRM').length, 0, 'negócios em Duplicado não contam');

  // vendedor só vê os pedidos dele (ligado pelo e-mail)
  const dv = await montarDadosOmie({ perfil: 'vendedor', vendedor_id: 'v0' });
  assert.ok(dv.negocios.length > 0 && dv.negocios.every((x) => x.vendedor === crm.vendedores[0].name));
  const dn = await montarDadosOmie({ perfil: 'vendedor', vendedor_id: null });
  assert.equal(dn.negocios.length, 0);

  // incremental e pedido apagado na Omie some só na próxima completa
  dados.pedidos = dados.pedidos.filter((p) => p.cabecalho.codigo_pedido !== 900000);
  const ri = await sincronizarOmie('incremental', { agora: new Date('2026-11-13T10:00:00Z') });
  assert.equal(ri.ok, true, ri.erro);
  assert.equal(ri.tipo, 'incremental');
  const rc = await sincronizarOmie('completa', { agora: new Date('2026-11-14T08:45:00Z') });
  assert.equal(rc.ok, true, rc.erro);
  assert.equal(rc.removidos, 1);
  // Cron diária: a carga completa nova vai em partes, mas o painel não volta a avisar "primeira carga" e
  // os pedidos alterados nos últimos dias entram já na primeira parte (incremental antes).
  assert.equal((await montarDadosOmie()).carga_incompleta, false);
  const alvo = dados.pedidos.find((p) => p.cabecalho.codigo_pedido === 900010);
  alvo.total_pedido.valor_total_pedido = 12345.67; alvo.infoCadastro.dAlt = '14/11/2026';
  const rp = await sincronizarOmie('completa', { tempoMs: 0, agora: new Date('2026-11-15T08:45:00Z') });
  assert.equal(rp.ok, true, rp.erro);
  assert.equal(rp.parcial, true);
  const [{ total }] = await q('SELECT total::float8 AS total FROM omie_pedidos WHERE codigo_pedido = 900010');
  assert.equal(total, 12345.67, 'alteração recente entrou pela incremental');
  assert.equal((await montarDadosOmie()).carga_incompleta, false, 'carga completa diária em partes não reacende o aviso');
  let k = 0, rr;
  do { rr = await sincronizarOmie('incremental', { tempoMs: 0, agora: new Date('2026-11-15T09:00:00Z') }); k++; } while (rr.parcial && k < 400);
  assert.equal(rr.ok, true, rr.erro);
  assert.equal(rr.removidos, 0, 'nada some à toa quando a carga vai em partes');
  fs.writeFileSync(new URL('./saida_omie.json', import.meta.url), JSON.stringify(await montarDadosOmie()));
  fs.writeFileSync(new URL('./saida_conferencia.json', import.meta.url), JSON.stringify(await conferencia()));
  globalThis.fetch = crmFetch;
});

test('chave errada da Omie fica registrada e não derruba', async () => {
  await bancoEmMemoria();
  await aplicarSchema();
  const chamadas = [];
  globalThis.fetch = omieFetch({ vend: [], cli: [], pedidos: [] }, null, chamadas);
  process.env.OMIE_APP_SECRET = 'errado';
  const r = await sincronizarOmie('incremental');
  assert.equal(r.ok, false);
  assert.match(r.erro, /Chave de acesso/);
  assert.ok(!r.erro.includes('errado'));
  const [s] = await q("SELECT ok, tipo FROM sincronizacoes ORDER BY id DESC LIMIT 1");
  assert.deepEqual(s, { ok: false, tipo: 'omie-incremental' });
  process.env.OMIE_APP_SECRET = 'segredo-teste';
});
