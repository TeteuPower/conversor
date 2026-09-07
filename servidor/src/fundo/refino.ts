/**
 * O que acontece com a máscara DEPOIS que o modelo entrega ela.
 *
 * O modelo devolve um alfa por pixel e nada mais. Isso já recorta, mas recorta com o defeito que
 * denuncia recorte automático a olho nu: a auréola. Onde o cabelo é fino, o pixel original é uma
 * MISTURA de cabelo com o fundo antigo — e sair só aplicando o alfa mantém essa mistura. O
 * resultado é um contorno esverdeado num retrato tirado no jardim, azulado num tirado no céu.
 * Trocar o fundo por branco põe o problema em evidência.
 *
 * Este arquivo resolve isso, e é conta nossa: nenhum modelo de segmentação faz.
 *
 * ---
 *
 * A equação de composição diz que o pixel observado é
 *
 *     C = α·F + (1−α)·B
 *
 * com F a cor verdadeira do primeiro plano e B a do fundo. O modelo nos deu α e a câmera nos deu
 * C; então dá para isolar F:
 *
 *     F = (C − (1−α)·B) / α
 *
 * O problema inteiro vira estimar B em cada pixel de borda. Duas armadilhas:
 *
 * 1. **B não é uma cor só.** Usar a média do fundo inteiro funciona em foto de estúdio e falha em
 *    qualquer foto real, onde o fundo tem céu em cima e grama embaixo. A estimativa tem de ser
 *    LOCAL: para cada pixel de borda, o fundo que estava ali por perto.
 *
 * 2. **A divisão por α explode.** Com α = 0,03 o denominador é ruído, e F sai saturado — vira
 *    pontinho colorido no cabelo, pior que a auréola que se queria tirar. Por isso o resultado é
 *    misturado com a cor de primeiro plano propagada dos pixels opacos vizinhos, com peso que
 *    cresce junto com α.
 *
 * A estimativa local dos dois campos (fundo e primeiro plano) é feita por convolução
 * normalizada: borra a cor onde ela é conhecida, borra separadamente a máscara de "é conhecida",
 * e divide um pelo outro. Onde não havia informação, a divisão devolve a média dos vizinhos que
 * havia — que é exatamente o que se quer propagar para dentro da borda.
 */

/** Abaixo disto o pixel conta como fundo puro; acima do outro, como primeiro plano puro. */
const SO_FUNDO = 0.02;
const SO_PRIMEIRO_PLANO = 0.98;

/**
 * Abaixo deste alfa, a conta de F é instável demais para ser usada sozinha.
 *
 * 0,25 saiu de teste: abaixo disso o denominador da divisão é pequeno o bastante para o ruído do
 * sensor virar cor saturada. Entre 0,25 e 1 o peso sobe suave, então não há degrau visível entre
 * o pixel que foi resolvido e o que foi propagado.
 */
const ALFA_CONFIAVEL = 0.25;

export interface OpcoesRefino {
  /** Raio da estimativa local, em pixels. Ausente escolhe pelo tamanho da imagem. */
  raio?: number;
}

/**
 * Tira a cor do fundo antigo dos pixels de borda. Reescreve `rgb` no lugar.
 *
 * `rgb` é entrelaçado com 3 canais e `alfa` tem um byte por pixel — os dois com `l × a` pixels.
 */
