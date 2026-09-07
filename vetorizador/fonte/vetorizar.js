/* vetorizar.js — orquestracao: RGBA -> SVG, mais o diagnostico honesto do que foi possivel.
 *
 * UMA via de codigo, com o numero de classes de cor (K) decidido pelo RESIDUO do modelo de
 * pintura — nao por opcao do usuario nem por modo fixo.
 *
 * Por que assim: a primeira versao tinha um modo 'alfa' que tomava a silhueta do canal alfa como
 * UMA regiao com UM preenchimento. Isso e otimo para marca de cor unica (o icone do Hive fechou
 * com desvio de 1/255), e destroi qualquer arte com transparencia E estrutura interna: numa
 * colmeia preta sobre circulo amarelo ele ajustou a cor MEDIA, com desvio de 185/255. Medido em
 * 7 imagens reais, 5 caiam nessa armadilha.
 *
 * O criterio de parada e o proprio residuo: comeca em K=1 e cresce enquanto a pior classe nao
 * for explicada pelo seu modelo. Um gradiente continua UMA classe (em K=1 o modelo linear ja o
 * explica, residuo ~1), e duas cores chapadas exigem K=2 (em K=1 o residuo estoura). Assim o
 * tracador nunca fatia um degrade em faixas nem funde duas cores numa media.
 *
 * K=1 reproduz exatamente o antigo modo 'alfa': com uma unica entrada na paleta o campo de
 * cobertura degenera para o proprio canal alfa.
 *
 * 'foto' segue sendo recusa: SVG e o formato errado, e dizer isso vale mais que entregar 8 MB.
 */
import { comMoldura, contornos, area } from './contorno.js';
import { loopParaBeziers, beziersParaPath } from './curvas.js';
import { ajustaPreenchimento } from './preenchimento.js';

/* ---------- analise ---------- */

export function analisa(rgba, w, h) {
  const n = w * h;
  let parciais = 0, vazios = 0, opacos = 0;
  const vistas = new Set();
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3];
    if (a === 0) vazios++; else if (a === 255) opacos++; else parciais++;
    if (a > 8) {   // paleta grosseira (5 bits/canal) só para CONTAR variedade
      vistas.add(((rgba[i * 4] >> 3) << 10) | ((rgba[i * 4 + 1] >> 3) << 5) | (rgba[i * 4 + 2] >> 3));
    }
  }
  // "chapeza": fracao de pixels cuja vizinhanca-4 tem praticamente a mesma cor.
  // Arte chapada e gradiente suave pontuam alto; foto pontua baixo (textura em toda parte).
  let lisos = 0, contados = 0;
  const dif = (i, j) => Math.max(Math.abs(rgba[i*4]-rgba[j*4]), Math.abs(rgba[i*4+1]-rgba[j*4+1]),
                                 Math.abs(rgba[i*4+2]-rgba[j*4+2]), Math.abs(rgba[i*4+3]-rgba[j*4+3]));
  const passo = Math.max(1, Math.floor(Math.sqrt(n / 40000)));
  for (let y = 1; y < h - 1; y += passo) for (let x = 1; x < w - 1; x += passo) {
    const i = y * w + x; contados++;
    if (dif(i, i-1) <= 2 && dif(i, i+1) <= 2 && dif(i, i-w) <= 2 && dif(i, i+w) <= 2) lisos++;
  }
  const chapeza = contados ? lisos / contados : 0;
  const cores = vistas.size;
  const temAlfa = vazios / n > 0.02 || parciais / n > 0.005;

  // Foto: a CHAPEZA e o discriminante, nao a contagem de cores. Medido: arte chapada 0.91,
  // degrade liso 1.00, logo com antisserrilhado 0.94-0.99, ruido fotografico 0.00. A contagem de
  // cor engana — quantizada em 5 bits/canal, uma foto de ruido suave se concentra em poucas
  // centenas de baldes, e a regra antiga (`cores > 3000`) deixou passar uma foto sintetica que
  // saiu com 31 mil nos e 1,4 MB. A contagem fica so como guarda contra imagem quase vazia.
  const foto = chapeza < 0.30 && cores > 150;
  return {
    w, h, cores, chapeza, temAlfa,
    fracVazio: vazios / n, fracParcial: parciais / n, fracOpaco: opacos / n,
    modo: foto ? 'foto' : temAlfa ? 'alfa' : 'chapada',
  };
}

/* ---------- paleta (median cut) ---------- */

