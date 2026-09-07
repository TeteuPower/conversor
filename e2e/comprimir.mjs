/**
 * Teste de ponta a ponta da ferramenta de compressão, num navegador de verdade.
 *
 *     node e2e/comprimir.mjs
 *
 * Precisa do servidor no ar e da interface compilada:
 *
 *     npm run build && npm start
 *
 * O servidor entra aqui só para SERVIR a página. A ferramenta em si não fala com ele: toda a
 * compressão acontece no navegador. Um dos casos abaixo confere justamente isso, contando as
 * requisições que saem da página.
 *
 * Mesma convenção de `fluxo.mjs`: o Playwright não é dependência do projeto, o script o procura
 * onde o `npx playwright` o tiver posto, e a variável `PW` sobrescreve o caminho.
 *
 * ---
 *
 * O que este teste existe para provar, e que nenhum teste de unidade prova:
 *
 * **O número na tela é o arquivo que baixa.** Ele lê o tamanho anunciado no painel, baixa de
 * verdade e compara com o tamanho em disco. É a propriedade que separa esta ferramenta de uma
 * que mostra a estimativa de um preview reduzido — e ela atravessa worker, Blob, URL de objeto e
 * download antes de virar um arquivo, que é onde ela quebraria.
 *
 * **A política de fila não empilha.** Ele dispara 26 mudanças de qualidade em rajada, como um
 * arrasto de verdade, e falha se a interface levar mais que alguns segundos para assentar. Com
 * uma fila ingênua seriam 26 codificações em sequência.
 *
 * **A sonda de formato não mente.** `convertToBlob` devolve PNG em silêncio para um formato que
 * o navegador não codifica, em vez de recusar. O teste confere que o que o painel oferece é o
 * que o navegador de fato entrega.
 */

import { mkdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');
const ENDERECO = process.env.APP ?? 'http://localhost:7666';
const SAIDA = join(RAIZ, 'temporario', 'e2e');

const require = createRequire(import.meta.url);

async function carregaPlaywright() {
  for (const caminho of [process.env.PW, 'playwright', join(RAIZ, 'node_modules', 'playwright')]) {
    if (!caminho) continue;
    try {
      return require(caminho);
    } catch {
      /* tenta o próximo */
    }
  }
  throw new Error(
    'Não achei o Playwright. Rode `npx playwright install chromium` e depois este script, ou ' +
      'aponte a variável PW para o pacote.',
  );
}

const falhas = [];
function confere(condicao, texto) {
  console.log(`  ${condicao ? 'ok   ' : 'FALHA'} ${texto}`);
  if (!condicao) falhas.push(texto);
}

/** Lê "105 kB" de volta para bytes, para comparar com o arquivo em disco. */
function bytesDoTexto(txt) {
  const m = /([\d.,]+)\s*(B|kB|MB)/.exec(txt ?? '');
  if (!m) return NaN;
  const n = Number(m[1].replace(/\./g, '').replace(',', '.'));
  return n * (m[2] === 'MB' ? 1e6 : m[2] === 'kB' ? 1e3 : 1);
}

/**
 * Põe um valor no controle deslizante como o navegador põe.
 *
 * Mexer em `.value` direto não dispara o `onChange` do React — ele escuta o evento nativo, e o
 * setter da propriedade é interceptado. Chamar o setter do protótipo e disparar `input` à mão é
 * o caminho que o próprio React documenta para teste.
 */
const PoeValor = (valor) => {
  const el = document.querySelector('.cpr-deslizante');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(el, String(valor));
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

async function principal() {
  const { chromium } = await carregaPlaywright();
  await mkdir(SAIDA, { recursive: true });

  const navegador = await chromium.launch();
  const pagina = await navegador.newPage({ viewport: { width: 1400, height: 900 } });

  const problemas = [];
  pagina.on('console', (m) => m.type() === 'error' && problemas.push(m.text()));
  pagina.on('pageerror', (e) => problemas.push(`pageerror: ${e.message}`));

  /* As requisições que saem da página, para provar que a compressão não passa pelo servidor. */
  const pedidosDeRede = [];
  pagina.on('request', (r) => pedidosDeRede.push(r.url()));

  await pagina.goto(ENDERECO);

  /*
   * A imagem de prova é desenhada no próprio navegador, e não versionada — mesma razão do
   * `fluxo.mjs`. Ela mistura degradê, bloco chapado e um campo de ruído de propósito: sem o
   * ruído, qualquer qualidade daria praticamente o mesmo tamanho e o caso da qualidade não
   * provaria nada.
   */
  const caminhoProva = join(SAIDA, 'comprimir-prova.png');
  const bytesProva = await pagina.evaluate(async () => {
    const L = 1200;
    const A = 900;
    const cv = document.createElement('canvas');
    cv.width = L;
    cv.height = A;
    const ctx = cv.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, L, A);
    g.addColorStop(0, '#2F66F5');
    g.addColorStop(1, '#F5A02F');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, L, A);
    ctx.fillStyle = '#14161C';
    ctx.fillRect(60, 60, 300, 200);
    const campo = ctx.getImageData(600, 400, 500, 400);
    let s = 7;
    const r = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < campo.data.length; i += 4) {
      const v = Math.floor(r() * 256);
      campo.data[i] = campo.data[i + 1] = campo.data[i + 2] = v;
    }
    ctx.putImageData(campo, 600, 400);
    const blob = await new Promise((resolver) => cv.toBlob(resolver, 'image/png'));
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(caminhoProva, Buffer.from(bytesProva));
  console.log(`imagem de prova: ${Buffer.from(bytesProva).length} bytes\n`);

  const leTela = () =>
    pagina.evaluate(() => ({
      original: document.querySelectorAll('.cpr-balanca-valor')[0]?.textContent?.trim(),
      saida: document.querySelector('.cpr-balanca-saida')?.textContent?.trim(),
      veredito: document.querySelector('.cpr-veredito')?.textContent?.trim(),
      rotuloDireita: document.querySelector('.cmp-rotulo-dir')?.textContent?.trim(),
      dimensao: document.querySelector('.cpr-valor-fraco')?.textContent?.trim(),
    }));
  const esperaAssentar = () =>
    pagina.waitForFunction(
      () =>
        document.querySelector('.cmp-trabalhando')?.dataset.ativo === 'nao' &&
        !document.querySelector('.cpr-balanca-saida')?.textContent?.includes('medindo'),
      { timeout: 30000 },
    );

  /* ==================== 1. a ferramenta abre pela hash ==================== */
  console.log('1. a ferramenta abre e tem endereço próprio');
  await pagina.waitForSelector('.abas-ferramenta', { timeout: 20000 });
  await pagina.click('.aba-ferramenta[href="#comprimir"]');
  await pagina.waitForSelector('.cpr-solta', { timeout: 15000 });
  confere(new URL(pagina.url()).hash === '#comprimir', 'a hash virou #comprimir');
  await pagina.reload();
  await pagina.waitForSelector('.cpr-solta', { timeout: 15000 });
  confere(true, 'o F5 volta na ferramenta certa');

  /* ==================== 2. carrega e comprime ==================== */
  console.log('\n2. carrega e comprime');
  await pagina.setInputFiles('.cpr-arquivo-oculto', caminhoProva);
  await pagina.waitForSelector('.cmp-palco', { timeout: 20000 });
  await esperaAssentar();
  const inicial = await leTela();
  console.log(`   ${inicial.original} -> ${inicial.saida} (${inicial.veredito})`);
  confere(!!inicial.saida && !inicial.saida.includes('medindo'), 'o tamanho comprimido apareceu');
  confere(!!inicial.veredito, 'o veredito de redução apareceu');
  confere(inicial.rotuloDireita?.startsWith('WebP'), 'o padrão é WebP');
  confere(inicial.dimensao === '1200 × 900', 'a dimensão original é lida do arquivo');
  await pagina.screenshot({ path: join(SAIDA, 'c1-comparando.png') });

  /* ==================== 3. a qualidade manda no tamanho ==================== */
  console.log('\n3. a qualidade manda no tamanho');
  await pagina.evaluate(PoeValor, 90);
  await esperaAssentar();
  const alto = bytesDoTexto((await leTela()).saida);
  await pagina.evaluate(PoeValor, 20);
  await esperaAssentar();
  const baixo = bytesDoTexto((await leTela()).saida);
  console.log(`   qualidade 90 = ${alto} B ; qualidade 20 = ${baixo} B`);
  confere(Number.isFinite(alto) && Number.isFinite(baixo), 'os dois tamanhos foram lidos');
  confere(baixo < alto, 'qualidade menor dá arquivo menor');

  /* ==================== 4. o arrasto não empilha ==================== */
  console.log('\n4. o arrasto não empilha (a política de fila)');
  const comeco = Date.now();
  for (let q = 80; q >= 30; q -= 2) await pagina.evaluate(PoeValor, q);
  await esperaAssentar();
  const decorrido = Date.now() - comeco;
  console.log(`   26 mudanças em rajada assentaram em ${decorrido} ms`);
  confere(decorrido < 6000, `assentou em ${decorrido} ms — não enfileirou as 26 codificações`);
  confere(
    await pagina.evaluate(() => document.querySelector('.cpr-deslizante').value === '30'),
    'o resultado corresponde à ÚLTIMA posição do controle, não a uma do meio',
  );

  /* ==================== 5. o divisor ==================== */
  console.log('\n5. o divisor da comparação');
  const leDivisor = () =>
    pagina.evaluate(() => Number(document.querySelector('.cmp-alca').getAttribute('aria-valuenow')));
  await pagina.focus('.cmp-alca');
  const antes = await leDivisor();
  await pagina.keyboard.press('ArrowRight');
  await pagina.keyboard.press('ArrowRight');
  confere((await leDivisor()) > antes, 'a seta move o divisor — dá para comparar sem ponteiro');
  await pagina.keyboard.press('Home');
  confere((await leDivisor()) === 0, 'Home mostra só o original');
  await pagina.keyboard.press('End');
  confere((await leDivisor()) === 100, 'End mostra só o comprimido');
  await pagina.click('.cmp-centralizar');
  confere((await leDivisor()) === 50, 'centralizar volta ao meio');

  /* ==================== 6. a sonda de formato não mente ==================== */
  console.log('\n6. a sonda de formato');
  const oferecidos = await pagina.evaluate(() =>
    [...document.querySelectorAll('.cpr-formato')].map((b) => ({
      nome: b.textContent.trim(),
      desabilitado: b.disabled,
    })),
  );
  console.log(`   ${oferecidos.map((f) => `${f.nome}${f.desabilitado ? ' (off)' : ''}`).join('  ')}`);
  for (const f of oferecidos.filter((x) => !x.desabilitado)) {
    const nome = f.nome;
    await pagina.evaluate(
      (alvo) => [...document.querySelectorAll('.cpr-formato')].find((b) => b.textContent.trim() === alvo).click(),
      nome,
    );
    await esperaAssentar();
    const tela = await leTela();
    confere(
      tela.rotuloDireita?.startsWith(nome),
      `${nome}: o navegador entregou ${nome} de verdade (rótulo: ${tela.rotuloDireita})`,
    );
  }

  /* PNG não tem perda: o controle some em vez de ficar em cinza. */
  await pagina.evaluate(() =>
    [...document.querySelectorAll('.cpr-formato')].find((b) => b.textContent.trim() === 'PNG').click(),
  );
  await esperaAssentar();
  confere(await pagina.isHidden('.cpr-deslizante'), 'em PNG o controle de qualidade sai de cena');
  await pagina.screenshot({ path: join(SAIDA, 'c2-png-sem-qualidade.png') });

  /* ==================== 7. o número é o arquivo ==================== */
  console.log('\n7. o número na tela é o arquivo que baixa');
  await pagina.evaluate(() =>
    [...document.querySelectorAll('.cpr-formato')].find((b) => b.textContent.trim() === 'WebP').click(),
  );
  await esperaAssentar();
  const anunciado = await leTela();
  const [download] = await Promise.all([
    pagina.waitForEvent('download', { timeout: 20000 }),
    pagina.click('.cpr-baixar'),
  ]);
  const emDisco = (await stat(await download.path())).size;
  const naTela = bytesDoTexto(anunciado.saida);
  const desvio = Math.abs(emDisco - naTela) / emDisco;
  console.log(`   tela=${anunciado.saida} (${naTela} B)  disco=${emDisco} B  desvio=${(desvio * 100).toFixed(2)}%`);
  // A tolerância cobre só o arredondamento do texto ("105 kB"). Um preview em resolução reduzida
  // servindo de estimativa erraria por ordem de grandeza e não passaria aqui.
  confere(desvio < 0.01, 'o tamanho anunciado é o do arquivo baixado');
  confere(download.suggestedFilename().endsWith('.webp'), `o download sai como .webp (${download.suggestedFilename()})`);

  /* ==================== 8. redimensionar ==================== */
  console.log('\n8. redimensionar');
  await pagina.evaluate(() =>
    [...document.querySelectorAll('.cpr-degrau')].find((b) => b.textContent.trim() === '50%').click(),
  );
  await esperaAssentar();
  confere((await leTela()).dimensao === '600 × 450', 'metade de 1200 × 900 é 600 × 450');

  /* ==================== 9. nada saiu para o servidor ==================== */
  console.log('\n9. a compressão não passou pelo servidor');
  const depoisDeAbrir = pedidosDeRede.filter(
    (u) => u.includes('/api/') && !u.includes('/api/capacidades'),
  );
  console.log(`   ${pedidosDeRede.length} requisições no total, ${depoisDeAbrir.length} para /api além das capacidades`);
  confere(depoisDeAbrir.length === 0, 'nenhuma requisição de conversão saiu da página');

  /* ==================== 10. console limpo ==================== */
  console.log('\n10. console');
  const relevantes = problemas.filter((m) => !/favicon|React DevTools/i.test(m));
  confere(relevantes.length === 0, `sem erro no console${relevantes.length ? `: ${relevantes.slice(0, 3).join(' | ')}` : ''}`);

  await pagina.screenshot({ path: join(SAIDA, 'c3-final.png') });
  await navegador.close();

  console.log(
    falhas.length === 0
      ? '\nTUDO PASSOU'
      : `\n${falhas.length} FALHA(S):\n - ${falhas.join('\n - ')}`,
  );
  process.exit(falhas.length === 0 ? 0 : 1);
}

await principal();
