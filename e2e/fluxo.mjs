/**
 * Teste de ponta a ponta: o fluxo inteiro, num navegador de verdade.
 *
 *     node e2e/fluxo.mjs
 *
 * Precisa do servidor no ar e da interface compilada:
 *
 *     npm run build && npm start
 *
 * O Playwright não é dependência do projeto — ele é grande e só serve para isto. O script o
 * procura onde o `npx playwright` o tiver posto, e a variável `PW` sobrescreve o caminho. É a
 * mesma convenção do `vetorizador/fonte/e2e.cjs`, que já existia aqui.
 *
 * ---
 *
 * O que este teste existe para provar, e que nenhum teste de unidade prova:
 *
 * **A barra de progresso não mente.** Ele amostra `aria-valuenow` a cada 25 ms durante conversões
 * de verdade e falha se o valor cair UMA vez, ou se chegar a 100 antes de o botão de baixar
 * existir. Essas duas propriedades são a promessa do projeto inteiro, e as duas só quebram na
 * integração — o `Progresso` do núcleo garante a monotonia dele, mas a fração global atravessa
 * três fronteiras (engine, SSE, redutor) antes de virar pixel, e é em qualquer uma delas que a
 * ordem se perde.
 *
 * Ele também confere que o vetorizador RELATA VÁRIAS VEZES. Uma barra que só recebe 0 e depois 1
 * passaria no teste de monotonia e seria inútil na tela.
 */

import { mkdir, writeFile } from 'node:fs/promises';
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

/* ==================== material de teste ==================== */

/**
 * As imagens de prova são geradas aqui, e não versionadas.
 *
 * Binário no repositório envelhece e ninguém sabe mais de onde veio. Gerar em tempo de teste
 * deixa o material inspecionável — está tudo neste arquivo — e cada caso diz para que serve.
 */