/** PRNG deterministico: a mesma imagem tem de dar o mesmo SVG entre execucoes. */
function rng(semente) {
  let a = semente >>> 0;
  return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
}

function amostraCores(rgba, w, h, alvo = 60000) {
  const px = [];
  const passo = Math.max(1, Math.floor(Math.sqrt((w * h) / alvo)));
  for (let y = 0; y < h; y += passo) for (let x = 0; x < w; x += passo) {
    const i = (y * w + x) * 4;
    if (rgba[i + 3] > 128) px.push([rgba[i], rgba[i+1], rgba[i+2]]);
  }
  return px;
}

/** Cores EXATAS com populacao relevante. Em arte chapada (com ou sem antisserrilhado) os
 *  platos de cor sao poucos e populosos, e os pixels de mistura sao individualmente raros —
 *  entao a moda da histograma devolve a paleta VERDADEIRA, sem agrupamento nenhum. Isso evita
 *  de vez o otimo local do k-means, que num teste de 12 cores chapadas perdeu 4 delas. */
export function coresDominantes(rgba, w, h, maxCores, minFrac = 0.004, cobMin = 0.55) {
  const conta = new Map();
  let total = 0;
  const passo = Math.max(1, Math.floor(Math.sqrt((w * h) / 120000)));
  for (let y = 0; y < h; y += passo) for (let x = 0; x < w; x += passo) {
    const i = (y * w + x) * 4;
    if (rgba[i + 3] < 250) continue;
    const k = (rgba[i] << 16) | (rgba[i+1] << 8) | rgba[i+2];
    conta.set(k, (conta.get(k) || 0) + 1); total++;
  }
  if (!total) return null;
  const ord = [...conta.entries()].sort((a, b) => b[1] - a[1]);
  const dom = ord.filter(([, n]) => n / total >= minFrac).slice(0, maxCores);
  if (!dom.length) return null;
  const cobertura = dom.reduce((s, [, n]) => s + n, 0) / total;
  if (cobertura < cobMin) return null;      // nao ha plato: gradiente ou foto, agrupar e melhor
  return dom.map(([k]) => [(k >> 16) & 255, (k >> 8) & 255, k & 255]);
}

/** k-means com inicializacao k-means++ e reinicios. O median cut puro cortava pela MEDIANA DA
 *  POPULACAO (que ignora agrupamento) e o Lloyd, sendo local, herdava o erro: num xadrez de tres
 *  cores duas entradas saiam como mistura. O ++ escolhe cada centro com probabilidade
 *  proporcional a distancia quadratica ao centro mais proximo, o que espalha a semente pelos
 *  agrupamentos de fato; tres reinicios cobrem o azar restante. */
