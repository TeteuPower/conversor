/* curvas.js — polilinha densa -> Beziers cubicas.
 *
 * Duas etapas, e a ORDEM importa: cantos primeiro, ajuste depois. Se ajustar antes, a curva
 * arredonda o canto (a Bezier e suave por construcao) e o desenho perde a quina. Se simplificar
 * antes (Douglas-Peucker no contorno cru), a posicao do canto ja vem deslocada.
 *
 * Cantos sao detectados no contorno DENSO com janela de raio fixo em px — angulo de virada medido
 * entre P[i-k]->P[i] e P[i]->P[i+k]. Medir entre vizinhos imediatos nao serve: num contorno
 * subpixel os passos sao curtos e o ruido de meio nivel de alfa vira "canto" em todo lugar.
 */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, s) => [a[0] * s, a[1] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const norm = (a) => { const n = Math.hypot(a[0], a[1]) || 1; return [a[0] / n, a[1] / n]; };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Indices de canto num loop fechado. `grausMin` = virada minima; `janela` = raio em pontos. */
export function cantos(pts, grausMin = 42, janela = 4) {
  const n = pts.length;
  if (n < janela * 2 + 3) return [];
  // `virada` e o cosseno do angulo de VIRADA: 1 = reto, 0 = 90 graus, -1 = volta completa.
  // Logo o limiar e cos(grausMin) — nao cos(180-grausMin), que e a convencao do angulo INTERNO
  // e exigia virada de 138 graus para aceitar uma quina de 90.
  const lim = Math.cos(grausMin * Math.PI / 180);
  const virada = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = norm(sub(pts[i], pts[(i - janela + n) % n]));
    const b = norm(sub(pts[(i + janela) % n], pts[i]));
    virada[i] = dot(a, b);                                   // 1 = reto, -1 = volta
  }
  // supressao de nao-maximo: dentro de uma vizinhanca, so o ponto de virada MAIS forte vira canto
  const out = [];
  for (let i = 0; i < n; i++) {
    if (virada[i] > lim) continue;
    let melhor = true;
    for (let d = -janela; d <= janela; d++) {
      if (d === 0) continue;
      const j = (i + d + n) % n;
      if (virada[j] < virada[i] || (virada[j] === virada[i] && j < i)) { melhor = false; break; }
    }
    if (melhor) out.push(i);
  }
  return out;
}

/* ---- Schneider: ajuste de Bezier cubica por minimos quadrados ---- */

const B0 = (u) => (1 - u) ** 3, B1 = (u) => 3 * u * (1 - u) ** 2,
      B2 = (u) => 3 * u * u * (1 - u), B3 = (u) => u ** 3;

const naBezier = (bz, u) =>
  add(add(mul(bz[0], B0(u)), mul(bz[1], B1(u))), add(mul(bz[2], B2(u)), mul(bz[3], B3(u))));

function parametriza(P, ini, fim) {
  const u = [0];
  for (let i = ini + 1; i <= fim; i++) u.push(u[u.length - 1] + dist(P[i], P[i - 1]));
  const T = u[u.length - 1] || 1;
  return u.map((v) => v / T);
}

