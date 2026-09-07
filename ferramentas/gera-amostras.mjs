/**
 * Gera as amostras de 1 x 1 pixel usadas pela sonda de decodificação do navegador.
 *
 *     node ferramentas/gera-amostras.mjs
 *
 * A saída vai para `AMOSTRAS` em `web/src/engines/vetorizador.ts`.
 *
 * ---
 *
 * Por que isto é um script e não base64 escrito à mão: porque escrever à mão deu errado. As
 * amostras de PNG, JPEG e AVIF estavam malformadas, e a sonda concluiu que o Chrome não lia
 * nenhum dos três — removendo do seletor três conversões que funcionavam, em silêncio. Quem
 * pegou foi o teste de ponta a ponta.
 *
 * O sharp gera; o `--conferir` confirma num navegador de verdade, que é o único juiz que conta.
 * Rodar os dois, nesta ordem, antes de colar qualquer coisa no código.
 *
 * BMP não sai daqui: este libvips não escreve BMP. O de 1 x 1 e 24 bits é montado à mão e já
 * passou pelo Chrome — se um dia precisar mudar, é o único que exige conferência manual.
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const sharp = require(join(RAIZ, 'node_modules', 'sharp'));

const MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
};

const CODIFICADORES = {
  png: (s) => s.png(),
  // Qualidade baixa nos formatos com perda: a amostra só precisa DECODIFICAR, e quanto menor o
  // base64, menos peso morto no bundle da interface.
  jpg: (s) => s.jpeg({ quality: 20 }),
  webp: (s) => s.webp({ quality: 20 }),
  gif: (s) => s.gif(),
  avif: (s) => s.avif({ quality: 20, effort: 0 }),
};

/** 1 x 1 com canal alfa: o alfa é o que o vetorizador usa, então a amostra tem de carregá-lo. */
const BASE = () =>
  sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } });

const BMP_A_MAO =
  'data:image/bmp;base64,Qk1GAAAAAAAAADYAAAAoAAAAAQAAAAEAAAABABgAAAAAABAAAAATCwAAEwsAAAAAAAAAAAAAAAAAAAAAAA==';

async function gera() {
  const amostras = {};
  for (const [ext, codifica] of Object.entries(CODIFICADORES)) {
    try {
      const b = await codifica(BASE()).toBuffer();
      amostras[ext] = `data:${MIME[ext]};base64,${b.toString('base64')}`;
      console.log(`  ${ext.padEnd(5)} ${String(b.length).padStart(4)} B`);
    } catch (e) {
      console.log(`  ${ext.padEnd(5)} este libvips não escreve — ${e.message.split('\n')[0]}`);
    }
  }
  amostras.bmp = BMP_A_MAO;
  return amostras;
}

/**
 * Confere cada amostra com `createImageBitmap` num Chrome de verdade.
 *
 * Precisa da interface no ar (`npm start`), porque `createImageBitmap` só existe no navegador e a
 * página precisa de uma origem para o `fetch` da data URI funcionar.
 */
async function confere(amostras) {
  const { chromium } = require(join(RAIZ, 'node_modules', 'playwright'));
  let navegador;
  try {
    navegador = await chromium.launch();
  } catch {
    navegador = await chromium.launch({ channel: 'chrome' });
  }
  const pagina = await (await navegador.newContext()).newPage();
  await pagina.goto(process.env.APP ?? 'http://localhost:7666');

  const veredito = await pagina.evaluate(async (a) => {
    const saida = {};
    for (const [ext, uri] of Object.entries(a)) {
      try {
        const bitmap = await createImageBitmap(await (await fetch(uri)).blob());
        saida[ext] = `ok ${bitmap.width}x${bitmap.height}`;
        bitmap.close();
      } catch (e) {
        saida[ext] = `FALHOU — ${String(e).slice(0, 60)}`;
      }
    }
    return saida;
  }, amostras);

  await navegador.close();
  return veredito;
}

const amostras = await gera();

if (process.argv.includes('--conferir')) {
  console.log('\nconferindo num navegador de verdade:');
  const veredito = await confere(amostras);
  let falhou = false;
  for (const [ext, r] of Object.entries(veredito)) {
    console.log(`  ${ext.padEnd(5)} ${r}`);
    if (r.startsWith('FALHOU')) falhou = true;
  }
  if (falhou) {
    console.error('\nAlguma amostra não decodifica. NÃO cole no código.');
    process.exit(1);
  }
  console.log('\nTodas decodificam.');
}

console.log('\n--- cole em AMOSTRAS, em web/src/engines/vetorizador.ts ---\n');
for (const [ext, uri] of Object.entries(amostras)) {
  console.log(`  ${ext}:\n    '${uri}',`);
}
