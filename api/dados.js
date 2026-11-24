// Dados do painel em JSON, já filtrados pelo perfil de quem está logado (vendedor vê só os negócios dele).
//   ?fonte=crm | omie   (sem o parâmetro: PAINEL_FONTE, ou crm)
import { montarDados } from '../lib/dados.js';
import { montarDadosOmie } from '../lib/dados_omie.js';
import { omieConfigurada } from '../lib/omie.js';
import { protegida, json } from '../lib/resposta.js';
import { publico } from '../lib/usuarios.js';

export const GET = protegida(async (u, request) => {
  const omie = omieConfigurada();
  const pedida = new URL(request.url).searchParams.get('fonte') || process.env.PAINEL_FONTE || 'crm';
  const fonte = pedida === 'omie' && omie ? 'omie' : 'crm';
  const dados = fonte === 'omie' ? await montarDadosOmie(u) : { fonte: 'crm', ...(await montarDados(u)) };
  return json({ ...dados, fontes: { crm: true, omie }, usuario: publico(u) }, 200, { 'Cache-Control': 'private, no-store' });
});
