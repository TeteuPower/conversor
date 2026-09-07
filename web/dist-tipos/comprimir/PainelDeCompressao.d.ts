import { type Ajuste, type FormatoSaida } from './codec.js';
interface Props {
    ajuste: Ajuste;
    aoAjustar: (a: Ajuste) => void;
    /** Formatos que este navegador confirmou codificar, pela sonda do worker. */
    suportados: readonly FormatoSaida[];
    larguraOriginal: number;
    alturaOriginal: number;
    tamanhoOriginal: number;
    /** Tamanho do resultado corrente. `undefined` até a primeira codificação sair. */
    tamanhoComprimido: number | undefined;
    ocupado: boolean;
    aoBaixar: () => void;
    aoTrocarImagem: () => void;
}
export declare function PainelDeCompressao({ ajuste, aoAjustar, suportados, larguraOriginal, alturaOriginal, tamanhoOriginal, tamanhoComprimido, ocupado, aoBaixar, aoTrocarImagem, }: Props): import("react").JSX.Element;
export {};
//# sourceMappingURL=PainelDeCompressao.d.ts.map