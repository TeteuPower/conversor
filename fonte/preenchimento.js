/* preenchimento.js — descobre COMO uma regiao e pintada: cor chapada, gradiente linear ou radial.
 *
 * Este e o passo que separa este tracador dos comuns. Um tracador padrao trata cor como
 * rotulo: quantiza a imagem em N cores e cada uma vira um path chapado. Num gradiente isso
 * produz FAIXAS — dezenas de paths, banding visivel, e o arquivo cresce sem ganhar fidelidade.
 * Aqui a hipotese e outra: a regiao tem UM modelo de pintura, e o trabalho e estima-lo.
 *
 * Modelo linear: a cor depende de uma unica projecao t = p . d. Descobre-se d ajustando um PLANO
 * por canal (c ~ a*x + b*y + e) — se os tres canais variam ao longo da mesma direcao, e gradiente
 * linear. O eixo sai do autovetor principal da matriz de espalhamento dos (a,b), que e imune a
 * sinal: no icone do Hive o verde SOBE e o azul DESCE ao longo do mesmo eixo, e uma media
 * ingenua dos vetores os cancelaria.
 */

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/** Ajuste de plano c ~ a*x + b*y + e por minimos quadrados (normal equations 3x3, Cramer). */
function plano(px, canal) {
  let Sxx = 0, Sxy = 0, Syy = 0, Sx = 0, Sy = 0, N = 0, Sxc = 0, Syc = 0, Sc = 0;
  for (const p of px) {
    const x = p.x, y = p.y, c = p[canal];
    Sxx += x * x; Sxy += x * y; Syy += y * y; Sx += x; Sy += y; N++;
    Sxc += x * c; Syc += y * c; Sc += c;
  }
  const det = Sxx * (Syy * N - Sy * Sy) - Sxy * (Sxy * N - Sy * Sx) + Sx * (Sxy * Sy - Syy * Sx);
  if (Math.abs(det) < 1e-9) return [0, 0, Sc / (N || 1)];
  const d1 = Sxc * (Syy * N - Sy * Sy) - Sxy * (Syc * N - Sy * Sc) + Sx * (Syc * Sy - Syy * Sc);
  const d2 = Sxx * (Syc * N - Sy * Sc) - Sxc * (Sxy * N - Sy * Sx) + Sx * (Sxy * Sc - Syc * Sx);
  const d3 = Sxx * (Syy * Sc - Syc * Sy) - Sxy * (Sxy * Sc - Syc * Sx) + Sxc * (Sxy * Sy - Syy * Sx);
  return [d1 / det, d2 / det, d3 / det];
}

/** Curva de cor amostrada ao longo de t -> lista minima de paradas, por Douglas-Peucker em COR. */
function paradas(bins, tol) {
  const val = bins.filter((b) => b.n > 0);
  if (val.length < 2) return null;
  const keep = new Set([0, val.length - 1]);
  const rec = (a, b) => {
    if (b - a < 2) return;
    let pior = -1, iPior = -1;
    for (let i = a + 1; i < b; i++) {
      const f = (val[i].t - val[a].t) / ((val[b].t - val[a].t) || 1);
      const d = Math.max(
        Math.abs(val[a].r + (val[b].r - val[a].r) * f - val[i].r),
        Math.abs(val[a].g + (val[b].g - val[a].g) * f - val[i].g),
        Math.abs(val[a].b + (val[b].b - val[a].b) * f - val[i].b));
      if (d > pior) { pior = d; iPior = i; }
    }
    if (pior > tol) { keep.add(iPior); rec(a, iPior); rec(iPior, b); }
  };
  rec(0, val.length - 1);
  return [...keep].sort((a, b) => a - b).map((i) => ({
    offset: val[i].t, r: clamp255(val[i].r), g: clamp255(val[i].g), b: clamp255(val[i].b),
  }));
}

