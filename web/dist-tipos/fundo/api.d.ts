import { type Etapa, type EstadoDosModelos, type OpcoesFundo, type ResultadoFundo } from '@conversor/nucleo';
export interface Andamento {
    /** 0..1, global, monotônico. */
    fracao: number;
    rotulo: string;
    detalhe?: string | undefined;
    etapas?: readonly Etapa[];
    etapaAtual?: string;
}
export interface PedidoDeRemocao {
    arquivo: File;
    opcoes: OpcoesFundo;
    aoAndar: (a: Andamento) => void;
    aoAvisar: (texto: string) => void;
    /** Chamado quando o modelo precisa ser baixado antes. `fracao` é dos bytes, de verdade. */
    aoBaixarModelo?: (fracao: number, detalhe: string) => void;
    sinal: AbortSignal;
}
export declare class ErroDeRemocao extends Error {
    readonly codigo: string;
    readonly detalhe?: string | undefined;
    constructor(codigo: string, mensagem: string, detalhe?: string | undefined);
}
export interface Recorte {
    /** O PNG RGBA já decodificado, pronto para ir a um canvas. */
    readonly imagem: ImageBitmap;
    readonly resultado: ResultadoFundo;
    readonly nome: string;
    readonly duracaoMs: number;
}
export declare function buscaModelos(): Promise<EstadoDosModelos>;
export declare function apagaModelo(id: string): Promise<void>;
/**
 * Baixa o peso, relatando bytes de verdade.
 *
 * Esta é a barra mais honesta do sistema inteiro: o servidor conhece o `content-length` e conta
 * os bytes que passam. Não há etapa, não há estimativa — é regra de três.
 */
export declare function baixaModelo(id: string, aoAndar: (fracao: number, detalhe: string) => void, sinal: AbortSignal): Promise<void>;
/** Remove o fundo de um arquivo, do começo ao fim. */
export declare function removeFundo(pedido: PedidoDeRemocao): Promise<Recorte>;
export declare function cancela(id: string): Promise<void>;
//# sourceMappingURL=api.d.ts.map