/** Controles internos por minimos quadrados, dadas as tangentes das pontas. */
function geraBezier(P, ini, fim, u, t1, t2) {
  const p0 = P[ini], p3 = P[fim];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i <= fim - ini; i++) {
    const ui = u[i];
    const a0 = mul(t1, B1(ui)), a1 = mul(t2, B2(ui));
    c00 += dot(a0, a0); c01 += dot(a0, a1); c11 += dot(a1, a1);
    const base = add(mul(p0, B0(ui) + B1(ui)), mul(p3, B2(ui) + B3(ui)));
    const tmp = sub(P[ini + i], base);
    x0 += dot(a0, tmp); x1 += dot(a1, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  let al1 = 0, al2 = 0;
  if (Math.abs(det) > 1e-12) { al1 = (c11 * x0 - c01 * x1) / det; al2 = (c00 * x1 - c01 * x0) / det; }
  const seg = dist(p0, p3);
  if (!(al1 > 1e-6) || !(al2 > 1e-6)) { al1 = al2 = seg / 3; }   // degenerado: heuristica da corda
  return [p0, add(p0, mul(t1, al1)), add(p3, mul(t2, al2)), p3];
}

function maiorErro(P, ini, fim, bz, u) {
  let max = 0, split = Math.floor((fim - ini + 1) / 2) + ini;
  for (let i = 1; i < fim - ini; i++) {
    const d = dist(naBezier(bz, u[i]), P[ini + i]);
    if (d * d > max) { max = d * d; split = ini + i; }
  }
  return [Math.sqrt(max), split];
}

/** Refina os parametros u por Newton-Raphson (aproxima cada ponto do seu pe na curva). */
function reparametriza(P, ini, fim, u, bz) {
  const d1 = [0, 1, 2].map((i) => mul(sub(bz[i + 1], bz[i]), 3));
  const d2 = [0, 1].map((i) => mul(sub(d1[i + 1], d1[i]), 2));
  const emQ = (D, deg, t) => {
    if (deg === 2) { const mt = 1 - t; return add(add(mul(D[0], mt * mt), mul(D[1], 2 * mt * t)), mul(D[2], t * t)); }
    return add(mul(D[0], 1 - t), mul(D[1], t));
  };
  return u.map((ui, i) => {
    const p = P[ini + i];
    const q = sub(naBezier(bz, ui), p);
    const q1 = emQ(d1, 2, ui), q2 = emQ(d2, 1, ui);
    const den = dot(q1, q1) + dot(q, q2);
    if (Math.abs(den) < 1e-12) return ui;
    const t = ui - dot(q, q1) / den;
    return t < 0 ? 0 : t > 1 ? 1 : t;
  });
}

/** Ajusta P[ini..fim] com o minimo de Beziers para ficar dentro de `tol` px. */
export function ajusta(P, ini, fim, t1, t2, tol, prof = 0) {
  if (fim - ini === 1) {
    const d = dist(P[ini], P[fim]) / 3;
    return [[P[ini], add(P[ini], mul(t1, d)), add(P[fim], mul(t2, d)), P[fim]]];
  }
  let u = parametriza(P, ini, fim);
  let bz = geraBezier(P, ini, fim, u, t1, t2);
  let [err, split] = maiorErro(P, ini, fim, bz, u);
  if (err < tol) return [bz];
  if (err < tol * 4 && prof < 24) {                  // perto: vale refinar antes de dividir
    for (let k = 0; k < 12; k++) {
      u = reparametriza(P, ini, fim, u, bz);
      bz = geraBezier(P, ini, fim, u, t1, t2);
      [err, split] = maiorErro(P, ini, fim, bz, u);
      if (err < tol) return [bz];
    }
  }
  if (prof > 28 || split <= ini || split >= fim) return [bz];
  // tangente central pela media dos vizinhos (suaviza ruido de 1 ponto)
  const k = Math.min(3, split - ini, fim - split);
  const tc = norm(sub(P[split - k], P[split + k]));
  return [
    ...ajusta(P, ini, split, t1, tc, tol, prof + 1),
    ...ajusta(P, split, fim, mul(tc, -1), t2, tol, prof + 1),
  ];
}

/** Loop fechado -> lista de Beziers, respeitando cantos. */
export function loopParaBeziers(pts, tol = 0.6, grausMin = 42, janela = 4) {
  const n = pts.length;
  let cs = cantos(pts, grausMin, janela);
  // loop liso (sem canto): corta em 2 pontos opostos para ter trechos abertos
  if (cs.length === 0) cs = [0, n >> 1];
  if (cs.length === 1) cs = [cs[0], (cs[0] + (n >> 1)) % n];
  cs.sort((a, b) => a - b);

  const tang = (i, sentido) => {
    const k = Math.min(3, n - 1);
    return sentido > 0 ? norm(sub(pts[(i + k) % n], pts[i])) : norm(sub(pts[(i - k + n) % n], pts[i]));
  };

  const out = [];
  for (let c = 0; c < cs.length; c++) {
    const a = cs[c], b = cs[(c + 1) % cs.length];
    // fatia do canto a ate o canto b (dando a volta quando b < a)
    const idx = [];
    for (let i = a; ; i = (i + 1) % n) { idx.push(i); if (i === b) break; if (idx.length > n) break; }
    if (idx.length < 2) continue;
    const P = idx.map((i) => pts[i]);
    out.push(...ajusta(P, 0, P.length - 1, tang(a, +1), tang(b, -1), tol));
  }
  return out;
}

/** Beziers -> trecho de path SVG (M/C/Z), com casas decimais controladas. */
export function beziersParaPath(bzs, casas = 3) {
  const f = (v) => {
    const s = v.toFixed(casas);
    return s.replace(/\.?0+$/, '') || '0';
  };
  let d = `M${f(bzs[0][0][0])} ${f(bzs[0][0][1])}`;
  for (const b of bzs) d += `C${f(b[1][0])} ${f(b[1][1])} ${f(b[2][0])} ${f(b[2][1])} ${f(b[3][0])} ${f(b[3][1])}`;
  return d + 'Z';
}
