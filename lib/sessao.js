// Sessão simples por senha: um cookie assinado com HMAC (Web Crypto, roda no middleware e nas funções).
const NOME = 'nak_sessao';
const DIAS = 30;

const enc = new TextEncoder();
async function chave() {
  const segredo = process.env.SESSAO_SEGREDO;
  if (!segredo || segredo.length < 16) throw new Error('SESSAO_SEGREDO ausente ou curto (mínimo 16 caracteres).');
  return crypto.subtle.importKey('raw', enc.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function criarCookie() {
  const exp = Date.now() + DIAS * 864e5;
  const sig = b64(await crypto.subtle.sign('HMAC', await chave(), enc.encode(String(exp))));
  return `${NOME}=${exp}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DIAS * 86400}`;
}

export function cookieSaida() {
  return `${NOME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function sessaoValida(request) {
  const c = request.headers.get('cookie') || '';
  const m = c.match(new RegExp(`(?:^|;\\s*)${NOME}=(\\d+)\\.([\\w-]+)`));
  if (!m || Number(m[1]) < Date.now()) return false;
  try {
    const esperado = b64(await crypto.subtle.sign('HMAC', await chave(), enc.encode(m[1])));
    if (esperado.length !== m[2].length) return false;
    let dif = 0;
    for (let i = 0; i < esperado.length; i++) dif |= esperado.charCodeAt(i) ^ m[2].charCodeAt(i);
    return dif === 0;
  } catch { return false; }
}

/** Compara senhas sem vazar tempo. */
export function senhaConfere(digitada) {
  const certa = process.env.PAINEL_SENHA || '';
  if (!certa) return false;
  const a = enc.encode(String(digitada || '')), b = enc.encode(certa);
  let dif = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) dif |= (a[i] || 0) ^ (b[i] || 0);
  return dif === 0;
}