export function paletaKMeans(rgba, w, h, K, semente = 12345) {
  const px = amostraCores(rgba, w, h);
  if (!px.length) return [[0, 0, 0]];
  if (K <= 1) {
    const s = [0, 0, 0];
    for (const c of px) { s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; }
    return [s.map((v) => Math.round(v / px.length))];
  }
  const d2 = (a, b) => (a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2;
  let melhorP = null, melhorSSE = Infinity;

  for (let tent = 0; tent < 3; tent++) {
    const rnd = rng(semente + tent * 7919);
    const cent = [px[Math.floor(rnd() * px.length)].slice()];
    const dist = px.map((c) => d2(c, cent[0]));
    while (cent.length < K) {
      let soma = 0; for (const d of dist) soma += d;
      if (soma <= 0) break;
      let alvo = rnd() * soma, k = 0;
      while (k < dist.length - 1 && (alvo -= dist[k]) > 0) k++;
      cent.push(px[k].slice());
      for (let i = 0; i < px.length; i++) { const d = d2(px[i], cent[cent.length-1]); if (d < dist[i]) dist[i] = d; }
    }
    let P = cent;
    for (let it = 0; it < 24; it++) {
      const soma = P.map(() => [0, 0, 0, 0]);
      for (const c of px) {
        let b = 0, dm = Infinity;
        for (let k = 0; k < P.length; k++) { const d = d2(c, P[k]); if (d < dm) { dm = d; b = k; } }
        const t = soma[b]; t[0] += c[0]; t[1] += c[1]; t[2] += c[2]; t[3]++;
      }
      let moveu = 0;
      P = P.map((q, k) => {
        const t = soma[k]; if (!t[3]) return q;
        const n = [t[0]/t[3], t[1]/t[3], t[2]/t[3]];
        moveu = Math.max(moveu, Math.abs(n[0]-q[0]), Math.abs(n[1]-q[1]), Math.abs(n[2]-q[2]));
        return n;
      });
      if (moveu < 0.05) break;
    }
    let sse = 0;
    for (const c of px) { let dm = Infinity; for (const q of P) { const d = d2(c, q); if (d < dm) dm = d; } sse += dm; }
    if (sse < melhorSSE) { melhorSSE = sse; melhorP = P; }
  }
  return melhorP.map((c) => c.map((v) => Math.round(v)));
}

/* ---------- campos de cobertura ---------- */

const campoAlfa = (rgba, n) => {
  const f = new Float32Array(n);
  for (let i = 0; i < n; i++) f[i] = rgba[i * 4 + 3] / 255;
  return f;
};

/** Cobertura SUAVE da classe k. Num pixel de borda entre as cores A e B, a mistura ja diz
 *  onde esta a aresta: a fracao de A e a projecao da cor observada no segmento A->B. Isso da
 *  contorno subpixel tambem em arte opaca, e faz classes vizinhas casarem no MESMO 0.5 —
 *  sem costura branca entre elas, que e o artefato classico do tracado por camada. */
function campoClasse(rgba, n, paleta, k) {
  const f = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = rgba[i*4], g = rgba[i*4+1], b = rgba[i*4+2], a = rgba[i*4+3] / 255;
    if (a === 0) continue;
    let i1 = -1, d1 = Infinity, i2 = -1, d2 = Infinity;
    for (let p = 0; p < paleta.length; p++) {
      const c = paleta[p];
      const d = (r-c[0])**2 + (g-c[1])**2 + (b-c[2])**2;
      if (d < d1) { d2 = d1; i2 = i1; d1 = d; i1 = p; } else if (d < d2) { d2 = d; i2 = p; }
    }
    if (i1 !== k && i2 !== k) continue;
    let frac = 1;
    if (i2 >= 0) {
      const A = paleta[i1], B = paleta[i2];
      const vx = A[0]-B[0], vy = A[1]-B[1], vz = A[2]-B[2];
      const den = vx*vx + vy*vy + vz*vz;
      if (den > 1e-9) {
        frac = ((r-B[0])*vx + (g-B[1])*vy + (b-B[2])*vz) / den;
        frac = frac < 0 ? 0 : frac > 1 ? 1 : frac;
      }
    }
    f[i] = (i1 === k ? frac : 1 - frac) * a;
  }
  return f;
}

/** Pixels do INTERIOR (erodidos), para estimar o preenchimento sem contaminacao da borda:
 *  num pixel de borda a cor e mistura com o vizinho — usar isso puxaria o gradiente. */
function interiores(campo, rgba, w, h, minCampo = 0.98, maxAmostras = 30000) {
  // Subamostragem por passo regular. O preenchimento e um modelo GLOBAL da regiao (um plano por
  // canal, um eixo, uma curva de paradas), entao 30 mil pontos estimam tao bem quanto 1,3 milhao
  // — e a busca do centro radial, que reavalia a regiao ~100 vezes, sairia de centenas de milhoes
  // de operacoes numa imagem de 1 megapixel. Passo regular (nao aleatorio) mantem o resultado
  // reproduzivel entre execucoes.
  const px = [];
  const passo = Math.max(1, Math.round(Math.sqrt((w * h) / maxAmostras)));
  for (let y = 1; y < h - 1; y += passo) for (let x = 1; x < w - 1; x += passo) {
    const i = y * w + x;
    if (campo[i] < minCampo) continue;
    if (campo[i-1] < 0.9 || campo[i+1] < 0.9 || campo[i-w] < 0.9 || campo[i+w] < 0.9) continue;
    if (rgba[i*4+3] < 250) continue;
    px.push({ x: x + 0.5, y: y + 0.5, r: rgba[i*4], g: rgba[i*4+1], b: rgba[i*4+2] });
  }
  return px;
}

/* ---------- SVG ---------- */

const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
const nf = (v, c = 3) => { const s = v.toFixed(c); return s.replace(/\.?0+$/, '') || '0'; };

function defDeGradiente(f, id) {
  const st = f.paradas.map((s) =>
    `<stop offset="${nf(s.offset, 4)}" stop-color="${hex(s.r, s.g, s.b)}"/>`).join('');
  if (f.tipo === 'linear') {
    return `<linearGradient id="${id}" x1="${nf(f.x1)}" y1="${nf(f.y1)}" x2="${nf(f.x2)}" y2="${nf(f.y2)}" gradientUnits="userSpaceOnUse">${st}</linearGradient>`;
  }
  return `<radialGradient id="${id}" cx="${nf(f.cx)}" cy="${nf(f.cy)}" r="${nf(f.r)}" gradientUnits="userSpaceOnUse">${st}</radialGradient>`;
}

