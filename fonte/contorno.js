/* contorno.js — do campo de cobertura ao contorno subpixel.
 *
 * Por que campo CONTINUO e nao mascara binaria: uma mascara binaria so sabe "dentro/fora" no
 * centro do pixel, e o contorno sai em escada de 1px. O antisserrilhado da imagem de entrada
 * carrega a posicao real da borda com precisao subpixel (um pixel 40% coberto tem alfa 0.4);
 * marching squares no nivel 0.5 recupera essa posicao por interpolacao. E o que separa um
 * tracado que parece vetor de um que parece pixel ampliado.
 */

/** Campo com anel de "fora" em volta. Sem isso, forma que toca a borda da imagem gera loop ABERTO
 *  (as celulas so cobrem ate w-2) e o encadeamento quebra. O anel fecha o contorno exatamente na
 *  borda: a interpolacao entre o centro virtual em -0.5 (valor 0) e o centro 0.5 (valor 1) cai em 0. */
export function comMoldura(campo, w, h, fora = 0) {
  const W = w + 2, H = h + 2;
  const out = new Float32Array(W * H).fill(fora);
  for (let y = 0; y < h; y++) out.set(campo.subarray(y * w, y * w + w), (y + 1) * W + 1);
  return { campo: out, w: W, h: H, desloca: -1 };   // desloca: centro do pixel (x,y) fica em x+0.5+desloca
}

/* Chaves de aresta da grade: cada cruzamento mora numa aresta unica entre centros vizinhos.
 * Encadear por CHAVE (e nao por coordenada float) e exato — duas celulas vizinhas produzem
 * literalmente a mesma chave, sem depender de igualdade de ponto flutuante. */
const kH = (i, j) => 2 * (j * 65536 + i);        // aresta horizontal centro(i,j)-(i+1,j)
const kV = (i, j) => 2 * (j * 65536 + i) + 1;    // aresta vertical   centro(i,j)-(i,j+1)

/** Marching squares no nivel `nivel`. Devolve loops fechados de pontos em coordenada de PIXEL
 *  (centro do pixel (x,y) = x+0.5, y+0.5), orientados com o lado "dentro" a esquerda. */
export function contornos(campo, w, h, nivel = 0.5, desloca = 0) {
  const F = (i, j) => campo[j * w + i];
  const cx = (i) => i + 0.5 + desloca;

  // ponto de cruzamento numa aresta, por interpolacao linear
  const pH = (i, j) => { const a = F(i, j), b = F(i + 1, j); return [cx(i) + (nivel - a) / (b - a), cx(j)]; };
  const pV = (i, j) => { const a = F(i, j), b = F(i, j + 1); return [cx(i), cx(j) + (nivel - a) / (b - a)]; };

  const inicio = new Map();   // chave da aresta de PARTIDA -> { chaveFim, p0, p1 }

  for (let j = 0; j < h - 1; j++) {
    for (let i = 0; i < w - 1; i++) {
      const v = [F(i, j), F(i + 1, j), F(i + 1, j + 1), F(i, j + 1)];
      const d = v.map((x) => x >= nivel);
      const b = (d[0] ? 1 : 0) | (d[1] ? 2 : 0) | (d[2] ? 4 : 0) | (d[3] ? 8 : 0);
      if (b === 0 || b === 15) continue;

      // arestas na ordem do passeio c0->c1->c2->c3->c0
      const ar = [
        { k: kH(i, j),     p: pH(i, j)     },
        { k: kV(i + 1, j), p: pV(i + 1, j) },
        { k: kH(i, j + 1), p: pH(i, j + 1) },
        { k: kV(i, j),     p: pV(i, j)     },
      ];
      // regra de orientacao: no passeio, fora->dentro ABRE segmento, dentro->fora FECHA.
      // (deixa o lado "dentro" a esquerda do sentido de caminhada)
      const abre = [], fecha = [];
      for (let e = 0; e < 4; e++) {
        const de = d[e], para = d[(e + 1) & 3];
        if (!de && para) abre.push(e);
        else if (de && !para) fecha.push(e);
      }

      let pares;
      if (abre.length === 1) {
        pares = [[abre[0], fecha[0]]];
      } else {
        // sela (b===5 ou b===10): a media da celula decide se o "dentro" passa pelo centro
        const centroDentro = (v[0] + v[1] + v[2] + v[3]) / 4 >= nivel;
        // cada segmento isola UM canto; com centro dentro, isola os cantos de FORA, e vice-versa
        pares = centroDentro
          ? [[abre[0], fecha[0]], [abre[1], fecha[1]]]
          : [[abre[0], fecha[1]], [abre[1], fecha[0]]];
        // normaliza: garante que cada par une arestas ADJACENTES (compartilham um canto)
        pares = pares.map(([a, f]) => (((a + 1) & 3) === f || ((f + 1) & 3) === a) ? [a, f] : null).filter(Boolean);
        if (pares.length !== 2) {
          pares = centroDentro ? [[abre[0], fecha[1]], [abre[1], fecha[0]]] : [[abre[0], fecha[0]], [abre[1], fecha[1]]];
        }
      }
      for (const [a, f] of pares) {
        inicio.set(ar[a].k, { fim: ar[f].k, p0: ar[a].p, p1: ar[f].p });
      }
    }
  }

  // encadeia: de um segmento que termina na aresta K, o proximo e o que PARTE de K
  const loops = [];
  const vistos = new Set();
  for (const k0 of inicio.keys()) {
    if (vistos.has(k0)) continue;
    const pts = [];
    let k = k0, guarda = 0;
    while (k !== undefined && !vistos.has(k) && guarda++ < 4e6) {
      vistos.add(k);
      const seg = inicio.get(k);
      if (!seg) break;
      pts.push(seg.p0);
      k = seg.fim;
    }
    if (pts.length >= 3) loops.push(pts);
  }
  return loops;
}

/** Area assinada (shoelace). Em tela (y para baixo), positiva = sentido horario visual. */
export function area(pts) {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}
