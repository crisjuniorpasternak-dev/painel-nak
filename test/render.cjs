const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const pub = path.join(__dirname, '..', 'public');
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/dados') { res.setHeader('content-type', 'application/json'); return res.end(fs.readFileSync(path.join(__dirname, 'saida_dados.json'))); }
  const f = path.join(pub, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', f.endsWith('.html') ? 'text/html; charset=utf-8' : f.endsWith('.js') ? 'text/javascript' : 'image/png');
  res.end(fs.readFileSync(f));
}).listen(5077, async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: +(process.argv[2] || 1400), height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const out = process.argv[3] || '/tmp';
  await p.goto('http://localhost:5077/'); await p.waitForTimeout(1500);
  await p.screenshot({ path: out + '/v_geral.png', fullPage: true });
  for (const t of ['produtos', 'vendedores', 'carteira']) { await p.click('#aba-' + t); await p.waitForTimeout(400); await p.screenshot({ path: out + '/v_' + t + '.png', fullPage: true }); }
  await p.selectOption('#f-periodo', '30d'); await p.waitForTimeout(300);
  await p.click('#aba-produtos'); await p.waitForTimeout(300); await p.screenshot({ path: out + '/v_produtos30.png', fullPage: true });
  await p.click('#t-produtos tr[data-produto]'); await p.waitForTimeout(400); await p.screenshot({ path: out + '/v_det_produto.png' });
  await p.click('#detalhe tr[data-cliente]'); await p.waitForTimeout(400); await p.screenshot({ path: out + '/v_det_cliente.png' });
  console.log('voltar visível:', await p.isVisible('#det-voltar'));
  await p.click('#det-voltar'); await p.waitForTimeout(200); console.log('tipo após voltar:', await p.textContent('.nk-det-tipo'));
  await p.keyboard.press('Escape'); console.log('fechou:', await p.isHidden('#detalhe'));
  console.log('erros:', JSON.stringify(errs));
  await b.close(); srv.close();
});