/* ---------- pipeline ---------- */

/** Escolhe K pelo residuo: cresce enquanto a PIOR classe nao for explicada pelo seu modelo.
 *
 * O descarte de pixel de costura e ESPACIAL, nao por proximidade de cor. A primeira versao
 * descartava pixel cuja cor caisse entre duas entradas da paleta; numa ilustracao com sombreado
 * suave isso descarta a MAIORIA dos pixels, e o residuo saia medido num subconjunto nao
 * representativo — um caso real reportou 3,2 e errava 23 de fato. O criterio espacial (o pixel
 * tem vizinho de outra classe) descarta exatamente a franja de antisserrilhado e preserva todo
 * o interior sombreado. `cobertura` diz que fracao sobreviveu: residuo medido em pouca amostra
 * nao merece confianca, e isso vai no diagnostico.
 */
function escolheClasses(rgba, w, h, opc, limiarResiduo, maxCores) {
  // O relato de progresso e opcional e nao muda resultado nenhum: `andou` some quando ninguem
  // passa `aoAndar`, e e assim que o vetorizador.html de duplo clique roda. Quem passa e o
  // worker do app (web/src/engines/vetorizador.worker.ts).
  //
  // Ele existe porque esta funcao e a parte demorada. Medido por
  // `ferramentas/medir-vetorizador.mjs` em arte chapada de 900x900, num total de 1765 ms:
  // analise 16 ms, classes 1584 ms (90%), camadas 167 ms, montagem ~0 ms.
  //
  // E dentro de `classes` o tempo esta quase todo num lugar so: 1388 ms na tentativa de K=1, que
  // e um unico `ajustaPreenchimento` sobre a amostra inteira. Esse bloco e atomico — nao ha
  // laco por onde relatar de dentro dele. Por isso a barra do app fica parada nessa fracao por
  // mais de um segundo, com o brilho de atividade cobrindo a espera, e nao por descuido.
  //
  // Quem for otimizar o vetorizador: e esse o alvo, e ele vale 80% do tempo total.
  const andou = opc.aoAndar || (() => {});
  andou('classes', 0, 'amostrando');
  const passo = Math.max(1, Math.round(Math.sqrt((w * h) / 40000)));
  const gw = Math.floor((w - 2) / passo), gh = Math.floor((h - 2) / passo);
  if (gw < 1 || gh < 1) return { paleta: null, K: 0, ajustes: [], residuo: 0, tentativas: [] };

  // grade reduzida de pixels opacos (o proprio anel de alfa parcial ja fica de fora)
  const gx = new Int32Array(gw * gh).fill(-1);
  const amostra = [];
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const x = 1 + i * passo, y = 1 + j * passo, k = y * w + x;
    if (rgba[k*4+3] < 250) continue;
    if (rgba[(k-1)*4+3] < 240 || rgba[(k+1)*4+3] < 240 ||
        rgba[(k-w)*4+3] < 240 || rgba[(k+w)*4+3] < 240) continue;
    gx[j * gw + i] = amostra.length;
    amostra.push({ x: x + 0.5, y: y + 0.5, r: rgba[k*4], g: rgba[k*4+1], b: rgba[k*4+2] });
  }
  if (!amostra.length) return { paleta: null, K: 0, ajustes: [], residuo: 0, tentativas: [] };

  // Cores dominantes exatas, quando existem, entram como CANDIDATO PRIVILEGIADO: em arte chapada
  // elas sao a paleta verdadeira, e testar esse K logo apos K=1 evita subir 1,2,3... ate chegar la.
  andou('classes', 0.1, 'procurando as cores dominantes');
  const dominantes = coresDominantes(rgba, w, h, maxCores);
  andou('classes', 0.45, dominantes ? dominantes.length + ' cores dominantes' : 'sem cor dominante');
  const ordem = [];
  const poe = (k) => { if (k >= 1 && k <= maxCores && !ordem.includes(k)) ordem.push(k); };
  poe(1);
  if (dominantes) poe(dominantes.length);
  for (let k = 2; k <= maxCores; k++) poe(k);

  const tentativas = [];
  let ultimo = null;
  for (const K of ordem) {
    // A busca para no primeiro K que fecha, entao esta fracao anda ate onde a busca precisou ir
    // e nao ate 1. E o valor real: a etapa terminou mesmo, so terminou antes.
    andou('classes', 0.45 + 0.55 * (tentativas.length / ordem.length),
          'testando ' + K + ' cor' + (K > 1 ? 'es' : ''));
    const paleta = K === 1 ? [mediaDe(amostra)]
                : (dominantes && dominantes.length <= K ? dominantes : paletaKMeans(rgba, w, h, K));
    const rot = new Int32Array(amostra.length);
    for (let a = 0; a < amostra.length; a++) {
      const px = amostra[a];
      let melhor = 0, dm = Infinity;
      for (let k = 0; k < paleta.length; k++) {
        const c = paleta[k];
        const d = (px.r-c[0])**2 + (px.g-c[1])**2 + (px.b-c[2])**2;
        if (d < dm) { dm = d; melhor = k; }
      }
      rot[a] = melhor;
    }
    // costura: vizinho de outra classe na grade reduzida
    const grupos = paleta.map(() => []);
    let usados = 0;
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const a = gx[j * gw + i]; if (a < 0) continue;
      let fronteira = false;
      for (const [di, dj] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= gw || jj >= gh) continue;
        const b = gx[jj * gw + ii];
        if (b < 0 || rot[b] !== rot[a]) { fronteira = true; break; }
      }
      if (fronteira) continue;
      grupos[rot[a]].push(amostra[a]); usados++;
    }
    const ajustes = grupos.map((g) => g.length >= 8 ? ajustaPreenchimento(g, opc) : null);
    const vivos = ajustes.filter(Boolean);
    const pior = vivos.length ? Math.max(...vivos.map((a) => a.res.p95)) : Infinity;
    const piorCauda = vivos.length ? Math.max(...vivos.map((a) => a.res.p99)) : Infinity;
    const cobertura = usados / amostra.length;
    tentativas.push({ K, nPaleta: paleta.length, pior: Number.isFinite(pior) ? +pior.toFixed(2) : null,
                      cauda: Number.isFinite(piorCauda) ? +piorCauda.toFixed(2) : null,
                      cobertura: +cobertura.toFixed(2) });
    ultimo = { paleta, K, ajustes, residuo: pior, cauda: piorCauda, cobertura,
               viaDom: !!(dominantes && dominantes.length <= K && K > 1) };
    // dois portoes: o corpo da distribuicao (p95) E a cauda (p99). So o p95 aceitava modelo
    // errado — um radial de 10 paradas fingindo explicar duas cores chapadas separadas.
    if (pior <= limiarResiduo && piorCauda <= limiarResiduo * 2.5 && cobertura >= 0.25) break;
  }
  return { ...ultimo, tentativas };
}

