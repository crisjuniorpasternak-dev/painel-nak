// Cliente da API da Omie (somente leitura: só chamadas Listar/Consultar). Documentação: https://developer.omie.com.br/service-list/
// Toda chamada é um POST com { call, app_key, app_secret, param: [ {...} ] }.
// A Omie bloqueia a mesma chamada repetida em ~60 s ("Consumo redundante ... Aguarde N segundos") e a mesma chamada em
// paralelo ("Já existe uma requisição desse método sendo executada"): nos dois casos esperamos e tentamos de novo.

const BASE = () => (process.env.OMIE_API_URL || 'https://app.omie.com.br/api/v1').replace(/\/$/, '');
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

export const omieConfigurada = () => Boolean(process.env.OMIE_APP_KEY && process.env.OMIE_APP_SECRET);

export class ErroOmie extends Error {}

/** Lista vazia: a Omie responde com erro quando a página não tem registros. */
const semRegistros = (msg) => /n[ãa]o existem registros|nenhum registro|5113/i.test(msg);

export async function chamar(caminho, call, param = {}, { tentativas = 4, esperaMax = 90 } = {}) {
  const app_key = process.env.OMIE_APP_KEY, app_secret = process.env.OMIE_APP_SECRET;
  if (!app_key || !app_secret) throw new ErroOmie('OMIE_APP_KEY e OMIE_APP_SECRET não configurados nas variáveis de ambiente da Vercel.');
  let esperado = 0;
  for (let i = 0; ; i++) {
    const r = await fetch(BASE() + caminho, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ call, app_key, app_secret, param: [param] }),
    });
    const texto = await r.text();
    let corpo = null;
    try { corpo = JSON.parse(texto); } catch { corpo = null; }
    if (r.ok && corpo && !corpo.faultstring) return corpo;
    const msg = String(corpo?.faultstring || corpo?.message || texto || r.status).slice(0, 400);
    if (semRegistros(msg) || semRegistros(String(corpo?.faultcode || ''))) return null;
    let s = 0;
    if (/redundante|REDUNDANT/i.test(msg)) { const m = msg.match(/Aguarde\s*~?\s*(\d+)/i); s = (m ? Number(m[1]) : 60) + 2; }
    else if (/existe uma requisi/i.test(msg)) s = 5 * (i + 1);
    else if (r.status === 429 || r.status >= 502) s = 2 ** (i + 1);
    if (s && i < tentativas && esperado + s <= esperaMax) { esperado += s; await espera(s * 1000); continue; }
    // A mensagem da Omie nunca contém as chaves; mesmo assim, garantimos que elas não vão para o log.
    throw new ErroOmie(`Omie ${r.status} em ${call}: ${msg.split(app_secret).join('***').split(app_key).join('***')}`);
  }
}

/** Uma página de uma listagem: { pagina, total_de_paginas, registros, total_de_registros, <lista>: [...] }. */
export async function pagina(caminho, call, lista, param, n) {
  const r = await chamar(caminho, call, { ...param, pagina: n });
  return { itens: r?.[lista] || [], totalPaginas: Number(r?.total_de_paginas) || (r ? n : 0) };
}

const porPagina = () => Number(process.env.OMIE_POR_PAGINA || 100);
const dataBR = (d) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;

export const omie = {
  vendedores: (n) => pagina('/geral/vendedores/', 'ListarVendedores', 'cadastro', { registros_por_pagina: porPagina(), apenas_importado_api: 'N' }, n),
  clientes: (n, desde) => pagina('/geral/clientes/', 'ListarClientes', 'clientes_cadastro',
    { registros_por_pagina: porPagina(), apenas_importado_api: 'N', ...(desde ? { filtrar_por_data_de: dataBR(desde), filtrar_por_data_ate: dataBR(new Date()) } : {}) }, n),
  cliente: (codigo) => chamar('/geral/clientes/', 'ConsultarCliente', { codigo_cliente_omie: Number(codigo) }, { esperaMax: 10 }),
  pedidos: (n, desde) => pagina('/produtos/pedido/', 'ListarPedidos', 'pedido_venda_produto',
    { registros_por_pagina: porPagina(), apenas_importado_api: 'N', ...(desde ? { filtrar_por_data_de: dataBR(desde), filtrar_por_data_ate: dataBR(new Date()) } : {}) }, n),
};
