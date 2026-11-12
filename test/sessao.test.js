import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarCookie, sessaoValida, senhaConfere } from '../lib/sessao.js';

process.env.SESSAO_SEGREDO = 'um-segredo-de-teste-bem-longo';
process.env.PAINEL_SENHA = 'nak2026';

test('cookie de sessão', async () => {
  const c = (await criarCookie()).split(';')[0];
  assert.equal(await sessaoValida(new Request('https://x/', { headers: { cookie: c } })), true);
  assert.equal(await sessaoValida(new Request('https://x/', { headers: { cookie: c.slice(0, -2) + 'xx' } })), false);
  assert.equal(await sessaoValida(new Request('https://x/', { headers: { cookie: 'nak_sessao=1.abc' } })), false);
  assert.equal(await sessaoValida(new Request('https://x/')), false);
});

test('senha', () => {
  assert.equal(senhaConfere('nak2026'), true);
  assert.equal(senhaConfere('nak2027'), false);
  assert.equal(senhaConfere(''), false);
});
