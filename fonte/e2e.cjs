const { chromium } = require(process.env.PW + '/playwright');
const S = process.env.S;

(async () => {
  const b = await chromium.launch({
    args: ['--no-sandbox', '--allow-file-access-from-files', '--disable-gpu'],
  });
  const pg = await b.newPage({ viewport: { width: 1340, height: 1200 }, deviceScaleFactor: 1 });
  const erros = [];
  pg.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pg.on('console', (m) => { if (m.type() === 'error') erros.push('console: ' + m.text()); });

  const abre = async () => { await pg.goto('file://' + (process.env.APP || (S + '/vetor/app-fonte.html'))); await pg.waitForTimeout(400); };
  const relatorio = () => pg.$$eval('#tabela tr', (rs) => rs.map((r) =>
    r.querySelector('th').textContent.trim() + ': ' + r.querySelector('td').textContent.replace(/\s+/g,' ').trim()));
  const esperaPronto = async () => {
    await pg.waitForFunction(() => {
      const e = document.querySelector('#estado');
      const t = document.querySelector('#tabela');
      return e && e.textContent === '' && t && t.children.length > 0;
    }, { timeout: 60000 });
  };

  // ---- 1. TRACAR um raster ----
  await abre();
  await pg.setInputFiles('#arquivo', S + '/vetor/logo.png');
  await esperaPronto();
  console.log('=== 1. TRACAR logo.png ===');
  (await relatorio()).forEach((l) => console.log('   ' + l));
  console.log('   botao Baixar habilitado:', await pg.$eval('#btBaixar', (b) => !b.disabled));
  console.log('   svg no palco de saida:', await pg.$eval('#palcoB', (d) => !!d.querySelector('svg')));
  await pg.screenshot({ path: S + '/tela-tracar.png', fullPage: true });

  // vista de diferenca
  await pg.click('.abas button[data-vista="dif"]');
  await pg.waitForTimeout(600);
  console.log('   vista diferenca desenha canvas:', await pg.$eval('#palcoB', (d) => !!d.querySelector('canvas')));

  // mexer num controle re-traca
  await pg.click('.abas button[data-vista="svg"]');
  await pg.$eval('#tol', (i) => { i.value = '1.8'; i.dispatchEvent(new Event('input', {bubbles:true})); });
  await pg.waitForTimeout(1500); await esperaPronto();
  const r2 = await relatorio();
  console.log('   apos tolerancia 1.8 ->', r2.find((l) => l.startsWith('Geometria')));

  // ---- 2. RECUSA de foto ----
  await abre();
  await pg.setInputFiles('#arquivo', S + '/foto-teste.png');
  await pg.waitForTimeout(2500);
  console.log('');
  console.log('=== 2. RECUSA (foto) ===');
  console.log('   painel de recusa visivel:', await pg.$eval('#painelRecusa', (d) => !d.classList.contains('oculto')));
  console.log('   texto:', (await pg.$eval('#txtRecusa', (d) => d.textContent)).replace(/\s+/g,' ').slice(0, 130));
  console.log('   Baixar continua desabilitado:', await pg.$eval('#btBaixar', (b) => b.disabled));
  await pg.click('#btForcar'); await pg.waitForTimeout(4000); await esperaPronto();
  console.log('   apos forcar ->', (await relatorio()).find((l) => l.startsWith('Geometria')));

  // ---- 3. EXTRAIR de um svg, com raster de referencia ----
  await abre();
  await pg.setInputFiles('#arquivo', S + '/vetor/logofull_light.svg');
  await pg.waitForTimeout(900);
  console.log('');
  console.log('=== 3. EXTRAIR de logofull_light.svg ===');
  console.log('   painel de extracao visivel:', await pg.$eval('#painelExtrair', (d) => !d.classList.contains('oculto')));
  const ops = await pg.$$eval('#selElemento option', (os) => os.map((o) => o.textContent.trim()));
  console.log('   elementos oferecidos:'); ops.forEach((o) => console.log('      - ' + o));
  // escolhe o path do mark (o maior path, nao o grupo raiz)
  const iPath = ops.findIndex((o) => o.startsWith('path'));
  await pg.selectOption('#selElemento', String(iPath));
  await pg.waitForTimeout(700);
  console.log('   escolhido:', ops[iPath]);
  console.log('   ' + (await pg.$eval('#infoCaixa', (d) => d.textContent.replace(/\s+/g,' ').trim())));
  (await relatorio()).forEach((l) => console.log('   ' + l));
  // agora o raster de referencia
  await pg.setInputFiles('#arquivo', S + '/vetor/logo.png');
  await pg.waitForTimeout(1800);
  console.log('   -- com logo.png como gabarito --');
  (await relatorio()).forEach((l) => console.log('   ' + l));
  console.log('   avisos:', (await pg.$eval('#avisos', (d) => d.textContent.replace(/\s+/g,' ').trim())).slice(0,200));
  await pg.screenshot({ path: S + '/tela-extrair.png', fullPage: true });

  console.log('');
  console.log(erros.length ? 'ERROS DE PAGINA:\n  ' + erros.join('\n  ') : 'nenhum erro de pagina');
  await b.close();
})().catch((e) => { console.error('FALHA:', e.message); process.exit(1); });
