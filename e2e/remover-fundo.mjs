/**
 * Teste de ponta a ponta da remoção de fundo, num navegador de verdade.
 *
 *     node e2e/remover-fundo.mjs
 *
 * Precisa do servidor no ar e da interface compilada:
 *
 *     npm run build && npm start
 *
 * Precisa também do peso do modelo já baixado. Ele NÃO é baixado aqui: são 490 MB, e uma CI que
 * baixasse isso a cada execução seria abandonada em uma semana. Sem o peso, o teste diz o que
 * fazer e sai com sucesso — a alternativa, falhar, transformaria "não tenho meio giga agora" em
 * "o código está quebrado".
 *
 * Mesma convenção de `fluxo.mjs` e `comprimir.mjs`: o Playwright é procurado onde o
 * `npx playwright` o tiver posto, e a variável `PW` sobrescreve o caminho.
 *
 * ---
 *
 * O que este teste prova, e que nenhum teste de unidade prova:
 *
 * **O recorte que aparece é o recorte que baixa.** Ele passa pelo canvas, pelo pincel, pelo
 * `convertToBlob` e pelo download antes de virar arquivo — e é nessa travessia que o alfa se
 * perderia.
 *
 * **O pincel muda o resultado de verdade.** Uma pincelada de "apagar" no meio do assunto tem de
 * aparecer como pixel transparente no arquivo baixado. É o caminho inteiro do gesto até o byte.
 *
 * **A barra de progresso não anda para trás.** Ele grava toda fração que a tela mostrou e confere
 * a monotonia — a propriedade que o `Progresso` do núcleo garante e que a composição entre envio
 * e processamento poderia quebrar.
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');
const ENDERECO = process.env.APP ?? 'http://localhost:7666';
const SAIDA = join(RAIZ, 'temporario', 'e2e-fundo');

const require = createRequire(import.meta.url);

/**
 * O sharp entra por `require`, e não por `import()` com caminho.
 *
 * No Windows, `import('C:/...')` é recusado: o carregador de ESM só aceita `file://`. O
 * `createRequire` resolve pelo `node_modules` como qualquer dependência, sem essa armadilha.
 */
const sharp = () => require('sharp');

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

/* ==================== a imagem de prova ==================== */

/**
 * Um disco vermelho sobre fundo verde chapado, com borda macia.
 *
 * Sintética de propósito: o teste é de ENCANAMENTO, não de qualidade do modelo. Uma foto traria
 * a qualidade do recorte para dentro do teste, e aí ele passaria a falhar quando o modelo
 * mudasse de versão — que é exatamente o tipo de teste que ninguém confia depois de um tempo.
 * Um disco saturado sobre fundo chapado qualquer modelo de saliência acerta.
 */
async function imagemDeProva() {
  const L = 512;
  const px = Buffer.alloc(L * L * 3);
  for (let y = 0; y < L; y++) {
    for (let x = 0; x < L; x++) {
      const i = (y * L + x) * 3;
      const d = Math.hypot(x - L / 2, y - L / 2);
      const t = Math.min(1, Math.max(0, (150 - d) / 6));
      px[i] = Math.round(t * 220 + (1 - t) * 0);
      px[i + 1] = Math.round(t * 40 + (1 - t) * 170);
      px[i + 2] = Math.round(t * 40 + (1 - t) * 0);
    }
  }
  return sharp()(px, { raw: { width: L, height: L, channels: 3 } }).png().toBuffer();
}

/* ==================== o teste ==================== */

const casos = [];
const caso = (nome, fn) => casos.push({ nome, fn });

caso('a ferramenta abre pela hash e mostra a zona de entrada', async ({ pagina }) => {
  await pagina.goto(`${ENDERECO}/#remover-fundo`, { waitUntil: 'networkidle' });
  await pagina.waitForSelector('.fundo-zona', { timeout: 10_000 });
  const titulo = await pagina.textContent('.fundo-zona h2');
  confere(titulo?.includes('Remover'), `titulo inesperado: ${titulo}`);
});

caso('remove o fundo e a barra nunca anda para tras', async ({ pagina, arquivo }) => {
  await pagina.goto(`${ENDERECO}/#remover-fundo`, { waitUntil: 'networkidle' });

  // Grava toda fração que a barra mostrou, lendo a variável CSS que a alimenta.
  await pagina.evaluate(() => {
    window.__fracoes = [];
    const olho = new MutationObserver(() => {
      const b = document.querySelector('.barra');
      if (!b) return;
      const v = Number(b.style.getPropertyValue('--fracao'));
      if (Number.isFinite(v)) window.__fracoes.push(v);
    });
    olho.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['style'] });
  });

  await pagina.setInputFiles('.fundo-zona input[type=file]', arquivo);
  await pagina.waitForSelector('.fundo-resultado', { timeout: 180_000 });

  const fracoes = await pagina.evaluate(() => window.__fracoes);
  confere(fracoes.length > 2, `a barra mal se mexeu: ${fracoes.length} leituras`);
  for (let i = 1; i < fracoes.length; i++) {
    confere(
      fracoes[i] >= fracoes[i - 1] - 1e-9,
      `a barra andou para tras: ${fracoes[i - 1]} -> ${fracoes[i]}`,
    );
  }
  confere(fracoes.at(-1) === 1, `a barra parou em ${fracoes.at(-1)} em vez de 1`);
});

