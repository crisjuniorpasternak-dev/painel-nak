// Dados do painel em JSON, já filtrados pelo perfil de quem está logado (vendedor vê só os negócios dele).
import { montarDados } from '../lib/dados.js';
import { protegida, json } from '../lib/resposta.js';
import { publico } from '../lib/usuarios.js';

export const GET = protegida(async (u) => {
  const dados = await montarDados(u);
  return json({ ...dados, usuario: publico(u) }, 200, { 'Cache-Control': 'private, no-store' });
});
