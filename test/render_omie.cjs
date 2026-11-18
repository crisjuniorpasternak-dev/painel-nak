// Teste visual do painel com a fonte Omie e da Conferência (rode `npm test` antes, para gerar os JSON de saída).
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const pub = path.join(__dirname, '..', 'public');
const ler = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, f)));
const usuario = { id: 1, nome: 'Cristiano Teste', email: 'admin', perfil: 'admin' };
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  res.setHeader('content-type', 'application/json');
  if (u.pathname === '/api/dados') {
    const omie = (u.searchParams.get('fonte') || 'omie') === 'omie';
    const d = omie ? { ...ler('saida_omie.json'), carga_incompleta: false } : { fonte: 'crm', ...ler('saida_dados.json') };
    return res.end(JSON.stringify({ ...d, fontes: { crm: true, omie: true }, usuario }));
  }
  if (u.pathname === '/api/sync' && req.method === 'POST') {
    let b = ''; req.on('data', (c) => (b += c)); return req.on('end', () => {
      const f = JSON.parse(b).fonte; srv.n = (srv.n || 0) + 1;
      setTimeout(() => res.end(JSON.stringify(f === 'crm' ? { ok: true, negocios: 5205 } : { ok: true, pedidos: 100, parcial: srv.n < 4 })), 100);
    });
  }
  if (u.pathname === '/api/conferencia') return res.end(fs.readFileSync(path.join(__dirname, 'saida_conferencia.json')));
  if (u.pathname === '/api/usuarios') return res.end('[]');
  const f = path.join(pub, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', f.endsWith('.html') ? 'text/html; charset=utf-8' : f.endsWith('.js') ? 'text/javascript' : 'image/png');
  res.end(fs.readFileSync(f));
}).listen(5078, async () => {
  const largura = +(process.argv[2] || 1400), out = process.argv[3] || '/tmp';
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: largura, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const aba = async (t) => { if (largura <= 900) { await p.click('#menu-botao'); await p.waitForTimeout(300); } await p.click('#aba-' + t); await p.waitForTimeout(400); };
  await p.goto('http://localhost:5078/'); await p.waitForTimeout(1500);
  console.log('subtítulo:', await p.textContent('#topo-sub'));
  await p.screenshot({ path: out + '/o_geral.png', fullPage: true });
  await aba('produtos'); await p.screenshot({ path: out + '/o_produtos.png', fullPage: true });
  await aba('conferencia'); await p.waitForTimeout(600);
  await p.screenshot({ path: out + '/o_conferencia.png', fullPage: true });
  console.log('kpis:', await p.$$eval('#conferencia .nk-kpi-val', (e) => e.map((x) => x.textContent)));
  console.log('situações:', await p.$$eval('#conf-sit button', (e) => e.map((x) => x.textContent)));
  await p.click('#conf-sit button:nth-child(2)'); await p.waitForTimeout(300);
  console.log('filtrado:', await p.textContent('[data-draw="conf-cont"]'));
  await p.click('#conf-sit button:nth-child(2)');
  await p.fill('#conf-busca', '777777'); await p.waitForTimeout(300);
  console.log('busca 777777:', await p.$$eval('#t-conf tbody tr', (e) => e.map((x) => x.textContent)));
  await p.fill('#conf-busca', '');
  await p.click('#t-conf thead th:nth-child(7)'); await p.waitForTimeout(200);
  await p.click('#sinc-agora'); await p.waitForTimeout(1500);
  console.log('sinc:', await p.textContent('#sinc-msg'), 'chamadas:', srv.n);
  await p.screenshot({ path: out + '/o_sinc.png' });
  await p.click('[data-fonte="crm"]'); await p.waitForTimeout(1200);
  console.log('após trocar para CRM:', await p.textContent('#topo-sub'), new URL(p.url()).search);
  await aba('geral'); await p.screenshot({ path: out + '/o_crm_geral.png' });
  console.log('erros:', JSON.stringify(errs));
  await b.close(); srv.close();
});
