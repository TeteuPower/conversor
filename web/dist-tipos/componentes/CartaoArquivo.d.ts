import { type ItemFila } from '../estado/fila.js';
interface Props {
    item: ItemFila;
    agora: number;
    /** Posição na tela, para o escalonamento da entrada. Ver `atrasoDaEntrada`. */
    indiceNaTela: number;
    aoTrocarDestino: () => void;
    aoAbrirOpcoes: () => void;
    aoRemover: () => void;
    aoCancelar: () => void;
    aoTentarDeNovo: () => void;
}
export declare function atrasoDaEntrada(indiceNaTela: number): number;
export declare function CartaoArquivo({ item, agora, indiceNaTela, aoTrocarDestino, aoAbrirOpcoes, aoRemover, aoCancelar, aoTentarDeNovo, }: Props): import("react").JSX.Element;
export {};
//# sourceMappingURL=CartaoArquivo.d.ts.map