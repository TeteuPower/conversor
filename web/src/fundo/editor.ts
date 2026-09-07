/**
 * O editor do recorte: compor, pintar, desfazer, exportar.
 *
 * Tudo aqui acontece no navegador, sem nenhuma volta ao servidor. O servidor entregou duas
 * imagens — o primeiro plano opaco e a máscara — e daqui para a frente o trabalho é local. É o
 * que faz o pincel parecer um pincel: entre soltar o botão e ver o resultado não há rede.
 *
 * ---
 *
 * **A composição é incremental, e isso é o que faz o pincel ser usável.**
 *
 * A conta ingênua seria, a cada movimento do mouse, remontar o RGBA inteiro e jogar no canvas.
 * Numa foto de 12 megapixels isso é 48 MB de escrita por quadro, e o pincel vira uma sucessão de
 * saltos. Em vez disso, cada pincelada sabe o retângulo que sujou, e só esse retângulo é
 * remontado e redesenhado.
 *
 * **O desfazer guarda retângulo, não imagem.**
 *
 * Guardar uma cópia da máscara por pincelada custaria 12 MB cada numa foto grande, e dez
 * pinceladas comeriam 120 MB. Cada passo guarda só os bytes de dentro do retângulo que mudou —
 * numa pincelada típica, alguns milhares de bytes.
 */

export type ModoPincel = 'restaurar' | 'apagar';

export type Fundo =
  | { tipo: 'transparente' }
  | { tipo: 'cor'; cor: string }
  | { tipo: 'imagem'; imagem: ImageBitmap };

export interface Retangulo {
  x: number;
  y: number;
  l: number;
  a: number;
}

interface PassoDesfazer {
  readonly r: Retangulo;
  readonly antes: Uint8Array;
}

const MAX_DESFAZER = 40;

export class Editor {
  readonly largura: number;
  readonly altura: number;

  /** O alfa corrente, um byte por pixel. É o que o pincel edita. */
  private readonly alfa: Uint8ClampedArray;
  /** O alfa como veio do modelo, para o botão de recomeçar. */
  private readonly alfaOriginal: Uint8ClampedArray;
  /** RGB do primeiro plano, entrelaçado. Nunca muda. */
  private readonly rgb: Uint8ClampedArray;

  /** O recorte montado (RGBA), pronto para ser desenhado sobre qualquer fundo. */
  private readonly recorte: OffscreenCanvas | HTMLCanvasElement;
  private readonly ctxRecorte: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

  private readonly historico: PassoDesfazer[] = [];

  private constructor(largura: number, altura: number, rgb: Uint8ClampedArray, alfa: Uint8ClampedArray) {
    this.largura = largura;
    this.altura = altura;
    this.rgb = rgb;
    this.alfa = alfa;
    this.alfaOriginal = new Uint8ClampedArray(alfa);

    this.recorte = criaCanvas(largura, altura);
    const ctx = this.recorte.getContext('2d', { willReadFrequently: false });
    if (!ctx) throw new Error('O navegador não deu um contexto 2d.');
    this.ctxRecorte = ctx as CanvasRenderingContext2D;
    this.remonta({ x: 0, y: 0, l: largura, a: altura });
  }

