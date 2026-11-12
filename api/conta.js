// Minha conta: troca da própria senha.
import { protegida, json } from '../lib/resposta.js';
import { trocarSenha } from '../lib/usuarios.js';
import { criarCookie } from '../lib/sessao.js';

export const POST = protegida(async (u, request) => {
  const { senha_atual, senha_nova } = await request.json();
  const novo = await trocarSenha(u, senha_atual, senha_nova);
  // As outras sessões caem; esta continua com um cookie novo.
  return json({ ok: true }, 200, { 'Set-Cookie': await criarCookie(novo.id, novo.sessao_versao) });
});
