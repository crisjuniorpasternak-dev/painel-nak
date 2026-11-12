// Contas de acesso ao painel: senhas, perfis e quem pode mexer em quem.
import { q } from './db.js';
import { garantirSchema } from './schema.js';
import { lerSessao, senhaConfere, b64, iguais } from './sessao.js';

export const PERFIS = ['admin', 'supervisor', 'vendedor'];
const ITERACOES = 100000;
const enc = new TextEncoder();

// O administrador de emergência entra com o e-mail "admin" e a senha PAINEL_SENHA das variáveis da Vercel.
// Serve para o primeiro acesso e para quando ninguém mais consegue entrar.
export const ADMIN_EMERGENCIA = { id: 0, email: 'admin', nome: 'Administrador', perfil: 'admin', vendedor_id: null, ativo: true, sessao_versao: 0, emergencia: true };

async function pbkdf2(senha, sal, iter) {
  const k = await crypto.subtle.importKey('raw', enc.encode(senha), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iter }, k, 256));
}

export async function gerarHash(senha) {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERACOES}$${b64(sal)}$${await pbkdf2(senha, sal, ITERACOES)}`;
}

export async function conferirHash(senha, hash) {
  const [alg, iter, salB64, esperado] = String(hash || '').split('$');
  if (alg !== 'pbkdf2' || !esperado) return false;
  const sal = Uint8Array.from(atob(salB64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  return iguais(await pbkdf2(String(senha || ''), sal, Number(iter)), esperado);
}

const normEmail = (e) => String(e || '').trim().toLowerCase();

/** Login: devolve o usuário ou null. */
export async function autenticar(email, senha) {
  await garantirSchema();
  const e = normEmail(email);
  if (e === 'admin') return senhaConfere(senha) ? ADMIN_EMERGENCIA : null;
  const [u] = await q('SELECT * FROM usuarios WHERE email = $1 AND ativo', [e]);
  // Calcula um hash mesmo sem usuário, para o tempo de resposta não revelar quais e-mails existem.
  const ok = await conferirHash(senha, u ? u.senha_hash : 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$x');
  if (!u || !ok) return null;
  await q('UPDATE usuarios SET ultimo_acesso = now() WHERE id = $1', [u.id]);
  return u;
}

/** Usuário logado (conferido no banco a cada chamada) ou null. */
export async function usuarioDaRequisicao(request) {
  const s = await lerSessao(request);
  if (!s) return null;
  if (s.uid === 0) return process.env.PAINEL_SENHA ? ADMIN_EMERGENCIA : null;
  await garantirSchema();
  const [u] = await q('SELECT * FROM usuarios WHERE id = $1', [s.uid]);
  if (!u || !u.ativo || Number(u.sessao_versao) !== s.versao) return null;
  return u;
}

/** Dados do usuário que podem ir para a página (sem o hash). */
export function publico(u) {
  if (!u) return null;
  return { id: Number(u.id), email: u.email, nome: u.nome, perfil: u.perfil, vendedor_id: u.vendedor_id || null, vendedor: u.vendedor || null,
    ativo: u.ativo, criado_em: u.criado_em || null, ultimo_acesso: u.ultimo_acesso || null, emergencia: !!u.emergencia };
}

/** Quem pode gerenciar acessos: admin cuida de todos; supervisor só de vendedores. */
export function podeGerenciar(ator, perfilAlvo) {
  if (!ator) return false;
  if (ator.perfil === 'admin') return true;
  return ator.perfil === 'supervisor' && perfilAlvo === 'vendedor';
}

export class ErroUso extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}

export async function listar(ator) {
  await garantirSchema();
  const rows = await q(`SELECT u.*, v.nome AS vendedor FROM usuarios u LEFT JOIN vendedores v ON v.id = u.vendedor_id
                        ORDER BY u.ativo DESC, CASE u.perfil WHEN 'admin' THEN 0 WHEN 'supervisor' THEN 1 ELSE 2 END, u.nome`);
  const usuarios = rows.filter((u) => ator.perfil === 'admin' || u.perfil === 'vendedor').map(publico);
  // Vendedores do CRM com negócios, para ligar ao acesso (mais negócios primeiro).
  const vendedores = await q(`SELECT v.id, v.nome, v.email, count(n.id)::int AS negocios FROM vendedores v LEFT JOIN negocios n ON n.vendedor_id = v.id
                              GROUP BY v.id, v.nome, v.email ORDER BY count(n.id) DESC, v.nome`);
  return { usuarios, vendedores, perfis: ator.perfil === 'admin' ? PERFIS : ['vendedor'] };
}

async function validar(dados, { novo }) {
  const out = {};
  if (novo || dados.email !== undefined) {
    out.email = normEmail(dados.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw new ErroUso('Informe um e-mail válido.');
  }
  if (novo || dados.nome !== undefined) {
    out.nome = String(dados.nome || '').trim();
    if (!out.nome) throw new ErroUso('Informe o nome.');
  }
  if (novo || dados.perfil !== undefined) {
    out.perfil = String(dados.perfil || '');
    if (!PERFIS.includes(out.perfil)) throw new ErroUso('Perfil inválido.');
  }
  if (dados.vendedor_id !== undefined) out.vendedor_id = dados.vendedor_id ? String(dados.vendedor_id) : null;
  if (novo || dados.senha) {
    if (String(dados.senha || '').length < 8) throw new ErroUso('A senha precisa ter pelo menos 8 caracteres.');
    out.senha_hash = await gerarHash(String(dados.senha));
  }
  if (dados.ativo !== undefined) out.ativo = !!dados.ativo;
  return out;
}

async function conferirVendedor(perfil, vendedorId) {
  if (perfil !== 'vendedor') return;
  if (!vendedorId) throw new ErroUso('Escolha qual vendedor do CRM é este acesso. Ele só verá os negócios desse vendedor.');
  const [v] = await q('SELECT id FROM vendedores WHERE id = $1', [vendedorId]);
  if (!v) throw new ErroUso('Vendedor não encontrado no CRM.');
}

export async function criar(ator, dados) {
  await garantirSchema();
  const v = await validar(dados, { novo: true });
  if (!podeGerenciar(ator, v.perfil)) throw new ErroUso('Seu perfil não pode criar esse tipo de acesso.', 403);
  if (v.perfil !== 'vendedor') v.vendedor_id = null;
  await conferirVendedor(v.perfil, v.vendedor_id);
  const [existe] = await q('SELECT id FROM usuarios WHERE email = $1', [v.email]);
  if (existe) throw new ErroUso('Já existe um acesso com esse e-mail.', 409);
  const [u] = await q(`INSERT INTO usuarios (email, nome, senha_hash, perfil, vendedor_id, criado_por) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [v.email, v.nome, v.senha_hash, v.perfil, v.vendedor_id || null, ator.email]);
  return publico(u);
}