async function materialDeTeste() {
  const sharp = exige('sharp');
  await mkdir(SAIDA, { recursive: true });

  // Arte chapada com curva: o caso do vetorizador. Também é entrada válida para imagem→imagem.
  const arte = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="700">
    <rect width="100%" height="100%" fill="#FFC400"/>
    <circle cx="450" cy="320" r="230" fill="#1A1D24"/>
    <ellipse cx="450" cy="300" rx="105" ry="130" fill="#FFC400"/>
    <path d="M180,560 Q450,400 720,560 L720,650 L180,650 Z" fill="#2F6FFF"/>
  </svg>`;
  const chapada = join(SAIDA, 'logo.png');
  await sharp(Buffer.from(arte)).png().toFile(chapada);

  // Com transparência: prova o aviso de achatamento ao ir para JPEG.
  const comAlfa = join(SAIDA, 'com-alfa.png');
  await sharp({
    create: { width: 400, height: 400, channels: 4, background: { r: 47, g: 111, b: 255, alpha: 0.55 } },
  })
    .png()
    .toFile(comAlfa);

  // Ruidosa: prova que o vetorizador RECUSA foto, que é a resposta certa dele.
  //
  // Os BITS ALTOS do gerador, e não `s % 256`. Os bits baixos de um congruente linear têm
  // período curtíssimo — com `% 256` o resultado sai listrado, não ruidoso, e a "chapeza" que o
  // vetorizador mede fica ALTA. O primeiro esboço deste teste caiu nisso: o vetorizador aceitou
  // a imagem, com razão, e o teste acusou o código de estar errado.
  const px = Buffer.alloc(500 * 500 * 3);
  let s = 7;
  for (let i = 0; i < px.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    px[i] = (s >>> 15) & 0xff;
  }
  const ruido = join(SAIDA, 'ruido.png');
  await sharp(px, { raw: { width: 500, height: 500, channels: 3 } }).png().toFile(ruido);

  return { chapada, comAlfa, ruido };
}

/**
 * Um PDF de três páginas, produzido pelo PRÓPRIO Chrome.
 *
 * A independência é o ponto. Os testes de unidade do escritor de PDF montam o arquivo com o
 * escritor deste projeto e o leem de volta com o pdfium — o que prova que os dois concordam, e
 * não que o arquivo está certo. Um PDF vindo do Chrome fecha esse buraco: se o rasterizador só
 * soubesse ler o que o nosso escritor produz, seria aqui que apareceria.
 *
 * Cada página tem uma cor chapada distinta e um texto conhecido, então a página que sai da
 * conversão é identificável pela cor, e a extração de texto tem o que conferir.
 */
async function pdfDoChrome(navegador) {
  const cores = ['#2F6FFF', '#FFC400', '#E5484D'];
  const pagina = await (await navegador.newContext()).newPage();
  await pagina.setContent(
    `<style>
       @page { size: A4; margin: 0 }
       body { margin: 0; font: 30px system-ui }
       .pg { height: 297mm; display: flex; flex-direction: column;
             align-items: center; justify-content: center; page-break-after: always }
     </style>` +
      cores
        .map(
          (c, i) =>
            `<div class="pg" style="background:${c}">` +
            `<h1>PAGINA ${i + 1} DE 3</h1><p>marcador-${i + 1}-coração</p></div>`,
        )
        .join(''),
  );
  const bytes = await pagina.pdf({ printBackground: true, width: '210mm', height: '297mm' });
  await pagina.close();
  const caminho = join(SAIDA, 'chrome-3-paginas.pdf');
  await writeFile(caminho, bytes);
  return { caminho, cores };
}

/** Baixa a saída de um trabalho concluído, pelo mesmo endereço que o botão usa. */
async function baixaSaida(pagina) {
  const url = await pagina.getAttribute('.cartao .botao-baixar', 'href');
  if (!url) throw new Error('o cartão não tem botão de baixar');
  const absoluta = url.startsWith('http') ? url : new URL(url, ENDERECO).toString();
  const resposta = await fetch(absoluta);
  if (!resposta.ok) throw new Error(`baixar respondeu ${resposta.status}`);
  return Buffer.from(await resposta.arrayBuffer());
}

/**
 * Abre o navegador, com alternativa.
 *
 * O Chromium do Playwright e a versão do pacote andam em par: um `npm install` que suba o
 * Playwright sem baixar o navegador novo deixa o `launch()` quebrado com uma mensagem sobre
 * versão de build. Isso acontece com frequência em máquina que já tinha Playwright de antes.
 *
 * O Chrome instalado no sistema resolve — `channel: 'chrome'` usa ele — e é a alternativa certa
 * aqui: este teste verifica a interface, não o mecanismo de renderização, e o Chrome do usuário
 * é mais parecido com onde a aplicação vai de fato rodar.
 */
async function abreNavegador(chromium) {
  try {
    return await chromium.launch();
  } catch (e) {
    console.log(`  (o Chromium do Playwright não abriu: ${String(e).slice(0, 96)})`);
    for (const canal of ['chrome', 'msedge']) {
      try {
        const n = await chromium.launch({ channel: canal });
        console.log(`  (usando o ${canal} do sistema)`);
        return n;
      } catch {
        /* tenta o próximo */
      }
    }
    throw new Error(
      'Nenhum navegador abriu. Rode `npx playwright install chromium`, ou instale o Chrome.',
    );
  }
}

/* ==================== asserções ==================== */

let falhas = 0;
let passes = 0;

function confere(condicao, oQue) {
  if (condicao) {
    passes++;
    console.log(`  ok    ${oQue}`);
  } else {
    falhas++;
    console.log(`  FALHA ${oQue}`);
  }
}

/**
 * Segue a barra de um cartão até ela terminar, guardando cada valor visto.
 *
 * 25 ms entre amostras: a transição do CSS dura 760 ms, então este intervalo pega várias
 * amostras por transição. Amostrar mais raro poderia pular exatamente a regressão que se quer
 * pegar.
 */
async function acompanhaBarra(pagina, seletorCartao, tempoMaximoMs = 60_000) {
  const valores = [];
  const rotulos = new Set();
  const inicio = Date.now();

  while (Date.now() - inicio < tempoMaximoMs) {
    const leitura = await pagina.evaluate((sel) => {
      const cartao = document.querySelector(sel);
      if (!cartao) return null;
      const barra = cartao.querySelector('[role="progressbar"]');
      return {
        estado: cartao.getAttribute('data-estado'),
        valor: barra ? Number(barra.getAttribute('aria-valuenow')) : null,
        texto: barra ? barra.getAttribute('aria-valuetext') : null,
        temBaixar: !!cartao.querySelector('.botao-baixar'),
      };
    }, seletorCartao);

    if (!leitura) break;
    if (leitura.valor !== null) valores.push({ valor: leitura.valor, temBaixar: leitura.temBaixar });
    if (leitura.texto) rotulos.add(leitura.texto.split(', ').slice(1).join(', '));
    if (['concluido', 'falhou', 'cancelado'].includes(leitura.estado)) {
      return { valores, rotulos: [...rotulos].filter(Boolean), estado: leitura.estado };
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  return { valores, rotulos: [...rotulos].filter(Boolean), estado: 'tempo-esgotado' };
}

function conferePropriedadesDaBarra(nome, { valores, rotulos, estado }) {
  confere(estado === 'concluido', `${nome}: concluiu`);

  let regressoes = 0;
  let cemAntesDaHora = 0;
  let anterior = -1;
  for (const { valor, temBaixar } of valores) {
    if (valor < anterior) regressoes++;
    if (valor >= 100 && !temBaixar) cemAntesDaHora++;
    anterior = valor;
  }

  confere(regressoes === 0, `${nome}: a barra nunca andou para trás (${valores.length} amostras)`);
  // Um 100 com o botão de baixar ainda ausente é exatamente a mentira que este projeto recusa.
  confere(cemAntesDaHora === 0, `${nome}: nunca mostrou 100% antes de o arquivo estar pronto`);
  confere(anterior === 100, `${nome}: terminou em 100%`);

  // O mínimo aqui é 2, e não mais: amostrar de 25 em 25 ms uma conversão que dura 50 ms não
  // consegue pegar mais que dois ou três valores, por mais fina que seja a granularidade do
  // relato. Exigir 3 media a velocidade do amostrador, não a honestidade da barra — e falhava de
  // forma intermitente por isso. A granularidade de verdade é conferida logo abaixo, nas
  // conversões que duram o suficiente para ser observadas.
  const distintos = new Set(valores.map((v) => v.valor));
  confere(distintos.size >= 2, `${nome}: relatou ${distintos.size} valores distintos (>= 2)`);
  confere(rotulos.length >= 2, `${nome}: nomeou ${rotulos.length} etapas — ${rotulos.join(' / ')}`);
  return distintos.size;
}

/** Esvazia a fila e espera os cartões saírem. */
async function limpaFila(pagina) {
  const limpar = await pagina.$('.acoes-fim .botao-fantasma:last-child');
  if (limpar) {
    await limpar.click();
    await pagina.waitForSelector('.cartao', { state: 'detached', timeout: 5000 }).catch(() => {});
  }
}

/** Abre o painel de opções do primeiro cartão, roda o que for pedido, e aplica. */
async function ajustaOpcoes(pagina, mexe) {
  await pagina.click('.cartao:first-of-type .cartao-acoes .botao-icone');
  await pagina.waitForSelector('.painel-opcoes');
  await mexe();
  await pagina.click('.painel-opcoes .botao-principal');
  await pagina.waitForSelector('.painel-opcoes', { state: 'detached' });
}

/**
 * Carrega um pacote do projeto, onde ele estiver.
 *
 * Num monorepo com espaços de trabalho, o npm instala na raiz o que é compartilhado e dentro do
 * pacote o que é exclusivo dele — `sharp` acabou na raiz, `@hyzyla/pdfium` dentro de `servidor`.
 * Este teste roda da raiz e precisa dos dois, então procura nos dois lugares em vez de assumir.
 */
function exige(nome) {
  for (const base of [join(RAIZ, 'node_modules'), join(RAIZ, 'servidor', 'node_modules')]) {
    try {
      return require(join(base, nome));
    } catch {
      /* tenta o próximo */
    }
  }
  throw new Error(`não achei o pacote "${nome}". Rode \`npm install\` na raiz.`);
}