export function descontamina(
  rgb: Uint8Array,
  alfa: Uint8Array,
  l: number,
  a: number,
  opc: OpcoesRefino = {},
): void {
  const n = l * a;
  // O raio precisa acompanhar o tamanho da imagem: 8 px numa foto de 6000 px de largura mal saem
  // da própria borda e não alcançam fundo nenhum. Um duzentos avos do menor lado, com piso de 6,
  // cobre desde miniatura até foto de câmera.
  const raio = Math.max(6, Math.round(opc.raio ?? Math.min(l, a) / 200));

  // Campos conhecidos: cor onde o pixel é puro, peso 1 ali e 0 no resto.
  const corFundo = new Float32Array(n * 3);
  const pesoFundo = new Float32Array(n);
  const corFrente = new Float32Array(n * 3);
  const pesoFrente = new Float32Array(n);

  let somaFundo0 = 0, somaFundo1 = 0, somaFundo2 = 0, contaFundo = 0;

  for (let i = 0; i < n; i++) {
    const A = alfa[i]! / 255;
    const r = rgb[i * 3]!, g = rgb[i * 3 + 1]!, b = rgb[i * 3 + 2]!;
    if (A <= SO_FUNDO) {
      corFundo[i * 3] = r; corFundo[i * 3 + 1] = g; corFundo[i * 3 + 2] = b;
      pesoFundo[i] = 1;
      somaFundo0 += r; somaFundo1 += g; somaFundo2 += b; contaFundo++;
    } else if (A >= SO_PRIMEIRO_PLANO) {
      corFrente[i * 3] = r; corFrente[i * 3 + 1] = g; corFrente[i * 3 + 2] = b;
      pesoFrente[i] = 1;
    }
  }

  // Imagem sem fundo puro nenhum (o assunto ocupa tudo): não há o que descontaminar, e insistir
  // só inventaria cor. Sair aqui é a resposta certa.
  if (contaFundo === 0) return;

  const mediaFundo = [somaFundo0 / contaFundo, somaFundo1 / contaFundo, somaFundo2 / contaFundo] as const;

  // Três passadas de caixa aproximam uma gaussiana bem o bastante e custam O(n) cada, sem
  // depender do raio — o que importa quando o raio passa de 30 px em foto grande.
  for (let p = 0; p < 3; p++) {
    borraCaixa3(corFundo, l, a, raio);
    borraCaixa1(pesoFundo, l, a, raio);
    borraCaixa3(corFrente, l, a, raio);
    borraCaixa1(pesoFrente, l, a, raio);
  }

  for (let i = 0; i < n; i++) {
    const A = alfa[i]! / 255;
    if (A <= SO_FUNDO || A >= SO_PRIMEIRO_PLANO) continue;

    // Fundo local; sem vizinho conhecido, cai na média global do fundo.
    const pf = pesoFundo[i]!;
    const bR = pf > 1e-4 ? corFundo[i * 3]! / pf : mediaFundo[0];
    const bG = pf > 1e-4 ? corFundo[i * 3 + 1]! / pf : mediaFundo[1];
    const bB = pf > 1e-4 ? corFundo[i * 3 + 2]! / pf : mediaFundo[2];

    // Primeiro plano local, para o caso de a divisão não ser confiável.
    const pp = pesoFrente[i]!;
    const temFrente = pp > 1e-4;
    const fR = temFrente ? corFrente[i * 3]! / pp : rgb[i * 3]!;
    const fG = temFrente ? corFrente[i * 3 + 1]! / pp : rgb[i * 3 + 1]!;
    const fB = temFrente ? corFrente[i * 3 + 2]! / pp : rgb[i * 3 + 2]!;

    // F = (C − (1−α)·B) / α
    const um = 1 - A;
    const rR = (rgb[i * 3]! - um * bR) / A;
    const rG = (rgb[i * 3 + 1]! - um * bG) / A;
    const rB = (rgb[i * 3 + 2]! - um * bB) / A;

    // Quanto confiar na divisão. Sobe suave a partir de ALFA_CONFIAVEL para não deixar degrau
    // entre o pixel resolvido e o propagado.
    const t = A <= ALFA_CONFIAVEL ? 0 : (A - ALFA_CONFIAVEL) / (1 - ALFA_CONFIAVEL);
    const peso = t * t * (3 - 2 * t); // suavização de Hermite

    rgb[i * 3] = apara(peso * rR + (1 - peso) * fR);
    rgb[i * 3 + 1] = apara(peso * rG + (1 - peso) * fG);
    rgb[i * 3 + 2] = apara(peso * rB + (1 - peso) * fB);
  }
}

const apara = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/* ==================== borrões separáveis ==================== */

/**
 * Borrão de caixa em um canal, separável e com soma móvel: o custo não depende do raio.
 *
 * A borda é tratada por repetição do pixel da ponta. Zerar fora da imagem puxaria a estimativa
 * do fundo para preto justamente na moldura, que é onde mais tem pixel de fundo.
 */
function borraCaixa1(dados: Float32Array, l: number, a: number, raio: number): void {
  const tmp = new Float32Array(dados.length);
  const largura = raio * 2 + 1;

  for (let y = 0; y < a; y++) {
    const linha = y * l;
    let soma = dados[linha]! * (raio + 1);
    for (let x = 1; x <= raio; x++) soma += dados[linha + Math.min(x, l - 1)]!;
    for (let x = 0; x < l; x++) {
      tmp[linha + x] = soma / largura;
      soma += dados[linha + Math.min(x + raio + 1, l - 1)]! - dados[linha + Math.max(x - raio, 0)]!;
    }
  }
  for (let x = 0; x < l; x++) {
    let soma = tmp[x]! * (raio + 1);
    for (let y = 1; y <= raio; y++) soma += tmp[Math.min(y, a - 1) * l + x]!;
    for (let y = 0; y < a; y++) {
      dados[y * l + x] = soma / largura;
      soma += tmp[Math.min(y + raio + 1, a - 1) * l + x]! - tmp[Math.max(y - raio, 0) * l + x]!;
    }
  }
}

