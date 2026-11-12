import { criarCookie, senhaConfere, cookieSaida } from '../lib/sessao.js';

export async function POST(request) {
  const form = await request.formData().catch(() => null);
  const senha = form ? form.get('senha') : null;
  if (!senhaConfere(senha)) {
    await new Promise((r) => setTimeout(r, 800));
    return new Response(null, { status: 303, headers: { Location: '/login.html?erro=1' } });
  }
  return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': await criarCookie() } });
}

export async function GET() {
  return new Response(null, { status: 303, headers: { Location: '/login.html', 'Set-Cookie': cookieSaida() } });
}
