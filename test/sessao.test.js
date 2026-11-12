import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarCookie, lerSessao, sessaoValida, senhaConfere } from '../lib/sessao.js';

process.env.SESSAO_SEGREDO = 'um-segredo-de-teste-bem-longo';
process.env.PAINEL_SENHA = 'nak2026';

const req = (cookie) => new Request('https://x/', cookie ? { headers: { cookie } } : {});

test('cookie de sessão leva usuário e versão e não aceita adulteração', async () => {
  const c = (await criarCookie(7, 3)).split(';')[0];
  assert.deepEqual(await lerSessao(req(c)), { uid: 7, versao: 3 });
  assert.equal(await sessaoValida(req(c.slice(0, -2) + 'xx')), false);
  assert.equal(await sessaoValida(req(c.replace('nak_sessao=7.', 'nak_sessao=8.'))), false, 'trocar o usuário invalida a assinatura');
  assert.equal(await sessaoValida(req('nak_sessao=1.abc')), false);
  assert.equal(await sessaoValida(req()), false);
});

test('senha de emergência', () => {
  assert.equal(senhaConfere('nak2026'), true);
  assert.equal(senhaConfere('nak2027'), false);
  assert.equal(senhaConfere(''), false);
});
