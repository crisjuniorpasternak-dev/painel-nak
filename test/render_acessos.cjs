// Teste visual das telas de acessos: node test/render_acessos.cjs <largura> <pasta>
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const pub = path.join(__dirname, '..', 'public');
const dados = JSON.parse(fs.readFileSync(path.join(__dirname, 'saida_dados.json')));
let perfil = 'admin';
const usuarios = [
  { id: 1, nome: 'Cristiano Admin', email: 'admin@nak.test', perfil: 'admin', vendedor_id: null, vendedor: null, ativo: true, ultimo_acesso: '2026-11-12T18:00:00Z' },
  { id: 2, nome: 'Supervisora Ana', email: 'ana@nak.test', perfil: 'supervisor', vendedor_id: null, vendedor: null, ativo: true, ultimo_acesso: null },
  { id: 3, nome: 'Vendedor A', email: 'a@nak.test', perfil: 'vendedor', vendedor_id: 'v0', vendedor: 'Vendedor A', ativo: true, ultimo_acesso: '2026-11-11T12:30:00Z' },
  { id: 4, nome: 'Vendedor Antigo', email: 'old@nak.test', perfil: 'vendedor', vendedor_id: 'v1', vendedor: 'Vendedor B', ativo: false, ultimo_acesso: null },
];
const vendedores = [...new Set(dados.negocios.map((n) => n.vendedor))].map((n, i) => ({ id: 'v' + i, nome: n, negocios: dados.negocios.filter((x) => x.vendedor === n).length }));
const eu = () => (perfil === 'vendedor' ? usuarios[2] : usuarios[0]);
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const js = (o, s = 200) => { res.statusCode = s; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
  if (u.pathname === '/api/dados') {
    const d = perfil === 'vendedor' ? { ...dados, negocios: dados.negocios.filter((n) => n.vendedor === 'Vendedor A') } : dados;
    return js({ ...d, usuario: eu() });
  }
  if (u.pathname === '/api/usuarios') {
    if (req.method === 'GET') return js({ usuarios, vendedores, perfis: ['admin', 'supervisor', 'vendedor'] });
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      const o = JSON.parse(b);
      if (req.method === 'POST') { const n = { id: usuarios.length + 1, ativo: true, ultimo_acesso: null, ...o, vendedor: (vendedores.find((v) => v.id === o.vendedor_id) || {}).nome }; delete n.senha; usuarios.push(n); return js(n, 201); }
      const x = usuarios.find((z) => z.id === +u.searchParams.get('id')); Object.assign(x, o); delete x.senha; js(x);
    });
    return;
  }
  if (u.pathname === '/api/conta') return js({ erro: 'A senha atual não confere.' }, 400);
  const f = path.join(pub, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', f.endsWith('.html') ? 'text/html; charset=utf-8' : f.endsWith('.js') ? 'text/javascript' : 'image/png');
  res.end(fs.readFileSync(f));
}).listen(5078, async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: +(process.argv[2] || 1400), height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const out = process.argv[3] || '/tmp';
  const aba = async (t) => { if (p.viewportSize().width <= 900) { await p.click('#menu-botao'); await p.waitForTimeout(300); } await p.click('#aba-' + t); await p.waitForTimeout(350); };
  await p.goto('http://localhost:5078/'); await p.waitForTimeout(1200);
  await aba('acessos'); await p.screenshot({ path: out + '/a_lista.png', fullPage: true });
  await p.click('#acesso-novo'); await p.fill('#ac-nome', 'Vendedor Novo'); await p.fill('#ac-email', 'novo@nak.test');
  await p.selectOption('#ac-vendedor', 'v2'); await p.click('#ac-gerar'); await p.waitForTimeout(200);
  await p.screenshot({ path: out + '/a_form.png', fullPage: true });
  await p.click('#ac-salvar'); await p.waitForTimeout(400);
  console.log('sub após salvar:', await p.textContent('#acessos-sub'), '| linhas:', await p.$$eval('#t-acessos tbody tr', (t) => t.length));
  await aba('conta'); await p.fill('#ct-atual', 'x'); await p.fill('#ct-nova', 'abcdefgh1'); await p.fill('#ct-conf', 'abcdefgh1'); await p.click('#conta-form button'); await p.waitForTimeout(300);
  console.log('msg conta:', await p.textContent('#ct-msg'), '| filtros escondidos:', await p.isHidden('#filtros'));
  await p.screenshot({ path: out + '/a_conta.png', fullPage: true });
  perfil = 'vendedor';
  await p.goto('http://localhost:5078/?v=1#geral'); await p.waitForTimeout(1200);
  console.log('vendedor: aba acessos escondida', await p.isHidden('#aba-acessos'), '| filtro vendedor escondido', await p.isHidden('#filtro-vendedor'));
  await p.screenshot({ path: out + '/a_vendedor.png' });
  console.log('erros:', JSON.stringify(errs));
  await b.close(); srv.close();
});