/** So para o diagnostico: a paleta escolhida veio da moda exata ou do agrupamento? */
const dominantesUsadas = (esc) => esc && esc.paleta && esc.paleta.length > 1 && esc.viaDom;

const mediaDe = (px) => {
  const s = [0, 0, 0];
  for (const p of px) { s[0] += p.r; s[1] += p.g; s[2] += p.b; }
  return s.map((v) => Math.round(v / px.length));
};

/**
 * Traca o SVG.
 *
 * `opc.aoAndar(etapa, dentro, detalhe)` e opcional: quando dado, e chamado com a etapa corrente
 * ('analise', 'classes', 'camadas', 'montagem') e quanto dela ja andou, de 0 a 1. Serve para a
 * barra de progresso do app mostrar valor REAL em vez de animacao inventada — o vetorizador leva
 * de 1 a 4 segundos, e mais de um segundo disso e um unico bloco atomico.
 *
 * Ela NAO entra no tipo `OpcoesVetor` do nucleo de proposito: as opcoes de um trabalho de
 * servidor atravessam JSON, e uma funcao ali quebraria a serializacao. Quem passa `aoAndar` e o
 * worker, que roda no mesmo processo. O `vetorizador.html` de duplo clique nao passa nada e o
 * codigo se comporta exatamente como antes.
 */
