// Exige login em todo o painel, menos a tela de login, o logo e a rota da sincronização (que usa CRON_SECRET).
import { next } from '@vercel/functions';
import { sessaoValida } from './lib/sessao.js';

export const config = { matcher: ['/((?!login\\.html|logo\\.png|favicon\\.ico|api/login|api/sync).*)'] };

export default async function middleware(request) {
  if (await sessaoValida(request)) return next();
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) return Response.json({ erro: 'faça login' }, { status: 401 });
  return Response.redirect(new URL('/login.html', request.url), 302);
}