caso('o recorte tem alfa, e o meio continua opaco', async ({ pagina, arquivo }) => {
  await abreComImagem(pagina, arquivo);
  const amostra = await pagina.evaluate(() => {
    const c = document.querySelector('.fundo-canvas');
    const ctx = c.getContext('2d');
    const meio = ctx.getImageData(Math.round(c.width / 2), Math.round(c.height / 2), 1, 1).data;
    const canto = ctx.getImageData(3, 3, 1, 1).data;
    return { meio: [...meio], canto: [...canto] };
  });
  confere(amostra.meio[3] > 240, `o meio do assunto saiu transparente: alfa ${amostra.meio[3]}`);
  confere(amostra.canto[3] < 16, `o canto do fundo continuou opaco: alfa ${amostra.canto[3]}`);
});

caso('o pincel de apagar chega ao arquivo baixado', async ({ pagina, arquivo }) => {
  await abreComImagem(pagina, arquivo);

  // liga o pincel e passa para APAGAR bem no meio do assunto
  await pagina.click('button:has-text("Pincel")');
  await pagina.click('.fundo-segmentado button:has-text("Apagar")');

  const caixa = await pagina.locator('.fundo-canvas').first().boundingBox();
  await pagina.mouse.move(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2);
  await pagina.mouse.down();
  await pagina.mouse.move(caixa.x + caixa.width / 2 + 12, caixa.y + caixa.height / 2, { steps: 4 });
  await pagina.mouse.up();

  const depois = await pagina.evaluate(() => {
    const c = document.querySelector('.fundo-canvas');
    const ctx = c.getContext('2d');
    return ctx.getImageData(Math.round(c.width / 2), Math.round(c.height / 2), 1, 1).data[3];
  });
  confere(depois < 40, `o pincel nao apagou: alfa ${depois} no ponto pincelado`);

  // e agora o arquivo de verdade
  const baixado = await baixa(pagina, 'Baixar PNG');
  const meta = await sharp()(baixado).metadata();
  confere(meta.hasAlpha === true, 'o PNG baixado saiu sem canal alfa');

  const cru = await sharp()(baixado).ensureAlpha().raw().toBuffer();
  const i = (Math.round(meta.height / 2) * meta.width + Math.round(meta.width / 2)) * 4;
  confere(cru[i + 3] < 40, `no arquivo, o ponto pincelado ficou com alfa ${cru[i + 3]}`);
});

caso('trocar o fundo por cor tira a transparencia do arquivo', async ({ pagina, arquivo }) => {
  await abreComImagem(pagina, arquivo);
  await pagina.click('button[aria-label="Fundo branco"]');
  const baixado = await baixa(pagina, 'Baixar PNG');
  const cru = await sharp()(baixado).ensureAlpha().raw().toBuffer();
  const meta = await sharp()(baixado).metadata();
  const canto = 3 * 4 + 3 * meta.width * 4;
  confere(cru[canto + 3] > 250, `o canto devia estar opaco e veio com alfa ${cru[canto + 3]}`);
  confere(cru[canto] > 240 && cru[canto + 1] > 240, 'o canto devia estar branco');
});

/* ==================== apoio ==================== */

async function abreComImagem(pagina, arquivo) {
  await pagina.goto(`${ENDERECO}/#remover-fundo`, { waitUntil: 'networkidle' });
  await pagina.setInputFiles('.fundo-zona input[type=file]', arquivo);
  await pagina.waitForSelector('.fundo-resultado', { timeout: 180_000 });
}

async function baixa(pagina, rotulo) {
  const espera = pagina.waitForEvent('download');
  await pagina.click(`button:has-text("${rotulo}")`);
  const download = await espera;
  const destino = join(SAIDA, download.suggestedFilename());
  await download.saveAs(destino);
  return readFile(destino);
}

function confere(condicao, mensagem) {
  if (!condicao) throw new Error(mensagem);
}

async function modeloEstaBaixado() {
  try {
    const r = await fetch(`${ENDERECO}/api/fundo/modelos`);
    const e = await r.json();
    return e.modelos.find((m) => m.id === e.padrao)?.baixado === true;
  } catch {
    return false;
  }
}

async function principal() {
  await mkdir(SAIDA, { recursive: true });

  if (!(await modeloEstaBaixado())) {
    console.log(
      '\n  O peso do modelo ainda nao esta nesta maquina, entao nao ha o que testar aqui.\n' +
        '  Abra a ferramenta uma vez e deixe baixar, ou rode:\n' +
        `    curl -N ${ENDERECO}/api/fundo/modelos/birefnet/baixar\n`,
    );
    return;
  }

  const arquivo = join(SAIDA, 'prova.png');
  await writeFile(arquivo, await imagemDeProva());

  const { chromium } = await carregaPlaywright();
  const navegador = await chromium.launch();
  const contexto = await navegador.newContext({ acceptDownloads: true });

  let falhas = 0;
  for (const c of casos) {
    const pagina = await contexto.newPage();
    const inicio = Date.now();
    try {
      await c.fn({ pagina, arquivo });
      console.log(`  ok    ${c.nome}  (${Date.now() - inicio} ms)`);
    } catch (e) {
      falhas++;
      console.log(`  FALHA ${c.nome}`);
      console.log(`        ${e.message}`);
      await pagina.screenshot({ path: join(SAIDA, `falha-${casos.indexOf(c)}.png`) }).catch(() => {});
    } finally {
      await pagina.close();
    }
  }

  await navegador.close();
  console.log(`\n  ${casos.length - falhas} de ${casos.length} passaram.`);
  if (falhas) process.exitCode = 1;
}

await principal();
