export interface PedidoAoWorker {
    readonly arquivo: Blob;
    readonly opcoes: {
        tol?: number;
        grausMin?: number;
        casas?: number;
        maxCores?: number;
        forcarFoto?: boolean;
    };
}
export type RespostaDoWorker = {
    tipo: 'etapas';
    etapas: {
        id: string;
        rotulo: string;
        peso: number;
    }[];
} | {
    tipo: 'progresso';
    etapa: string;
    dentro: number;
    detalhe?: string;
} | {
    tipo: 'aviso';
    texto: string;
} | {
    tipo: 'pronto';
    svg: string;
    diagnostico: Record<string, unknown>;
} | {
    tipo: 'erro';
    codigo: string;
    mensagem: string;
    detalhe?: string;
};
//# sourceMappingURL=vetorizador.worker.d.ts.map