// Sincronização com o CRM. Chamada pela Vercel Cron (completa, 1x por dia) e pelo GitHub Actions (incremental, de hora em hora).
// Protegida por CRON_SECRET: a Vercel Cron envia "Authorization: Bearer <CRON_SECRET>" sozinha.
import { aplicarSchema } from '../lib/schema.js';
import { sincronizar } from '../lib/sync.js';

export async function GET(request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || request.headers.get('authorization') !== `Bearer ${segredo}`) {
    return Response.json({ ok: false, erro: 'não autorizado' }, { status: 401 });
  }
  const tipo = new URL(request.url).searchParams.get('tipo') === 'completa' ? 'completa' : 'incremental';
  await aplicarSchema();
  const r = await sincronizar(tipo);
  return Response.json(r, { status: r.ok ? 200 : 500 });
}
