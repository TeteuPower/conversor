/**
 * Mede quanto tempo cada etapa do vetorizador consome.
 *
 *     node ferramentas/medir-vetorizador.mjs
 *
 * A saída vai para `ETAPAS` em `web/src/engines/vetorizador.worker.ts`. Rodar de novo ao mexer no
 * algoritmo — os números absolutos mudam de máquina para máquina, mas as PROPORÇÕES, que é o que
 * a barra usa, se mantêm.
 *
 * ---
 *
 * O que esta mesa descobriu, e que decidiu forma de código:
 *
 * A etapa `classes` consome de 69% a 89% do tempo, e dentro dela quase tudo está num lugar só —
 * a tentativa de K=1, que é um único `ajustaPreenchimento` sobre a amostra inteira. Esse bloco é
 * atômico: não há laço por onde relatar progresso de dentro dele. É por isso que a barra do
 * conversor fica parada nessa fração por cerca de um segundo, com o brilho de atividade cobrindo
 * a espera, e não por descuido.
 *
 * Quem for otimizar o vetorizador: é esse o alvo, e é grande.
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vetorizar } from '../vetorizador/fonte/vetorizar.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const sharp = require(join(RAIZ, 'node_modules', 'sharp'));

/**
 * Arte chapada com curvas: o caso real do vetorizador.
 *
 * Foto não serve de prova aqui — o vetorizador RECUSA foto, e com razão. E arte puramente
 * retangular seria fácil demais: sem curva, o ajuste de Bézier não trabalha. A elipse e a curva
 * quadrática estão aí para dar trabalho ao `loopParaBeziers`.
 */
async function arte(L, A) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${L}" height="${A}">
    <rect width="100%" height="100%" fill="#FFC400"/>
    <circle cx="${L * 0.5}" cy="${A * 0.45}" r="${Math.min(L, A) * 0.34}" fill="#1A1D24"/>
    <ellipse cx="${L * 0.5}" cy="${A * 0.42}" rx="${Math.min(L, A) * 0.16}" ry="${Math.min(L, A) * 0.2}" fill="#FFC400"/>
    <path d="M${L * 0.2},${A * 0.8} Q${L * 0.5},${A * 0.55} ${L * 0.8},${A * 0.8} L${L * 0.8},${A * 0.92} L${L * 0.2},${A * 0.92} Z" fill="#2F6FFF"/>
  </svg>`;
  const { data, info } = await sharp(Buffer.from(svg))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { rgba: new Uint8ClampedArray(data), w: info.width, h: info.height };
}

const TAMANHOS = [
  [400, 400],
  [900, 900],
  [1800, 1800],
];

for (const [L, A] of TAMANHOS) {
  const { rgba, w, h } = await arte(L, A);

  // Agrupa por etapa, e não por relato: `classes` relata várias vezes, e o que interessa é o
  // custo da etapa inteira.
  const porEtapa = new Map();
  let marco = performance.now();
  let ultima = null;
  const aoAndar = (etapa) => {
    const agora = performance.now();
    if (ultima) porEtapa.set(ultima, (porEtapa.get(ultima) ?? 0) + (agora - marco));
    marco = agora;
    ultima = etapa;
  };

  // Três passadas e mediana por etapa: um pico de escalonamento do sistema não deve virar o
  // resultado, e a primeira passada paga o aquecimento do JIT.
  const passadas = [];
  let svg;
  let diag;
  for (let volta = 0; volta < 3; volta++) {
    porEtapa.clear();
    marco = performance.now();
    ultima = null;
    const inicio = performance.now();
    ({ svg, diag } = vetorizar(rgba, w, h, { aoAndar }));
    if (ultima) porEtapa.set(ultima, (porEtapa.get(ultima) ?? 0) + (performance.now() - marco));
    passadas.push({ total: performance.now() - inicio, etapas: new Map(porEtapa) });
  }

  const mediana = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
  const total = mediana(passadas.map((p) => p.total));
  porEtapa.clear();
  for (const etapa of passadas[0].etapas.keys()) {
    porEtapa.set(etapa, mediana(passadas.map((p) => p.etapas.get(etapa) ?? 0)));
  }

  console.log(
    `\n=== ${w} x ${h} — ${total.toFixed(0)} ms, K=${diag.K}, ${diag.nos} nós, ` +
      `${(svg.length / 1000).toFixed(1)} kB ===`,
  );
  const soma = [...porEtapa.values()].reduce((a, b) => a + b, 0);
  for (const [etapa, ms] of porEtapa) {
    const pct = (ms / soma) * 100;
    console.log(
      `  ${etapa.padEnd(10)} ${ms.toFixed(0).padStart(6)} ms  ${pct.toFixed(0).padStart(3)}%  ` +
        '#'.repeat(Math.round(pct / 2)),
    );
  }

  // Os pesos vão como FRAÇÃO DO TOTAL, em centésimos, e não como múltiplo da etapa mais
  // barata. A montagem mede perto de zero, e usá-la como divisor produzia pesos na casa de
  // 38 mil — corretos na proporção e inúteis de ler. Fração do total soma 100 e cai direto em
  // ETAPAS.
  const pesos = [...porEtapa].map(([e, ms]) => `${e}: ${Math.max(1, Math.round((ms / soma) * 100))}`);
  console.log(`  pesos para ETAPAS → ${pesos.join(', ')}`);
}

console.log(
  '\nA `classes` domina em qualquer tamanho, e dentro dela o gargalo é a tentativa de K=1:\n' +
    'um `ajustaPreenchimento` sobre a amostra inteira, atômico. Ver o cabeçalho deste arquivo.\n',
);
