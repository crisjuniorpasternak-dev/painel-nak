// Ajuda das rotas da API: confere o usuário logado e padroniza as respostas em JSON.
import { usuarioDaRequisicao, ErroUso } from './usuarios.js';

export const json = (dados, status = 200, extra = {}) => Response.json(dados, { status, headers: { 'Cache-Control': 'no-store', ...extra } });

/** Roda `fn(usuario, request)` só para quem está logado (e, se pedido, com um dos perfis). */
export function protegida(fn, perfis = null) {
  return async (request) => {
    try {
      const u = await usuarioDaRequisicao(request);
      if (!u) return json({ erro: 'Faça login de novo.' }, 401);
      if (perfis && !perfis.includes(u.perfil)) return json({ erro: 'Seu perfil não tem acesso a isso.' }, 403);
      if (request.method !== 'GET' && !(request.headers.get('content-type') || '').includes('application/json')) {
        return json({ erro: 'Envie os dados em JSON.' }, 415);
      }
      return await fn(u, request);
    } catch (e) {
      if (e instanceof ErroUso) return json({ erro: e.message }, e.status);
      console.error('[api]', e);
      return json({ erro: String(e.message || e) }, 500);
    }
  };
}
