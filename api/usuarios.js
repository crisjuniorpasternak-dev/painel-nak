// Administração de acessos. Administrador cuida de todos; supervisor cria e altera acessos de vendedores.
import { protegida, json } from '../lib/resposta.js';
import { listar, criar, atualizar } from '../lib/usuarios.js';

const GESTORES = ['admin', 'supervisor'];

export const GET = protegida(async (u) => json(await listar(u)), GESTORES);

export const POST = protegida(async (u, request) => json(await criar(u, await request.json()), 201), GESTORES);

export const PATCH = protegida(async (u, request) => {
  const id = new URL(request.url).searchParams.get('id');
  return json(await atualizar(u, id, await request.json()));
}, GESTORES);
