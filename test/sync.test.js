import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bancoEmMemoria, crmFalso, apiFalsa } from './simulado.js';
import { aplicarSchema } from '../lib/schema.js';
import { sincronizar } from '../lib/sync.js';
import { montarDados } from '../lib/dados.js';
import { q } from '../lib/db.js';

const linhas = JSON.parse(fs.readFileSync(new URL('./amostra_negocios.json', import.meta.url)));
process.env.DATACRAZY_TOKEN = 'token-teste';
process.env.SINCRONIZAR_DESDE = '2025-01-01T00:00:00Z';
process.env.DATACRAZY_POR_PAGINA = '500';

test('sincronização completa, dados do painel e incremental', async () => {
  await bancoEmMemoria();
  await aplicarSchema();
  await aplicarSchema(); // pode rodar de novo sem erro
  const crm = crmFalso(linhas);
  const chamadas = apiFalsa(crm);
  const r = await sincronizar('completa', { agora: new Date('2026-11-12T20:00:00Z') });
  assert.equal(r.ok, true, r.erro);
  const [{ n }] = await q('SELECT count(*)::int AS n FROM negocios');
  assert.equal(n, crm.negocios.length);

  const d = await montarDados();
  assert.equal(d.negocios.length, linhas.length, 'só funil de vendas, sem Duplicado');
  const fat = (arr) => arr.filter((x) => x.etapa === 'Faturado').reduce((s, x) => s + x.valor, 0);
  assert.ok(Math.abs(fat(d.negocios) - fat(linhas)) < 0.01, 'faturado bate com a origem');
  assert.equal(d.ciclo_crm.length, 6);
  assert.equal(d.ciclo_crm.reduce((s, c) => s + c.negocios, 0), 300, 'ciclo escolhe o pipeline com mais negócios');
  assert.ok(d.itens.length > linhas.length, 'itens de produto vieram');
  assert.ok(d.negocios.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.data)));
  assert.ok(d.atualizado_em);
  assert.equal(d.clientes.length, new Set(linhas.map((l) => l.cliente)).size, 'um registro por cliente');
  assert.ok(d.clientes[0].documento);
  const ex = d.negocios.find((x) => x.negocio === linhas[0].negocio);
  assert.equal(ex.cliente, linhas[0].cliente.toUpperCase());
  assert.equal(ex.vendedor, linhas[0].vendedor);

  // negócio apagado no CRM some na próxima completa; mudança de etapa entra na incremental
  crm.negocios = crm.negocios.filter((b) => b.id !== 'b5');
  crm.negocios[0] = { ...crm.negocios[0], stageId: 'ev3', status: 'won', lastMovedAt: '2026-11-12T19:00:00.000Z' };
  const r2 = await sincronizar('incremental', { agora: new Date('2026-11-12T21:00:00Z') });
  assert.equal(r2.ok, true, r2.erro);
  const [b0] = await q("SELECT etapa_id FROM negocios WHERE id = 'b0'");
  assert.equal(b0.etapa_id, 'ev3');
  const r3 = await sincronizar('completa', { agora: new Date('2026-11-12T22:00:00Z') });
  assert.equal(r3.removidos, 1);
  fs.writeFileSync(new URL('./saida_dados.json', import.meta.url), JSON.stringify(await montarDados()));
  console.log('chamadas à API:', chamadas.length, '| completa:', r.negocios, 'negócios,', r.leads, 'leads');
});

test('erro da API fica registrado e não derruba', async () => {
  await bancoEmMemoria();
  await aplicarSchema();
  process.env.DATACRAZY_TOKEN = 'errado';
  apiFalsa(crmFalso(linhas.slice(0, 10)));
  const r = await sincronizar('incremental');
  assert.equal(r.ok, false);
  assert.match(r.erro, /401/);
  const [s] = await q('SELECT ok, erro FROM sincronizacoes ORDER BY id DESC LIMIT 1');
  assert.equal(s.ok, false);
  process.env.DATACRAZY_TOKEN = 'token-teste';
});