/** O mesmo, para os três canais entrelaçados. */
function borraCaixa3(dados: Float32Array, l: number, a: number, raio: number): void {
  const tmp = new Float32Array(dados.length);
  const largura = raio * 2 + 1;

  for (let y = 0; y < a; y++) {
    const linha = y * l;
    for (let c = 0; c < 3; c++) {
      let soma = dados[linha * 3 + c]! * (raio + 1);
      for (let x = 1; x <= raio; x++) soma += dados[(linha + Math.min(x, l - 1)) * 3 + c]!;
      for (let x = 0; x < l; x++) {
        tmp[(linha + x) * 3 + c] = soma / largura;
        soma +=
          dados[(linha + Math.min(x + raio + 1, l - 1)) * 3 + c]! -
          dados[(linha + Math.max(x - raio, 0)) * 3 + c]!;
      }
    }
  }
  for (let x = 0; x < l; x++) {
    for (let c = 0; c < 3; c++) {
      let soma = tmp[x * 3 + c]! * (raio + 1);
      for (let y = 1; y <= raio; y++) soma += tmp[(Math.min(y, a - 1) * l + x) * 3 + c]!;
      for (let y = 0; y < a; y++) {
        dados[(y * l + x) * 3 + c] = soma / largura;
        soma +=
          tmp[(Math.min(y + raio + 1, a - 1) * l + x) * 3 + c]! -
          tmp[(Math.max(y - raio, 0) * l + x) * 3 + c]!;
      }
    }
  }
}

/* ==================== ajustes na máscara ==================== */

/**
 * Encolhe a máscara por erosão em `px` pixels.
 *
 * Existe para o caso em que sobrou uma orla clara do fundo antigo. Come um fio do objeto junto,
 * então fica desligado por padrão — é remédio, não vitamina.
 */
export function encolhe(alfa: Uint8Array, l: number, a: number, px: number): Uint8Array {
  if (px <= 0) return alfa;
  let atual = alfa;
  for (let passo = 0; passo < px; passo++) {
    const saida = new Uint8Array(atual.length);
    for (let y = 0; y < a; y++) {
      for (let x = 0; x < l; x++) {
        const i = y * l + x;
        let menor = atual[i]!;
        if (x > 0) menor = Math.min(menor, atual[i - 1]!);
        if (x < l - 1) menor = Math.min(menor, atual[i + 1]!);
        if (y > 0) menor = Math.min(menor, atual[i - l]!);
        if (y < a - 1) menor = Math.min(menor, atual[i + l]!);
        saida[i] = menor;
      }
    }
    atual = saida;
  }
  return atual;
}

/** Suaviza a borda da máscara. Raio em pixels. */
export function suaviza(alfa: Uint8Array, l: number, a: number, raio: number): Uint8Array {
  if (raio <= 0) return alfa;
  const f = new Float32Array(alfa.length);
  for (let i = 0; i < alfa.length; i++) f[i] = alfa[i]!;
  borraCaixa1(f, l, a, Math.round(raio));
  const saida = new Uint8Array(alfa.length);
  for (let i = 0; i < f.length; i++) saida[i] = apara(f[i]!);
  return saida;
}

/**
 * O retângulo do assunto: `[x, y, largura, altura]`.
 *
 * O limiar é 8 de 255, e não 1, porque o modelo deixa um resíduo baixíssimo espalhado pela
 * imagem inteira. Com limiar 1 a caixa daria quase sempre a imagem toda, e o recorte automático
 * não recortaria nada.
 */
export function caixaDoAssunto(alfa: Uint8Array, l: number, a: number): [number, number, number, number] {
  let x0 = l, y0 = a, x1 = -1, y1 = -1;
  for (let y = 0; y < a; y++) {
    const linha = y * l;
    for (let x = 0; x < l; x++) {
      if (alfa[linha + x]! > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return [0, 0, l, a]; // máscara vazia: a caixa é a imagem inteira
  return [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

/** Fração de pixels em borda macia. A interface usa para saber quando sugerir o pincel. */
export function fracaoDeBorda(alfa: Uint8Array): number {
  let macios = 0;
  for (let i = 0; i < alfa.length; i++) {
    const v = alfa[i]!;
    if (v > 12 && v < 242) macios++;
  }
  return macios / alfa.length;
}