const avaliaParadas = (st, t) => {
  if (t <= st[0].offset) return st[0];
  for (let i = 1; i < st.length; i++) {
    if (t <= st[i].offset) {
      const a = st[i - 1], b = st[i];
      const f = (t - a.offset) / ((b.offset - a.offset) || 1);
      return { r: a.r + (b.r - a.r) * f, g: a.g + (b.g - a.g) * f, b: a.b + (b.b - a.b) * f };
    }
  }
  return st[st.length - 1];
};

/** Estatistica do desvio maximo por canal entre o modelo e os pixels. */
function residuo(px, tDe, st) {
  const e = [];
  for (const p of px) {
    const c = avaliaParadas(st, tDe(p));
    e.push(Math.max(Math.abs(c.r - p.r), Math.abs(c.g - p.g), Math.abs(c.b - p.b)));
  }
  e.sort((a, b) => a - b);
  // p99 ao lado do p95: um modelo ERRADO (um radial de muitas paradas contornando dois blocos de
  // cor) passa no p95 e delata-se na CAUDA. `max` sozinho e refem de um pixel de ruido.
  return {
    mediana: e[e.length >> 1], p95: e[Math.floor(e.length * 0.95)],
    p99: e[Math.floor(e.length * 0.99)], max: e[e.length - 1],
  };
}

function amostraCurva(px, tDe, nBins) {
  // O t de cada bin e a MEDIA REAL dos seus membros, nao a posicao ancora. Com t ancorado, bins
  // que recebem 2 ou 3 amostras (a divisao raramente e exata) tem seu centro de massa deslocado
  // de forma irregular; num gradiente ingreme isso injeta jitter proporcional a inclinacao
  // (~1/255 num caso medido) e o Douglas-Peucker, fiel, gasta paradas seguindo o ruido:
  // um degrade vermelho->branco->azul saia com 8 paradas em vez de 3. Com o t medio o par
  // (t, cor) fica consistente e o desvio se cancela.
  const bins = Array.from({ length: nBins }, () => ({ t: 0, r: 0, g: 0, b: 0, n: 0 }));
  for (const p of px) {
    const t = tDe(p);
    let k = Math.round(t * (nBins - 1)); if (k < 0) k = 0; if (k >= nBins) k = nBins - 1;
    const b = bins[k]; b.t += t; b.r += p.r; b.g += p.g; b.b += p.b; b.n++;
  }
  for (const b of bins) if (b.n) { b.t /= b.n; b.r /= b.n; b.g /= b.n; b.b /= b.n; }
  return bins;
}

function tentaLinear(px, tolParada, nBins) {
  const pr = plano(px, 'r'), pg = plano(px, 'g'), pb = plano(px, 'b');
  // autovetor principal da matriz de espalhamento dos gradientes (imune a sinal do canal)
  let m00 = 0, m01 = 0, m11 = 0;
  for (const [a, b] of [pr, pg, pb]) { m00 += a * a; m01 += a * b; m11 += b * b; }
  if (m00 + m11 < 1e-12) return null;
  const th = 0.5 * Math.atan2(2 * m01, m00 - m11);
  const d = [Math.cos(th), Math.sin(th)];

  let lo = Infinity, hi = -Infinity;
  for (const p of px) { const t = p.x * d[0] + p.y * d[1]; if (t < lo) lo = t; if (t > hi) hi = t; }
  if (hi - lo < 1e-9) return null;
  const tDe = (p) => ((p.x * d[0] + p.y * d[1]) - lo) / (hi - lo);

  const st = paradas(amostraCurva(px, tDe, nBins), tolParada);
  if (!st) return null;

  // Reescala EXATA: as paradas saem no t medido (a primeira um pouco acima de 0, a ultima um
  // pouco abaixo de 1). Em vez de extrapolar cor, encurto o VETOR do gradiente para o trecho
  // realmente medido e renormalizo os offsets — assim `pad` nunca precisa inventar faixa chapada.
  const ta = st[0].offset, tb = st[st.length - 1].offset, vao = (tb - ta) || 1;
  const projDe = (t) => lo + t * (hi - lo);
  const escalado = st.map((s) => ({ ...s, offset: (s.offset - ta) / vao }));
  const tEsc = (p) => (((p.x * d[0] + p.y * d[1]) - lo) / (hi - lo) - ta) / vao;
  return {
    tipo: 'linear',
    x1: d[0] * projDe(ta), y1: d[1] * projDe(ta),
    x2: d[0] * projDe(tb), y2: d[1] * projDe(tb),
    paradas: escalado, res: residuo(px, tEsc, escalado),
  };
}

