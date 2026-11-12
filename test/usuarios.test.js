import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bancoEmMemoria, crmFalso, apiFalsa } from './simulado.js';
import { aplicarSchema } from '../lib/schema.js';
import { sincronizar } from '../lib/sync.js';
import { montarDados } from '../lib/dados.js';
import { criarCookie } from '../lib/sessao.js';
import { autenticar, usuarioDaRequisicao, criar, atualizar, listar, trocarSenha, ADMIN_EMERGENCIA } from '../lib/usuarios.js';
import { GET as getDados } from '../api/dados.js';
import { POST as postUsuarios } from '../api/usuarios.js';

process.env.SESSAO_SEGREDO = 'um-segredo-de-teste-bem-longo';
process.env.PAINEL_SENHA = 'nak2026';
process.env.DATACRAZY_TOKEN = 'token-teste';
process.env.SINCRONIZAR_DESDE = '2025-01-01T00:00:00Z';

const linhas = JSON.parse(fs.readFileSync(new URL('./amostra_negocios.json', import.meta.url)));
const comCookie = async (u, init = {}) => new Request('https://x/api', { ...init, headers: { ...(init.headers || {}), cookie: (await criarCookie(u.id, u.sessao_versao)).split(';')[0] } });

test('acessos: perfis, login, sessões e filtro do vendedor no servidor', async () => {
  await bancoEmMemoria();
  await aplicarSchema();
  const crm = crmFalso(linhas);
  apiFalsa(crm);
  assert.equal((await sincronizar('completa', { agora: new Date('2026-11-12T20:00:00Z') })).ok, true);

  // administrador de emergência
  assert.equal((await autenticar('ADMIN', 'nak2026')).perfil, 'admin');
  assert.equal(await autenticar('admin', 'errada'), null);

  // admin cria supervisor e vendedor
  const sup = await criar(ADMIN_EMERGENCIA, { nome: 'Sup', email: 'Sup@NAK.test', perfil: 'supervisor', senha: 'senha-sup-1' });
  assert.equal(sup.email, 'sup@nak.test');
  await assert.rejects(criar(ADMIN_EMERGENCIA, { nome: 'X', email: 'x@nak.test', perfil: 'vendedor', senha: 'senha-x-12' }), /Escolha qual vendedor/);
  await assert.rejects(criar(ADMIN_EMERGENCIA, { nome: 'X', email: 'x@nak.test', perfil: 'admin', senha: 'curta' }), /8 caracteres/);
  await assert.rejects(criar(ADMIN_EMERGENCIA, { nome: 'Y', email: 'sup@nak.test', perfil: 'admin', senha: 'senha-y-123' }), /Já existe/);

  const supU = await autenticar('sup@nak.test', 'senha-sup-1');
  assert.ok(supU, 'supervisor entra');
  assert.equal(await autenticar('sup@nak.test', 'senha-errada'), null);

  // supervisor só cuida de vendedores
  const v0 = crm.vendedores[0];
  await assert.rejects(criar(supU, { nome: 'A', email: 'a@nak.test', perfil: 'admin', senha: 'senha-a-123' }), /não pode/);
  const vend = await criar(supU, { nome: 'Vend', email: 'vend@nak.test', perfil: 'vendedor', vendedor_id: v0.id, senha: 'senha-vend-1' });
  await assert.rejects(atualizar(supU, sup.id, { nome: 'Outro' }), /não pode/);
  const l = await listar(supU);
  assert.deepEqual(l.usuarios.map((u) => u.perfil), ['vendedor'], 'supervisor só vê vendedores na lista');
  assert.deepEqual(l.perfis, ['vendedor']);
  assert.ok(l.vendedores.length >= 1);

  // vendedor vê só os dele, inclusive pela rota da API
  const vendU = await autenticar('vend@nak.test', 'senha-vend-1');
  const tudo = await montarDados(supU);
  const meu = await montarDados(vendU);
  const esperado = linhas.filter((x) => x.vendedor === v0.name).length;
  assert.ok(esperado > 0 && esperado < linhas.length);
  assert.equal(meu.negocios.length, esperado);
  assert.ok(meu.negocios.every((n) => n.vendedor === v0.name));
  assert.equal(tudo.negocios.length, linhas.length);
  const codigos = new Set(meu.negocios.map((n) => n.negocio));
  assert.ok(meu.itens.length > 0 && meu.itens.every((i) => codigos.has(i.negocio)), 'itens só dos negócios dele');
  assert.ok(meu.clientes.length < tudo.clientes.length);
  assert.deepEqual(meu.vendedores.map((v) => v.vendedor), [v0.name]);
  assert.ok(meu.ciclo_crm.reduce((s, c) => s + c.negocios, 0) <= tudo.ciclo_crm.reduce((s, c) => s + c.negocios, 0));

  const r = await getDados(await comCookie(vendU));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.negocios.length, esperado);
  assert.equal(j.usuario.perfil, 'vendedor');
  assert.equal(j.usuario.senha_hash, undefined);

  // vendedor não acessa a administração
  const r2 = await postUsuarios(await comCookie(vendU, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
  assert.equal(r2.status, 403);
  // sem login
  assert.equal((await getDados(new Request('https://x/api'))).status, 401);

  // trocar senha derruba a sessão antiga
  const reqAntigo = await comCookie(vendU);
  const novo = await trocarSenha(vendU, 'senha-vend-1', 'senha-nova-99');
  assert.equal(await usuarioDaRequisicao(reqAntigo), null, 'cookie antigo deixa de valer');
  assert.ok(await usuarioDaRequisicao(await comCookie(novo)));
  await assert.rejects(trocarSenha(novo, 'errada', 'qualquer-coisa'), /não confere/);

  // desativar bloqueia login e sessão
  const reqAtivo = await comCookie(novo);
  await atualizar(supU, vend.id, { ativo: false });
  assert.equal(await autenticar('vend@nak.test', 'senha-nova-99'), null);
  assert.equal(await usuarioDaRequisicao(reqAtivo), null);

  // ninguém se desativa sozinho; admin de emergência funciona pelo cookie id 0
  const adm = await criar(ADMIN_EMERGENCIA, { nome: 'Adm', email: 'adm@nak.test', perfil: 'admin', senha: 'senha-adm-1' });
  const admU = await autenticar('adm@nak.test', 'senha-adm-1');
  await assert.rejects(atualizar(admU, adm.id, { ativo: false }), /próprio acesso/);
  assert.equal((await usuarioDaRequisicao(await comCookie(ADMIN_EMERGENCIA))).perfil, 'admin');

  // vendedor sem vendedor ligado não vê nada
  const vazio = await montarDados({ perfil: 'vendedor', vendedor_id: null });
  assert.equal(vazio.negocios.length, 0);
});
