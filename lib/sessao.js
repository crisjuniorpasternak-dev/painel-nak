// Sessão por cookie assinado com HMAC (Web Crypto: roda no middleware e nas funções, sem banco).
// Conteúdo do cookie: <id do usuário>.<versão da sessão>.<expira em>.<assinatura>
// A versão muda quando a senha é trocada ou o acesso é desativado, o que derruba sessões antigas.
const NOME = 'nak_sessao';
const DIAS = 30;

const enc = new TextEncoder();
async function chave() {
  const segredo = process.env.SESSAO_SEGREDO;
  if (!segredo || segredo.length < 16) throw new Error('SESSAO_SEGREDO ausente ou curto (mínimo 16 caracteres).');
  return crypto.subtle.importKey('raw', enc.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function iguais(a, b) {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

export async function criarCookie(uid, versao = 0) {
  const exp = Date.now() + DIAS * 864e5;
  const corpo = `${Number(uid)}.${Number(versao)}.${exp}`;
  const sig = b64(await crypto.subtle.sign('HMAC', await chave(), enc.encode(corpo)));
  return `${NOME}=${corpo}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DIAS * 86400}`;
}

export function cookieSaida() {
  return `${NOME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/** Confere a assinatura e a validade. Devolve { uid, versao } ou null. */
export async function lerSessao(request) {
  const c = request.headers.get('cookie') || '';
  const m = c.match(new RegExp(`(?:^|;\\s*)${NOME}=(\\d+)\\.(\\d+)\\.(\\d+)\\.([\\w-]+)`));
  if (!m || Number(m[3]) < Date.now()) return null;
  try {
    const esperado = b64(await crypto.subtle.sign('HMAC', await chave(), enc.encode(`${m[1]}.${m[2]}.${m[3]}`)));
    return iguais(esperado, m[4]) ? { uid: Number(m[1]), versao: Number(m[2]) } : null;
  } catch { return null; }
}

export async function sessaoValida(request) {
  return (await lerSessao(request)) !== null;
}

/** Senha de emergência do administrador principal (PAINEL_SENHA), comparada sem vazar tempo. */
export function senhaConfere(digitada) {
  const certa = process.env.PAINEL_SENHA || '';
  if (!certa) return false;
  const a = enc.encode(String(digitada || '')), b = enc.encode(certa);
  let dif = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) dif |= (a[i] || 0) ^ (b[i] || 0);
  return dif === 0;
}