/** A cor dominante de uma imagem, pelo sharp. */
async function sharpDominante(bytes) {
  const { dominant } = await exige('sharp')(bytes).stats();
  return dominant;
}

/** Troca o destino do primeiro cartão pelo formato buscado. */
async function escolheDestino(pagina, termo) {
  await pagina.click('.cartao:first-of-type .selo-destino');
  await pagina.waitForSelector('.painel-seletor');
  await pagina.fill('.seletor-busca input', termo);
  await pagina.click('.destino:not([disabled])');
  await pagina.waitForSelector('.painel-seletor', { state: 'detached' });
}

/* ==================== o teste ==================== */

async function principal() {
  const { chromium } = await carregaPlaywright();
  const material = await materialDeTeste();

  const navegador = await abreNavegador(chromium);
  const contexto = await navegador.newContext({ viewport: { width: 1180, height: 900 } });
  const pagina = await contexto.newPage();

  const errosDoConsole = [];
  pagina.on('console', (m) => m.type() === 'error' && errosDoConsole.push(m.text()));
  pagina.on('pageerror', (e) => errosDoConsole.push(String(e)));

  // Toda requisição que sair para fora de localhost é uma quebra da promessa da aplicação.
  const requisicoesExternas = [];
  pagina.on('request', (r) => {
    const u = new URL(r.url());
    if (!['localhost', '127.0.0.1'].includes(u.hostname) && u.protocol !== 'data:' && u.protocol !== 'blob:') {
      requisicoesExternas.push(r.url());
    }
  });

  console.log(`\n== abrindo ${ENDERECO} ==`);
  await pagina.goto(ENDERECO, { waitUntil: 'networkidle' });
  await pagina.waitForSelector('.zona-alvo', { timeout: 15_000 });
  confere(true, 'a interface carregou e mostrou a zona de soltar');

  const conversoes = await pagina.textContent('.marca-sub');
  confere(/\d+ conversões/.test(conversoes ?? ''), `o cabeçalho anuncia as capacidades — "${conversoes}"`);

  /* ---------- 1. imagem para imagem, no servidor ---------- */
  console.log('\n== PNG para WebP (servidor) ==');
  await pagina.setInputFiles('input[type=file]', material.chapada);
  await pagina.waitForSelector('.cartao', { timeout: 5000 });

  const destinoSugerido = (await pagina.textContent('.selo-destino'))?.trim();
  confere(destinoSugerido?.startsWith('WebP'), `o destino sugerido para PNG é WebP — veio "${destinoSugerido}"`);

  // AVIF, e não o WebP sugerido: WebP codifica em ~50 ms e não dá tempo de observar a barra.
  // AVIF é o codificador mais caro que existe aqui (medido: 57x o TIFF), então é nele que a
  // granularidade do relato do servidor pode ser conferida de fato.
  await escolheDestino(pagina, 'avif');
  await pagina.click('.botao-principal.botao-grande');
  const distintosServidor = conferePropriedadesDaBarra('png→avif', await acompanhaBarra(pagina, '.cartao'));
  confere(
    distintosServidor >= 3,
    `png→avif: a barra passou por ${distintosServidor} valores distintos numa conversão longa (>= 3)`,
  );

  const resultado = await pagina.textContent('.cartao-resultado');
  confere(/menor|maior|mesmo tamanho/.test(resultado ?? ''), `o cartão compara os tamanhos — "${resultado?.trim()}"`);
  await pagina.screenshot({ path: join(SAIDA, '1-servidor-concluido.png') });

  /* ---------- 2. o vetorizador, no navegador ---------- */
  console.log('\n== PNG para SVG (navegador, vetorizador) ==');
  await limpaFila(pagina);

  await pagina.setInputFiles('input[type=file]', material.chapada);
  await escolheDestino(pagina, 'svg');

  const selo = await pagina.textContent('.selo-local');
  confere(selo?.includes('no navegador'), 'o cartão marca que a conversão roda no navegador');

  const antesDoVetor = requisicoesExternas.length;
  await pagina.click('.botao-principal.botao-grande');
  const barraVetor = await acompanhaBarra(pagina, '.cartao');
  conferePropriedadesDaBarra('png→svg', barraVetor);

  // O vetorizador tem etapas finas de verdade; é o caso em que a barra tem mais o que contar.
  confere(
    new Set(barraVetor.valores.map((v) => v.valor)).size >= 5,
    `png→svg: a barra passou por ${new Set(barraVetor.valores.map((v) => v.valor)).size} valores distintos (>= 5)`,
  );
  confere(
    requisicoesExternas.length === antesDoVetor,
    'a vetorização não gerou requisição externa nenhuma',
  );

  const diagBotao = await pagina.$('.cartao .botao-mini');
  if (diagBotao) {
    await diagBotao.click();
    await pagina.waitForSelector('.diagnostico');
    const diag = await pagina.textContent('.diagnostico');
    confere(/nos|K|paleta|chapeza/i.test(diag ?? ''), 'o diagnóstico do vetorizador aparece no cartão');
  }
  await pagina.screenshot({ path: join(SAIDA, '2-vetorizador-concluido.png') });

  /* ---------- 3. o aviso de perda de transparência ---------- */
  console.log('\n== PNG com alfa para JPEG (deve avisar) ==');
  await limpaFila(pagina);

  await pagina.setInputFiles('input[type=file]', material.comAlfa);
  await escolheDestino(pagina, 'jpeg');
  await pagina.click('.botao-principal.botao-grande');
  await acompanhaBarra(pagina, '.cartao');

  const aviso = await pagina.textContent('.nota-atencao').catch(() => null);
  confere(
    aviso?.includes('transparência') === true,
    `avisa que a transparência foi achatada — "${aviso?.trim().slice(0, 70)}…"`,
  );

  /* ---------- 4. o vetorizador recusando foto ---------- */
  console.log('\n== ruído para SVG (deve recusar, e é a resposta certa) ==');
  await limpaFila(pagina);

  await pagina.setInputFiles('input[type=file]', material.ruido);
  await escolheDestino(pagina, 'svg');
  await pagina.click('.botao-principal.botao-grande');
  const recusa = await acompanhaBarra(pagina, '.cartao');

  confere(recusa.estado === 'falhou', `o vetorizador recusou a imagem fotográfica (estado: ${recusa.estado})`);
  const erro = await pagina.textContent('.nota-ruim', { timeout: 3000 }).catch(() => null);
  confere(
    /FOTOGRAFICA|fotográfic/i.test(erro ?? ''),
    `e a recusa explica o motivo — "${erro?.trim().slice(0, 80) ?? '(nada)'}…"`,
  );
  await pagina.screenshot({ path: join(SAIDA, '3-recusa-explicada.png') });

  /* ---------- 5. o seletor mostra o que ainda não dá ---------- */
  console.log('\n== o seletor mostra o indisponível com o motivo ==');
  await pagina.click('.selo-destino');
  await pagina.waitForSelector('.painel-seletor');
  const abas = await pagina.$$eval('.seletor-aba', (bs) =>
    bs.map((b) => b.textContent?.replace(/\d+$/, '').trim()),
  );

  // De um PNG, as famílias alcançáveis são Imagem, Vetor e Documento — e SÓ elas. Uma aba de
  // Áudio aqui seria ruído: não existe PNG para MP3, nem aqui nem no Convertio. O primeiro
  // esboço deste teste esperava dez abas sempre, e estava errado: o seletor mostra a família
  // que tem alguma aresta, disponível ou não, e esconde a que não tem nenhuma.
  confere(
    abas.length === 3 && abas.includes('Imagem') && abas.includes('Vetor') && abas.includes('Documento'),
    `de um PNG, o seletor mostra as 3 famílias alcançáveis — ${abas.join(', ')}`,
  );

  // Dentro delas, o que ainda não existe aparece desabilitado com o marco à vista, que é a
  // diferença de comportamento em relação ao Convertio.
  await pagina.click('.seletor-aba:has-text("Documento")');
  const desabilitados = await pagina.$$eval('.destino[disabled] .destino-selo', (es) =>
    es.map((e) => e.textContent?.trim()),
  );
  confere(
    desabilitados.some((d) => /marco/.test(d ?? '')),
    `os destinos indisponíveis dizem em que marco chegam — ex.: "${desabilitados[0]}"`,
  );

  const explicacao = await pagina.$eval('.destino[disabled] .destino-desc', (e) => e.textContent?.trim());
  confere(
    /ainda não|marco/i.test(explicacao ?? ''),
    `e explicam por escrito — "${explicacao?.slice(0, 60)}…"`,
  );
  await pagina.screenshot({ path: join(SAIDA, '4-seletor-honesto.png') });
  await pagina.keyboard.press('Escape');

  /* ---------- 6. o eixo do PDF ---------- */
  console.log('\n== PDF do Chrome para imagem, texto e volta ==');
  const { caminho: pdfChrome } = await pdfDoChrome(navegador);

  // 6a. uma página escolhida no meio sai como imagem, e é a página certa.
  await limpaFila(pagina);
  await pagina.setInputFiles('input[type=file]', pdfChrome);
  const destinoDePdf = (await pagina.textContent('.selo-destino'))?.trim();
  confere(destinoDePdf?.startsWith('PNG'), `o destino sugerido para PDF é PNG — veio "${destinoDePdf}"`);

  await ajustaOpcoes(pagina, async () => {
    await pagina.fill('input[aria-label="Páginas"]', '2');
  });
  await pagina.click('.botao-principal.botao-grande');
  const barraPagina = await acompanhaBarra(pagina, '.cartao');
  conferePropriedadesDaBarra('pdf→png (1 página)', barraPagina);

  const imagem = await baixaSaida(pagina);
  confere(
    imagem.subarray(1, 4).toString('latin1') === 'PNG',
    'a saída de uma página é um PNG de verdade',
  );
  const corDaPagina2 = await sharpDominante(imagem);
  // A página 2 é amarela (#FFC400). Se a seleção fosse ignorada, viria o azul da página 1.
  confere(
    corDaPagina2.r > 200 && corDaPagina2.g > 140 && corDaPagina2.b < 90,
    `e é a página 2, não a primeira — dominante ${JSON.stringify(corDaPagina2)}`,
  );

  // 6b. todas as páginas: vira .zip, e o nome do download muda junto.
  await limpaFila(pagina);
  await pagina.setInputFiles('input[type=file]', pdfChrome);
  await pagina.click('.botao-principal.botao-grande');
  const barraTodas = await acompanhaBarra(pagina, '.cartao');
  conferePropriedadesDaBarra('pdf→png (3 páginas)', barraTodas);

  const contouPaginas = barraTodas.rotulos.some((r) => /Rasterizando 3 páginas/.test(r));
  confere(contouPaginas, `a barra nomeou a etapa pelas páginas — ${barraTodas.rotulos.join(' / ')}`);

  const nomeDoZip = await pagina.getAttribute('.cartao .botao-baixar', 'download');
  confere(
    nomeDoZip?.endsWith('-paginas.zip') === true,
    `três páginas viram um pacote, e o download se chama "${nomeDoZip}"`,
  );
  const avisoZip = await pagina.textContent('.nota-atencao').catch(() => null);
  confere(
    /não cabem num PNG/.test(avisoZip ?? ''),
    `e o cartão avisa antes — "${avisoZip?.trim().slice(0, 60) ?? '(nada)'}…"`,
  );
  const pacote = await baixaSaida(pagina);
  confere(pacote.subarray(0, 2).toString('latin1') === 'PK', 'e o arquivo baixado é um ZIP');

  // 6c. o texto que o PDF carrega é lido, e sai com o acento certo.
  await limpaFila(pagina);
  await pagina.setInputFiles('input[type=file]', pdfChrome);
  await escolheDestino(pagina, 'txt');
  await pagina.click('.botao-principal.botao-grande');
  conferePropriedadesDaBarra('pdf→txt', await acompanhaBarra(pagina, '.cartao'));

  const texto = (await baixaSaida(pagina)).toString('utf-8');
  confere(/PAGINA 1 DE 3/.test(texto), 'o texto da página 1 foi extraído');
  confere(/PAGINA 3 DE 3/.test(texto), 'o da página 3 também');
  confere(
    texto.includes('marcador-2-coração'),
    'e o acento sobreviveu à ida e volta — "marcador-2-coração"',
  );

  // 6d. a volta: imagem para PDF, conferida por um leitor de PDF de verdade.
  await limpaFila(pagina);
  await pagina.setInputFiles('input[type=file]', material.chapada);
  await escolheDestino(pagina, 'pdf');
  await pagina.click('.botao-principal.botao-grande');
  conferePropriedadesDaBarra('png→pdf', await acompanhaBarra(pagina, '.cartao'));

  const pdfGerado = await baixaSaida(pagina);
  confere(
    pdfGerado.subarray(0, 8).toString('latin1') === '%PDF-1.4',
    'a saída é um PDF, pelo cabeçalho',
  );
  // `import()` e não `exige()`: o `@hyzyla/pdfium` só publica a condição `import` nos exports,
  // então `require` responde MODULE_NOT_FOUND mesmo com o pacote instalado ali. O `exige`
  // continua servindo ao sharp, que publica CommonJS.
  const { PDFiumLibrary } = await import('@hyzyla/pdfium');
  const lib = await PDFiumLibrary.init();
  const doc = await lib.loadDocument(pdfGerado);
  confere(doc.getPageCount() === 1, `e o pdfium o abre, com ${doc.getPageCount()} página`);
  const bitmap = await doc.getPage(0).render({ scale: 1, render: 'bitmap' });

  /*
   * A conferência varre a página inteira e conta a PALETA, em vez de amostrar coordenadas.
   *
   * As duas primeiras versões disto amostravam pontos calculados à mão na arte de prova, e as
   * duas erraram a geometria — a primeira leu a elipse amarela achando que era o círculo, a
   * segunda leu a onda azul. O teste acusava defeito onde não havia, o que é o pior tipo de
   * teste: ele treina quem lê a ignorar a falha.
   *
   * Contar cor é imune a isso e prova mais. A arte tem exatamente três cores, e todas as três
   * têm de aparecer em quantidade significativa: uma página em branco passaria por qualquer
   * asserção de "não é preto", e uma página só com o fundo — que é o que um PDF com a imagem
   * faltando produz — passaria por qualquer asserção de uma cor só.
   */
  const PALETA = [
    { nome: 'amarelo do fundo', r: 0xff, g: 0xc4, b: 0x00 },
    { nome: 'escuro do círculo', r: 0x1a, g: 0x1d, b: 0x24 },
    { nome: 'azul da onda', r: 0x2f, g: 0x6f, b: 0xff },
  ];
  const contagem = PALETA.map(() => 0);
  let amostrados = 0;
  // De quatro em quatro pixels em cada eixo: 675 x 525 dão 22 mil amostras, suficiente e rápido.
  for (let y = 0; y < bitmap.height; y += 4) {
    for (let x = 0; x < bitmap.width; x += 4) {
      const i = (y * bitmap.width + x) * 4;
      amostrados++;
      PALETA.forEach((c, k) => {
        if (
          Math.abs(bitmap.data[i] - c.r) <= 12 &&
          Math.abs(bitmap.data[i + 1] - c.g) <= 12 &&
          Math.abs(bitmap.data[i + 2] - c.b) <= 12
        ) {
          contagem[k]++;
        }
      });
    }
  }

  PALETA.forEach((c, k) => {
    const fracao = contagem[k] / amostrados;
    confere(
      fracao > 0.02,
      `o ${c.nome} atravessou para o PDF — ${(fracao * 100).toFixed(1)}% da página`,
    );
  });
  const reconhecidos = contagem.reduce((a, b) => a + b, 0) / amostrados;
  confere(
    reconhecidos > 0.9,
    `e ${(reconhecidos * 100).toFixed(0)}% da página é uma das três cores da arte, sem sujeira`,
  );
  doc.destroy();
  lib.destroy();
  await pagina.screenshot({ path: join(SAIDA, '5-eixo-do-pdf.png') });

  /* ---------- 7. nada saiu da máquina ---------- */
  console.log('\n== a promessa da aplicação ==');
  confere(
    requisicoesExternas.length === 0,
    requisicoesExternas.length === 0
      ? 'nenhuma requisição saiu para fora de localhost'
      : `VAZOU: ${requisicoesExternas.join(', ')}`,
  );
  confere(
    errosDoConsole.length === 0,
    errosDoConsole.length === 0 ? 'nenhum erro no console' : `erros: ${errosDoConsole.join(' | ')}`,
  );

  await navegador.close();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`${passes} ok, ${falhas} falha(s). Capturas em ${SAIDA}`);
  await writeFile(
    join(SAIDA, 'resumo.txt'),
    `passes=${passes}\nfalhas=${falhas}\nexternas=${requisicoesExternas.length}\nerros=${errosDoConsole.length}\n`,
  );
  process.exit(falhas === 0 ? 0 : 1);
}

await principal();
