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
export type Fundo = {
    tipo: 'transparente';
} | {
    tipo: 'cor';
    cor: string;
} | {
    tipo: 'imagem';
    imagem: ImageBitmap;
};
export interface Retangulo {
    x: number;
    y: number;
    l: number;
    a: number;
}
export declare class Editor {
    readonly largura: number;
    readonly altura: number;
    /** O alfa corrente, um byte por pixel. É o que o pincel edita. */
    private readonly alfa;
    /** O alfa como veio do modelo, para o botão de recomeçar. */
    private readonly alfaOriginal;
    /** RGB do primeiro plano, entrelaçado. Nunca muda. */
    private readonly rgb;
    /** O recorte montado (RGBA), pronto para ser desenhado sobre qualquer fundo. */
    private readonly recorte;
    private readonly ctxRecorte;
    private readonly historico;
    private constructor();
    /**
     * Monta o editor a partir das duas imagens do servidor.
     *
     * Os pixels são lidos UMA vez, aqui, e daí em diante vivem em arrays comuns. Ler do canvas a
     * cada operação seria mais simples e bem mais lento: `getImageData` sincroniza com a GPU.
     */
    static de(frente: ImageBitmap, mascara: ImageBitmap): Promise<Editor>;
    /** Começa uma pincelada. Tudo até `terminaTraco` vira um passo só de desfazer. */
    comecaTraco(): void;
    private pendente;
    /**
     * Pinta um disco macio em (cx, cy).
     *
     * `dureza` de 0 a 1: 0 é borda bem esfumada, 1 é quase um carimbo. O padrão da interface é
     * baixo, porque num recorte a borda dura denuncia o retoque — e é justamente a borda que se
     * está tentando consertar.
     *
     * Devolve o retângulo que sujou, para quem desenha saber o que redesenhar.
     */
    pinta(cx: number, cy: number, raio: number, modo: ModoPincel, dureza?: number, fluxo?: number): Retangulo;
    /** Guarda o valor anterior do pixel, uma vez por pincelada. */
    private guarda;
    /** Fecha a pincelada e a empurra para o histórico. */
    terminaTraco(): void;
    desfaz(): Retangulo | undefined;
    get podeDesfazer(): boolean;
    get foiRetocado(): boolean;
    /** Volta à máscara como o modelo entregou. */
    recomeca(): void;
    /** Remonta o RGBA do recorte dentro do retângulo. */
    private remonta;
    /**
     * Desenha o resultado num contexto, no tamanho natural da imagem.
     *
     * O fundo vai primeiro, o recorte por cima. Fundo transparente não desenha nada — quem mostra
     * o xadrez é o CSS, atrás do canvas, e não pixels dentro dele. Se o xadrez fosse desenhado
     * aqui, ele iria junto no arquivo exportado.
     */
    desenha(ctx: CanvasRenderingContext2D, fundo: Fundo): void;
    /** Só o recorte, para o lado "depois" da comparação. */
    get canvasDoRecorte(): CanvasImageSource;
    private opaco;
    /**
     * O primeiro plano OPACO — a foto como entrou, sem recorte nenhum.
     *
     * É o lado "antes" da comparação. Montado sob demanda e guardado: quem nunca abre a comparação
     * não paga por ele, e quem abre não paga duas vezes.
     */
    get primeiroPlano(): CanvasImageSource;
    /**
     * Gera o arquivo final.
     *
     * `recortar` usa a caixa do assunto que o servidor calculou, mas recalculada sobre o alfa
     * ATUAL — depois do pincel a caixa pode ter mudado, e recortar pela caixa velha cortaria o que
     * acabou de ser restaurado.
     */
    exporta(fundo: Fundo, tipo: 'image/png' | 'image/jpeg' | 'image/webp', recortar?: boolean): Promise<Blob>;
    /** A caixa do assunto sobre o alfa corrente. */
    caixaDoAssunto(): Retangulo;
}
//# sourceMappingURL=editor.d.ts.map