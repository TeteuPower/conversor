import type { ErroConversao, Etapa, Opcoes, Saida } from '@conversor/nucleo';
/**
 * O estado da fila, como redutor.
 *
 * A fila é a única coisa nesta aplicação com estado de verdade — vários arquivos, cada um com seu
 * progresso, seu destino, suas opções e seu resultado, mudando em paralelo. Redutor puro em vez
 * de um punhado de `useState` porque assim a transição fica testável sem montar componente
 * nenhum: os testes em `fila.teste.ts` atravessam um trabalho inteiro chamando só funções.
 *
 * A regra que atravessa o arquivo: **a chegada de um relato atrasado nunca desfaz um estado
 * final**. Um evento de progresso pode chegar depois de o usuário ter cancelado, ou depois de a
 * conversão ter concluído — o worker e o SSE não param no mesmo instante em que a interface muda
 * de tela. Cada ação confere o estado antes de escrever; ver `EstadosFinais`.
 */
export type EstadoItem = 
/** na fila, com destino escolhido, esperando o botão */
'aguardando' | 'enviando' | 'na-fila' | 'convertendo' | 'concluido' | 'falhou' | 'cancelado';
export declare const ehFinal: (e: EstadoItem) => boolean;
export declare const ehAtivo: (e: EstadoItem) => boolean;
export interface ItemFila {
    /** Id local, criado no navegador. O id do servidor é outro e vive dentro da promessa. */
    readonly id: string;
    readonly arquivo: File;
    readonly de: string;
    readonly para: string;
    readonly engine: string;
    readonly opcoes: Opcoes;
    readonly estado: EstadoItem;
    /** 0..1, real. */
    readonly fracao: number;
    readonly rotulo: string;
    readonly detalhe?: string | undefined;
    readonly etapas?: readonly Etapa[] | undefined;
    readonly etapaAtual?: string | undefined;
    readonly avisos: readonly string[];
    readonly saida?: Saida | undefined;
    readonly erro?: ErroConversao | undefined;
    readonly iniciadoEm?: number;
    readonly duracaoMs?: number | undefined;
    /** URL de objeto da pré-visualização da entrada, quando é imagem que o navegador lê. */
    readonly miniatura?: string;
    /** Ordem de entrada, para o escalonamento da animação. */
    readonly indiceDeEntrada: number;
}
export interface EstadoFila {
    readonly itens: readonly ItemFila[];
    /** Quantos arquivos já entraram nesta sessão. Alimenta o escalonamento e o id local. */
    readonly totalJaEntrou: number;
}
export declare const filaVazia: EstadoFila;
export type Acao = {
    tipo: 'acrescenta';
    arquivos: NovoArquivo[];
} | {
    tipo: 'remove';
    id: string;
} | {
    tipo: 'limpa-concluidos';
} | {
    tipo: 'limpa-tudo';
} | {
    tipo: 'escolhe-destino';
    id: string;
    para: string;
    engine: string;
} | {
    tipo: 'ajusta-opcoes';
    id: string;
    opcoes: Opcoes;
} | {
    tipo: 'comeca';
    id: string;
} | {
    tipo: 'anda';
    id: string;
    fracao: number;
    rotulo: string;
    detalhe?: string;
    etapas?: readonly Etapa[];
    etapaAtual?: string;
} | {
    tipo: 'avisa';
    id: string;
    texto: string;
} | {
    tipo: 'conclui';
    id: string;
    saida: Saida;
} | {
    tipo: 'falha';
    id: string;
    erro: ErroConversao;
} | {
    tipo: 'cancela';
    id: string;
} | {
    tipo: 'muda-estado';
    id: string;
    estado: EstadoItem;
    rotulo?: string;
};
export interface NovoArquivo {
    arquivo: File;
    de: string;
    para: string;
    engine: string;
    opcoes?: Opcoes;
    miniatura?: string;
}
export declare function reduz(estado: EstadoFila, acao: Acao): EstadoFila;
/**
 * O progresso do conjunto, para a barra do topo.
 *
 * A média é PONDERADA PELO TAMANHO do arquivo, e não simples. Com uma média simples, converter
 * um ícone de 4 kB junto de uma foto de 8 MB levaria a barra a 50% em meio segundo e depois ela
 * ficaria quase parada — o que descreve mal o que falta. Ponderar pelo tamanho aproxima a barra
 * do trabalho restante de verdade.
 *
 * A aproximação tem limite conhecido: o tamanho do arquivo não é proporcional ao custo da
 * conversão (uma vetorização de 200 kB demora mais que um redimensionamento de 5 MB). É a melhor
 * estimativa disponível antes de começar, e ela erra para o lado de não se adiantar.
 */
export declare function progressoDoConjunto(itens: readonly ItemFila[]): {
    fracao: number;
    ativos: number;
};
export declare const contaPor: (itens: readonly ItemFila[], estado: EstadoItem) => number;
export declare const prontosParaConverter: (itens: readonly ItemFila[]) => readonly ItemFila[];
export declare const concluidos: (itens: readonly ItemFila[]) => readonly ItemFila[];
/**
 * Solta as URLs de objeto de um item.
 *
 * `URL.createObjectURL` mantém o Blob vivo até ser revogado — o coletor de lixo não desfaz isso
 * sozinho. Sem esta chamada, converter cinquenta imagens numa sessão longa deixaria cinquenta
 * SVGs e cinquenta miniaturas presos na memória da aba, e o vazamento só apareceria como "o
 * navegador está lento hoje".
 */
export declare function descarta(item: ItemFila): void;
//# sourceMappingURL=fila.d.ts.map