function tentaRadial(px, tolParada, nBins) {
  // centro inicial no centroide; refina por busca local (o raio e nao-linear, nao sai de LSQ direto)
  let cx = 0, cy = 0;
  for (const p of px) { cx += p.x; cy += p.y; }
  cx /= px.length; cy /= px.length;
  let melhor = null, passo = Math.max(...px.map((p) => Math.abs(p.x - cx))) / 2 || 1;
  for (let it = 0; it < 11; it++) {
    let local = null;
    for (const [ox, oy] of [[0,0],[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]) {
      const ax = cx + ox * passo, ay = cy + oy * passo;
      let hi = 0; for (const p of px) { const r = Math.hypot(p.x - ax, p.y - ay); if (r > hi) hi = r; }
      if (hi < 1e-9) continue;
      const tDe = (p) => Math.hypot(p.x - ax, p.y - ay) / hi;
      const st = paradas(amostraCurva(px, tDe, nBins), tolParada);
      if (!st) continue;
      const res = residuo(px, tDe, st);
      if (!local || res.p95 < local.res.p95) local = { cx: ax, cy: ay, r: hi, paradas: st, res };
    }
    if (local && (!melhor || local.res.p95 < melhor.res.p95)) { melhor = local; cx = local.cx; cy = local.cy; }
    passo /= 2;
  }
  if (!melhor) return null;
  return { tipo: 'radial', cx: melhor.cx, cy: melhor.cy, r: melhor.r, paradas: melhor.paradas, res: melhor.res };
}

/** Decide o preenchimento de uma regiao. `px` = pixels interiores, opacos: {x,y,r,g,b}. */
export function ajustaPreenchimento(px, opc = {}) {
  const { tolChapado = 2.5, tolParada = 1.5, ganhoMin = 1.6 } = opc;
  // Bins proporcionais a raiz da amostra: com ~1000 pixels e 64 bins cada bin fica com ~15
  // amostras, o ruido da media passa da tolerancia e o DP gasta paradas nele (um logo de 133x51
  // saiu com 10 paradas). Menos bins em amostra magra = menos liberdade para superajustar.
  const nBins = Math.max(8, Math.min(64, Math.round(Math.sqrt(px.length) / 2)));
  if (!px.length) return { tipo: 'chapado', r: 0, g: 0, b: 0, res: { mediana: 0, p95: 0, max: 0 } };

  let sr = 0, sg = 0, sb = 0;
  for (const p of px) { sr += p.r; sg += p.g; sb += p.b; }
  const med = { r: sr / px.length, g: sg / px.length, b: sb / px.length };
  const chapado = {
    tipo: 'chapado', r: clamp255(med.r), g: clamp255(med.g), b: clamp255(med.b),
    res: residuo(px, () => 0, [{ offset: 0, r: med.r, g: med.g, b: med.b }]),
  };
  if (chapado.res.p95 <= tolChapado) return chapado;

  const cands = [tentaLinear(px, tolParada, nBins), tentaRadial(px, tolParada, nBins)].filter(Boolean);
  if (!cands.length) return chapado;
  cands.sort((a, b) => a.res.p95 - b.res.p95);
  const g = cands[0];
  // so troca chapado por gradiente se o ganho for real — senao um gradiente decorativo
  // com 2 paradas iguais entraria no lugar de uma cor solida
  return (chapado.res.p95 / Math.max(g.res.p95, 0.35) >= ganhoMin) ? g : chapado;
}
