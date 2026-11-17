// Sincronização. Chamada pela Vercel Cron (completa, 1x por dia) e pelo GitHub Actions (incremental, de hora em hora).
// Protegida por CRON_SECRET: a Vercel Cron envia "Authorization: Bearer <CRON_SECRET>" sozinha.
//   ?fonte=crm  (padrão) lê o CRM DataCrazy
//   ?fonte=omie          lê a Omie (ERP); sem OMIE_APP_KEY/OMIE_APP_SECRET, só responde que está desligada
import { aplicarSchema } from '../lib/schema.js';
import { sincronizar } from '../lib/sync.js';
import { sincronizarOmie } from '../lib/sync_omie.js';
import { omieConfigurada } from '../lib/omie.js';
import { protegida, json } from '../lib/resposta.js';
import { q } from '../lib/db.js';

export async function GET(request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || request.headers.get('authorization') !== `Bearer ${segredo}`) {
    return Response.json({ ok: false, erro: 'não autorizado' }, { status: 401 });
  }
  const p = new URL(request.url).searchParams;
  const tipo = p.get('tipo') === 'completa' ? 'completa' : 'incremental';
  if (p.get('fonte') === 'omie') {
    if (!omieConfigurada()) return Response.json({ ok: true, fonte: 'omie', ignorado: 'Omie não configurada neste painel' });
    await aplicarSchema();
    const r = await sincronizarOmie(tipo);
    return Response.json(r, { status: r.ok ? 200 : 500 });
  }
  await aplicarSchema();
  const r = await sincronizar(tipo);
  return Response.json(r, { status: r.ok ? 200 : 500 });
}

// Botão "Sincronizar agora" do painel (só administrador). { fonte: 'crm' | 'omie' }.
// Escolhe sozinho: completa quando a fonte ainda não tem dados (ou a carga completa da Omie está pela metade), senão incremental.
export const POST = protegida(async (u, request) => {
  const { fonte } = await request.json().catch(() => ({}));
  await aplicarSchema();
  if (fonte === 'omie') {
    if (!omieConfigurada()) return json({ ok: false, erro: 'A Omie não está configurada neste painel.' }, 400);
    const [{ n }] = await q('SELECT count(*)::int AS n FROM omie_pedidos');
    const r = await sincronizarOmie(n ? 'incremental' : 'completa');
    return json(r, r.ok ? 200 : 500);
  }
  const [{ n }] = await q('SELECT count(*)::int AS n FROM negocios');
  const r = await sincronizar(n ? 'incremental' : 'completa');
  return json(r, r.ok ? 200 : 500);
}, ['admin']);
