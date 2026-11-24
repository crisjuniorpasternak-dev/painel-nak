// Conferência pedido a pedido entre a Omie (ERP) e o CRM. Só para administrador e supervisor.
import { conferencia } from '../lib/dados_omie.js';
import { omieConfigurada } from '../lib/omie.js';
import { protegida, json } from '../lib/resposta.js';

export const GET = protegida(async () => {
  if (!omieConfigurada()) return json({ erro: 'A Omie não está configurada neste painel.' }, 404);
  return json(await conferencia(), 200, { 'Cache-Control': 'private, no-store' });
}, ['admin', 'supervisor']);