  /**
   * Monta o editor a partir das duas imagens do servidor.
   *
   * Os pixels são lidos UMA vez, aqui, e daí em diante vivem em arrays comuns. Ler do canvas a
   * cada operação seria mais simples e bem mais lento: `getImageData` sincroniza com a GPU.
   */
  static async de(frente: ImageBitmap, mascara: ImageBitmap): Promise<Editor> {
    const l = frente.width;
    const a = frente.height;
    if (mascara.width !== l || mascara.height !== a) {
      throw new Error(
        `A máscara (${mascara.width} × ${mascara.height}) não bate com o primeiro plano (${l} × ${a}).`,
      );
    }

    const leitura = criaCanvas(l, a);
    const ctx = leitura.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;

    ctx.drawImage(frente, 0, 0);
    const dadosFrente = ctx.getImageData(0, 0, l, a).data;
    const rgb = new Uint8ClampedArray(l * a * 3);
    for (let i = 0, n = l * a; i < n; i++) {
      rgb[i * 3] = dadosFrente[i * 4]!;
      rgb[i * 3 + 1] = dadosFrente[i * 4 + 1]!;
      rgb[i * 3 + 2] = dadosFrente[i * 4 + 2]!;
    }

    ctx.clearRect(0, 0, l, a);
    ctx.drawImage(mascara, 0, 0);
    const dadosMascara = ctx.getImageData(0, 0, l, a).data;
    const alfa = new Uint8ClampedArray(l * a);
    // A máscara é cinza: os três canais dizem o mesmo, então o vermelho basta.
    for (let i = 0, n = l * a; i < n; i++) alfa[i] = dadosMascara[i * 4]!;

    return new Editor(l, a, rgb, alfa);
  }

  /* ---------- pincel ---------- */

  /** Começa uma pincelada. Tudo até `terminaTraco` vira um passo só de desfazer. */
  comecaTraco(): void {
    this.pendente = { minX: this.largura, minY: this.altura, maxX: -1, maxY: -1, guardado: new Map() };
  }

  private pendente:
    | { minX: number; minY: number; maxX: number; maxY: number; guardado: Map<number, number> }
    | undefined;

