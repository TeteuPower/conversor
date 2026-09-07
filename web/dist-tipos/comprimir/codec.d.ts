import type { FormatoSaida, PedidoAoWorker, RespostaDoWorker } from './protocolo.js';
export type { FormatoSaida };
export { MIME } from './protocolo.js';
/** O que o usuário escolheu. Cada mudança disto pede uma recodificação. */
export interface Ajuste {
    readonly formato: FormatoSaida;
    /** 1..100. PNG ignora: não tem perda. */
    readonly qualidade: number;
    /** Largura de saída. Ausente quer dizer o tamanho original. */
    readonly largura?: number;
}
export interface Resultado {
    readonly ajuste: Ajuste;
    readonly blob: Blob;
    /** URL de objeto viva. Quem recebe é dono de revogar — ver `Compressor.descarta`. */
    readonly url: string;
    readonly tamanho: number;
    readonly largura: number;
    readonly altura: number;
    readonly ms: number;
}
/** O canal até o codificador. Existe como interface para o teste poder substituí-lo. */
export interface Canal {
    postMessage(p: PedidoAoWorker, transferir?: Transferable[]): void;
    addEventListener(tipo: 'message', ouvinte: (e: MessageEvent<RespostaDoWorker>) => void): void;
    terminate(): void;
}
export interface Ouvintes {
    aoResultado(r: Resultado): void;
    aoErro(mensagem: string): void;
    /** Muda quando começa e quando para de codificar. É o que acende o indicador de trabalho. */
    aoOcupado(ocupado: boolean): void;
}
/**
 * O compressor visto pela interface.
 *
 * ====================================================================================
 * A POLÍTICA DE FILA, QUE É O CORAÇÃO DA SENSAÇÃO DE "AO VIVO"
 * ====================================================================================
 *
 * Arrastar o controle de qualidade dispara dezenas de eventos por segundo. Cada codificação
 * custa entre 10 ms (JPEG) e 125 ms (WebP em 1600 × 1200), medidos. As três saídas óbvias são
 * todas ruins:
 *
 * - **Mandar tudo.** Vira uma fila de trinta pedidos, e o preview passa a mostrar posições que o
 *   controle já deixou para trás. O atraso CRESCE enquanto se arrasta — quanto mais o usuário
 *   mexe, mais a imagem fica velha.
 * - **Esperar soltar.** Não é ao vivo. É o comportamento que o Squoosh não tem, e é justamente o
 *   que faz a ferramenta valer.
 * - **Debounce fixo.** Escolhe um número que está errado nas duas pontas: alto demais para JPEG,
 *   que responderia em 10 ms, e baixo demais para PNG grande, onde ainda assim empilha.
 *
 * O que este arquivo faz é **um em voo, o último esperando**. Há no máximo uma codificação
 * rodando; enquanto ela roda, os pedidos que chegam substituem uns aos outros numa vaga só. Ao
 * terminar, o que estiver na vaga entra.
 *
 * O efeito é uma cadência que se ajusta sozinha à máquina e ao formato: em JPEG o preview
 * praticamente cola no controle; em PNG grande ele atualiza mais espaçado, mas SEMPRE mostrando
 * o destino mais recente, nunca um do meio do caminho. Sem número mágico nenhum para calibrar.
 */
export declare class Compressor {
    private readonly canal;
    private readonly ouvintes;
    private proximoId;
    private emVoo;
    private pendente;
    private carregando;
    private ultimaUrl;
    private morto;
    /** O ajuste de cada pedido em voo, para o resultado voltar sabendo a que pergunta responde. */
    private readonly emVooAjuste;
    /** Formatos que este navegador confirmou codificar. Vazio até a sonda responder. */
    suportados: FormatoSaida[];
    constructor(canal: Canal, ouvintes: Ouvintes);
    /** Decodifica o arquivo uma vez. O bitmap fica no worker para todas as codificações seguintes. */
    carrega(arquivo: Blob): Promise<Dimensao>;
    sonda(): void;
    /** Pede uma codificação. Ver a política de fila no cabeçalho da classe. */
    pede(ajuste: Ajuste): void;
    /**
     * Revoga a URL de objeto do último resultado.
     *
     * Sem isto, cada passo do controle deslizante deixaria um Blob preso na memória da aba até o
     * F5 — e um arrasto do controle de ponta a ponta cria dezenas deles, de megabytes cada.
     */
    descarta(): void;
    encerra(): void;
    private despacha;
    private recebe;
}
export interface Dimensao {
    readonly largura: number;
    readonly altura: number;
}
/**
 * A qualidade inicial de cada formato.
 *
 * 75 para WebP e JPEG pelo motivo de sempre: é onde o artefato deixa de ser visível em tela sem
 * que o arquivo cresça pelo detalhe que ninguém enxerga. O conversor usa 82 como padrão, e aqui
 * é 75 de propósito — lá o usuário não vê o resultado antes de baixar, e o padrão tem de errar
 * para o lado seguro; aqui ele está OLHANDO a comparação e pode descer até onde quiser.
 */
export declare const QUALIDADE_INICIAL: Readonly<Record<FormatoSaida, number>>;
/** PNG não tem perda: o controle de qualidade não teria o que ajustar e sai de cena. */
export declare function temQualidade(f: FormatoSaida): boolean;
export declare const NOME_FORMATO: Readonly<Record<FormatoSaida, string>>;
export declare const SOBRE_FORMATO: Readonly<Record<FormatoSaida, string>>;
//# sourceMappingURL=codec.d.ts.map