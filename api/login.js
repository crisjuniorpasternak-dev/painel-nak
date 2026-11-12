import { criarCookie, cookieSaida } from '../lib/sessao.js';
import { autenticar } from '../lib/usuarios.js';

export async function POST(request) {
  const form = await request.formData().catch(() => null);
  const email = form ? form.get('email') : null;
  const senha = form ? form.get('senha') : null;
  let u = null;
  try { u = await autenticar(email, senha); } catch (e) {
    console.error('[login]', e);
    return new Response(null, { status: 303, headers: { Location: '/login.html?erro=servidor' } });
  }
  if (!u) {
    await new Promise((r) => setTimeout(r, 600));
    return new Response(null, { status: 303, headers: { Location: '/login.html?erro=1' } });
  }
  return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': await criarCookie(u.id, u.sessao_versao) } });
}

export async function GET() {
  return new Response(null, { status: 303, headers: { Location: '/login.html', 'Set-Cookie': cookieSaida() } });
}