  /**
   * Pinta um disco macio em (cx, cy).
   *
   * `dureza` de 0 a 1: 0 é borda bem esfumada, 1 é quase um carimbo. O padrão da interface é
   * baixo, porque num recorte a borda dura denuncia o retoque — e é justamente a borda que se
   * está tentando consertar.
   *
   * Devolve o retângulo que sujou, para quem desenha saber o que redesenhar.
   */
  pinta(cx: number, cy: number, raio: number, modo: ModoPincel, dureza = 0.35, fluxo = 1): Retangulo {
    const x0 = Math.max(0, Math.floor(cx - raio));
    const y0 = Math.max(0, Math.floor(cy - raio));
    const x1 = Math.min(this.largura - 1, Math.ceil(cx + raio));
    const y1 = Math.min(this.altura - 1, Math.ceil(cy + raio));
    if (x1 < x0 || y1 < y0) return { x: 0, y: 0, l: 0, a: 0 };

    const r2 = raio * raio;
    const inicioSuave = Math.max(0.001, dureza);

    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const t = Math.sqrt(d2) / raio; // 0 no centro, 1 na borda
        // Queda suave entre `dureza` e a borda. Hermite para não deixar aresta visível.
        const bruto = t <= inicioSuave ? 1 : 1 - (t - inicioSuave) / (1 - inicioSuave);
        const forca = bruto * bruto * (3 - 2 * bruto) * fluxo;
        if (forca <= 0) continue;

        const i = y * this.largura + x;
        this.guarda(i);
        const atual = this.alfa[i]!;
        this.alfa[i] =
          modo === 'restaurar'
            ? Math.max(atual, Math.round(forca * 255))
            : Math.min(atual, Math.round((1 - forca) * 255));
      }
    }

    const r: Retangulo = { x: x0, y: y0, l: x1 - x0 + 1, a: y1 - y0 + 1 };
    this.remonta(r);
    return r;
  }

  /** Guarda o valor anterior do pixel, uma vez por pincelada. */
  private guarda(i: number): void {
    const p = this.pendente;
    if (!p || p.guardado.has(i)) return;
    p.guardado.set(i, this.alfa[i]!);
    const x = i % this.largura;
    const y = (i / this.largura) | 0;
    if (x < p.minX) p.minX = x;
    if (x > p.maxX) p.maxX = x;
    if (y < p.minY) p.minY = y;
    if (y > p.maxY) p.maxY = y;
  }

  /** Fecha a pincelada e a empurra para o histórico. */
  terminaTraco(): void {
    const p = this.pendente;
    this.pendente = undefined;
    if (!p || p.maxX < 0 || p.guardado.size === 0) return;

    const r: Retangulo = { x: p.minX, y: p.minY, l: p.maxX - p.minX + 1, a: p.maxY - p.minY + 1 };
    const antes = new Uint8Array(r.l * r.a);
    // Preenche com o estado ATUAL e sobrescreve com os valores guardados: os pixels do retângulo
    // que a pincelada não tocou têm de voltar a eles mesmos, não a zero.
    for (let y = 0; y < r.a; y++) {
      for (let x = 0; x < r.l; x++) {
        antes[y * r.l + x] = this.alfa[(r.y + y) * this.largura + (r.x + x)]!;
      }
    }
    for (const [i, v] of p.guardado) {
      const x = (i % this.largura) - r.x;
      const y = ((i / this.largura) | 0) - r.y;
      antes[y * r.l + x] = v;
    }

    this.historico.push({ r, antes });
    if (this.historico.length > MAX_DESFAZER) this.historico.shift();
  }

  desfaz(): Retangulo | undefined {
    const passo = this.historico.pop();
    if (!passo) return undefined;
    const { r, antes } = passo;
    for (let y = 0; y < r.a; y++) {
      for (let x = 0; x < r.l; x++) {
        this.alfa[(r.y + y) * this.largura + (r.x + x)] = antes[y * r.l + x]!;
      }
    }
    this.remonta(r);
    return r;
  }

  get podeDesfazer(): boolean {
    return this.historico.length > 0;
  }

  get foiRetocado(): boolean {
    return this.historico.length > 0;
  }

  /** Volta à máscara como o modelo entregou. */
  recomeca(): void {
    this.alfa.set(this.alfaOriginal);
    this.historico.length = 0;
    this.remonta({ x: 0, y: 0, l: this.largura, a: this.altura });
  }

  /* ---------- desenho ---------- */

  /** Remonta o RGBA do recorte dentro do retângulo. */
  private remonta(r: Retangulo): void {
    if (r.l <= 0 || r.a <= 0) return;
    const dados = new ImageData(r.l, r.a);
    const d = dados.data;
    for (let y = 0; y < r.a; y++) {
      const linha = (r.y + y) * this.largura + r.x;
      for (let x = 0; x < r.l; x++) {
        const i = linha + x;
        const j = (y * r.l + x) * 4;
        d[j] = this.rgb[i * 3]!;
        d[j + 1] = this.rgb[i * 3 + 1]!;
        d[j + 2] = this.rgb[i * 3 + 2]!;
        d[j + 3] = this.alfa[i]!;
      }
    }
    this.ctxRecorte.putImageData(dados, r.x, r.y);
  }

  /**
   * Desenha o resultado num contexto, no tamanho natural da imagem.
   *
   * O fundo vai primeiro, o recorte por cima. Fundo transparente não desenha nada — quem mostra
   * o xadrez é o CSS, atrás do canvas, e não pixels dentro dele. Se o xadrez fosse desenhado
   * aqui, ele iria junto no arquivo exportado.
   */
  desenha(ctx: CanvasRenderingContext2D, fundo: Fundo): void {
    ctx.clearRect(0, 0, this.largura, this.altura);
    if (fundo.tipo === 'cor') {
      ctx.fillStyle = fundo.cor;
      ctx.fillRect(0, 0, this.largura, this.altura);
    } else if (fundo.tipo === 'imagem') {
      desenhaCobrindo(ctx, fundo.imagem, this.largura, this.altura);
    }
    ctx.drawImage(this.recorte as CanvasImageSource, 0, 0);
  }

  /** Só o recorte, para o lado "depois" da comparação. */
  get canvasDoRecorte(): CanvasImageSource {
    return this.recorte as CanvasImageSource;
  }

  private opaco: OffscreenCanvas | HTMLCanvasElement | undefined;

  /**
   * O primeiro plano OPACO — a foto como entrou, sem recorte nenhum.
   *
   * É o lado "antes" da comparação. Montado sob demanda e guardado: quem nunca abre a comparação
   * não paga por ele, e quem abre não paga duas vezes.
   */
  get primeiroPlano(): CanvasImageSource {
    if (!this.opaco) {
      this.opaco = criaCanvas(this.largura, this.altura);
      const ctx = this.opaco.getContext('2d') as CanvasRenderingContext2D;
      const dados = new ImageData(this.largura, this.altura);
      const d = dados.data;
      for (let i = 0, n = this.largura * this.altura; i < n; i++) {
        d[i * 4] = this.rgb[i * 3]!;
        d[i * 4 + 1] = this.rgb[i * 3 + 1]!;
        d[i * 4 + 2] = this.rgb[i * 3 + 2]!;
        d[i * 4 + 3] = 255;
      }
      ctx.putImageData(dados, 0, 0);
    }
    return this.opaco as CanvasImageSource;
  }

  /* ---------- exportar ---------- */

  /**
   * Gera o arquivo final.
   *
   * `recortar` usa a caixa do assunto que o servidor calculou, mas recalculada sobre o alfa
   * ATUAL — depois do pincel a caixa pode ter mudado, e recortar pela caixa velha cortaria o que
   * acabou de ser restaurado.
   */
  async exporta(fundo: Fundo, tipo: 'image/png' | 'image/jpeg' | 'image/webp', recortar = false): Promise<Blob> {
    const caixa = recortar ? this.caixaDoAssunto() : { x: 0, y: 0, l: this.largura, a: this.altura };
    const saida = criaCanvas(caixa.l, caixa.a);
    const ctx = saida.getContext('2d') as CanvasRenderingContext2D;

    // JPEG não guarda alfa: sem um fundo opaco por baixo, o transparente vira preto. Branco é o
    // palpite menos ruim, e a interface só oferece JPEG quando já há fundo opaco escolhido.
    const efetivo: Fundo = tipo === 'image/jpeg' && fundo.tipo === 'transparente' ? { tipo: 'cor', cor: '#ffffff' } : fundo;

    ctx.save();
    ctx.translate(-caixa.x, -caixa.y);
    this.desenha(ctx, efetivo);
    ctx.restore();

    return paraBlob(saida, tipo);
  }

  /** A caixa do assunto sobre o alfa corrente. */
  caixaDoAssunto(): Retangulo {
    let x0 = this.largura;
    let y0 = this.altura;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < this.altura; y++) {
      const linha = y * this.largura;
      for (let x = 0; x < this.largura; x++) {
        if (this.alfa[linha + x]! > 8) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return { x: 0, y: 0, l: this.largura, a: this.altura };
    return { x: x0, y: y0, l: x1 - x0 + 1, a: y1 - y0 + 1 };
  }
}

/* ==================== utilidades ==================== */

function criaCanvas(l: number, a: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(l, a);
  const c = document.createElement('canvas');
  c.width = l;
  c.height = a;
  return c;
}

async function paraBlob(c: OffscreenCanvas | HTMLCanvasElement, tipo: string): Promise<Blob> {
  if ('convertToBlob' in c) return c.convertToBlob({ type: tipo, quality: 0.92 });
  return new Promise((resolve, rejeita) =>
    (c as HTMLCanvasElement).toBlob(
      (b) => (b ? resolve(b) : rejeita(new Error('O navegador não conseguiu gerar o arquivo.'))),
      tipo,
      0.92,
    ),
  );
}

/** Desenha a imagem cobrindo a área, sem distorcer — o mesmo que `object-fit: cover`. */
function desenhaCobrindo(
  ctx: CanvasRenderingContext2D,
  img: ImageBitmap,
  l: number,
  a: number,
): void {
  const escala = Math.max(l / img.width, a / img.height);
  const el = img.width * escala;
  const ea = img.height * escala;
  ctx.drawImage(img, (l - el) / 2, (a - ea) / 2, el, ea);
}
