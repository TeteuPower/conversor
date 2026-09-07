import { type Capacidades, type ErroConversao, type Etapa, type Opcoes, type Saida } from '@conversor/nucleo';
export declare function buscaCapacidades(): Promise<Capacidades>;
export declare class ErroDeRede extends Error {
    constructor(mensagem: string);
}
export interface RelatorioDeAndamento {
    /** 0..1, global, monotônico. */
    fracao: number;
    /** O que está acontecendo, em texto pronto para a tela. */
    rotulo: string;
    detalhe?: string | undefined;
    /** As etapas declaradas pela engine, quando já chegaram. */
    etapas?: readonly Etapa[];
    etapaAtual?: string;
}
export interface PedidoDeConversao {
    arquivo: File;
    de: string;
    para: string;
    opcoes: Opcoes;
    aoAndar: (r: RelatorioDeAndamento) => void;
    aoAvisar: (texto: string) => void;
    sinal: AbortSignal;
}
export declare class ErroDeConversao extends Error {
    readonly erro: ErroConversao;
    constructor(erro: ErroConversao);
}
/**
 * Converte um arquivo no servidor, do começo ao fim.
 *
 * A fração global é composta aqui, e não no servidor, porque só o navegador sabe as duas metades:
 * o servidor não tem como saber quantos bytes já subiram, e o navegador não tem como saber em que
 * etapa a engine está. Cada lado relata o que vê, e a soma ponderada acontece neste arquivo.
 */
export declare function converteNoServidor(pedido: PedidoDeConversao): Promise<Saida>;
export declare function cancelaNoServidor(id: string): Promise<void>;
//# sourceMappingURL=api.d.ts.map