// Dados do painel em JSON. Protegido pelo middleware (precisa estar logado).
import { montarDados } from '../lib/dados.js';

export async function GET() {
  try {
    const dados = await montarDados();
    return Response.json(dados, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (e) {
    return Response.json({ erro: String(e.message || e) }, { status: 500 });
  }
}