export function vetorizar(rgba, w, h, opc = {}) {
  const {
    tol = 0.6, grausMin = 42, casas = 3, areaMin = 2,
    limiarResiduo = 6, maxCores = 12, forcarFoto = false,
  } = opc;
  const andou = opc.aoAndar || (() => {});
  andou('analise', 0);
  const info = analisa(rgba, w, h);
  andou('analise', 1, info.cores + ' cores, chapeza ' + info.chapeza.toFixed(2));
  const diag = { ...info, avisos: [], camadas: [] };

  if (info.modo === 'foto' && !forcarFoto) {
    diag.avisos.push('Imagem parece FOTOGRAFICA (' + info.cores + ' cores distintas, chapeza ' +
      info.chapeza.toFixed(2) + '). SVG e o formato errado para isto: o arquivo sairia maior que ' +
      'o original e com menos detalhe. Mantenha o raster — ou force, se souber o que quer.');
    return { svg: null, diag };
  }

  const esc = escolheClasses(rgba, w, h, opc, limiarResiduo, maxCores);
  if (!esc.paleta) { diag.avisos.push('Nada opaco para vetorizar.'); return { svg: null, diag }; }
  const n = w * h;
  diag.K = esc.paleta.length;
  diag.viaDominantes = !!(dominantesUsadas(esc));
  diag.buscaK = esc.tentativas;
  diag.residuoPior = esc.residuo;
  diag.cobertura = esc.cobertura;
  diag.cauda = esc.cauda;
  if (esc.cobertura < 0.4) {
    diag.avisos.push('Amostra de interior magra (' + (esc.cobertura*100).toFixed(0) + '% dos ' +
      'pixels sobreviveram ao descarte de costura): a imagem tem estrutura fina em toda parte, ' +
      'e o residuo estimado e otimista. Confie na medicao de fidelidade, nao neste numero.');
  }
  diag.paleta = esc.paleta.map((c) => hex(c[0], c[1], c[2]));
  if (esc.residuo > limiarResiduo) {
    diag.avisos.push('Nem com ' + esc.K + ' classes o modelo de pintura fechou (pior residuo ' +
      esc.residuo.toFixed(1) + '/255). O desenho sai fiel na FORMA, aproximado na COR.');
  }

  andou('camadas', 0);
  const camadas = esc.paleta.map((_, k) => ({
    nome: 'c' + k,
    campo: campoClasse(rgba, n, esc.paleta, k),
    ajuste: esc.ajustes[k],
  })).filter((c) => c.ajuste);

  for (const c of camadas) { let s = 0; for (let i = 0; i < n; i++) s += c.campo[i]; c.peso = s; }
  camadas.sort((a, b) => b.peso - a.peso);

  const opaca = info.fracVazio < 0.005 && info.fracParcial < 0.02;
  const defs = [], corpo = [];
  let nosTotal = 0;

  camadas.forEach((cam, idx) => {
    andou('camadas', idx / camadas.length, 'camada ' + (idx + 1) + ' de ' + camadas.length);
    if (cam.peso < areaMin) return;
    const f = cam.ajuste;
    let pintura;
    if (f.tipo === 'chapado') pintura = hex(f.r, f.g, f.b);
    else { const id = 'g' + idx; defs.push(defDeGradiente(f, id)); pintura = 'url(#' + id + ')'; }
    const linha = { pintura: f.tipo, paradas: f.paradas ? f.paradas.length : 0,
                    res: f.res, cor: f.tipo === 'chapado' ? pintura : undefined };

    // camada de fundo (imagem opaca): retangulo de sangria mata o fio de costura
    // onde tres classes se encontram, e ainda economiza os nos do contorno externo
    if (opaca && idx === 0) {
      corpo.push('<rect width="' + w + '" height="' + h + '" fill="' + pintura + '"/>');
      diag.camadas.push({ ...linha, nos: 0, obs: 'fundo (rect)' });
      return;
    }

    const { campo: cf, w: W, h: H, desloca } = comMoldura(cam.campo, w, h, 0);
    const loops = contornos(cf, W, H, 0.5, desloca).filter((l) => Math.abs(area(l)) >= areaMin);
    if (!loops.length) return;
    let nos = 0;
    const d = loops.map((l) => {
      const bz = loopParaBeziers(l, tol, grausMin);
      nos += bz.length;
      return beziersParaPath(bz, casas);
    }).join('');
    nosTotal += nos;
    corpo.push('<path d="' + d + '" fill="' + pintura + '" fill-rule="nonzero"/>');
    diag.camadas.push({ ...linha, loops: loops.length, nos });
  });

  andou('montagem', 0);
  diag.nos = nosTotal;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" width="' + w +
    '" height="' + h + '">' + (defs.length ? '<defs>' + defs.join('') + '</defs>' : '') +
    corpo.join('') + '</svg>';
  andou('montagem', 1);
  return { svg, diag };
}