export async function atualizar(ator, id, dados) {
  await garantirSchema();
  const [atual] = await q('SELECT * FROM usuarios WHERE id = $1', [Number(id)]);
  if (!atual) throw new ErroUso('Acesso não encontrado.', 404);
  if (!podeGerenciar(ator, atual.perfil)) throw new ErroUso('Seu perfil não pode alterar esse acesso.', 403);
  const v = await validar(dados, { novo: false });
  const perfil = v.perfil ?? atual.perfil;
  if (!podeGerenciar(ator, perfil)) throw new ErroUso('Seu perfil não pode dar esse tipo de acesso.', 403);
  if (Number(atual.id) === Number(ator.id) && (v.ativo === false || (v.perfil && v.perfil !== atual.perfil))) {
    throw new ErroUso('Você não pode desativar nem mudar o perfil do seu próprio acesso.');
  }
  let vendedorId = v.vendedor_id !== undefined ? v.vendedor_id : atual.vendedor_id;
  if (perfil !== 'vendedor') vendedorId = null;
  await conferirVendedor(perfil, vendedorId);
  if (v.email && v.email !== atual.email) {
    const [existe] = await q('SELECT id FROM usuarios WHERE email = $1 AND id <> $2', [v.email, atual.id]);
    if (existe) throw new ErroUso('Já existe um acesso com esse e-mail.', 409);
  }
  // Nova senha, desativação ou troca de perfil/vendedor derrubam as sessões abertas desse usuário.
  const derruba = !!v.senha_hash || v.ativo === false || perfil !== atual.perfil || vendedorId !== atual.vendedor_id;
  const [u] = await q(`UPDATE usuarios SET email = $2, nome = $3, perfil = $4, vendedor_id = $5, ativo = $6,
                         senha_hash = coalesce($7, senha_hash), sessao_versao = sessao_versao + $8 WHERE id = $1 RETURNING *`,
    [atual.id, v.email ?? atual.email, v.nome ?? atual.nome, perfil, vendedorId, v.ativo ?? atual.ativo, v.senha_hash || null, derruba ? 1 : 0]);
  return publico(u);
}

/** Troca da própria senha. Devolve o usuário com a nova versão de sessão. */
export async function trocarSenha(ator, atual, nova) {
  if (ator.emergencia) throw new ErroUso('A senha do administrador de emergência é a PAINEL_SENHA, trocada nas variáveis da Vercel.');
  if (!(await conferirHash(atual, ator.senha_hash))) throw new ErroUso('A senha atual não confere.');
  if (String(nova || '').length < 8) throw new ErroUso('A nova senha precisa ter pelo menos 8 caracteres.');
  const [u] = await q('UPDATE usuarios SET senha_hash = $2, sessao_versao = sessao_versao + 1 WHERE id = $1 RETURNING *', [ator.id, await gerarHash(String(nova))]);
  return u;
}
