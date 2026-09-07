interface Props {
    /** A imagem de entrada, sem tocar. Fica à esquerda. */
    urlOriginal: string;
    /** O resultado da compressão. Fica à direita. `undefined` enquanto a primeira não sai. */
    urlComprimida: string | undefined;
    largura: number;
    altura: number;
    rotuloEsquerda: string;
    rotuloDireita: string;
    /** Acende o indicador de que uma codificação está em andamento. */
    ocupado: boolean;
}
/**
 * A comparação lado a lado.
 *
 * ====================================================================================
 * POR QUE UM DIVISOR, E NÃO DUAS IMAGENS UMA AO LADO DA OUTRA
 * ====================================================================================
 *
 * Duas imagens lado a lado obrigam o olho a saltar entre elas, e cada salto custa a memória
 * exata do que se acabou de ver. Artefato de compressão é justamente o tipo de diferença que não
 * sobrevive a esse salto: um degradê que virou faixas, um contorno que ganhou serrilhado. Com o
 * divisor, o MESMO pedaço da imagem troca de versão no mesmo lugar da tela, e a diferença
 * aparece como movimento — que é o que o olho detecta bem.
 *
 * ====================================================================================
 * O QUE AQUI NÃO TEM TRANSIÇÃO, DE PROPÓSITO
 * ====================================================================================
 *
 * O resto da aplicação se move devagar, e isso é uma escolha. O divisor é a exceção: ele
 * acompanha o ponteiro em 1:1, sem transição nenhuma. Uma transição de 300 ms aqui faria a linha
 * chegar depois do dedo, e a sensação não seria de calma — seria de travamento.
 *
 * A calma deste componente está em outro lugar: na TROCA da imagem comprimida. Quando uma
 * codificação nova fica pronta, ela não substitui a anterior de imediato — ela é decodificada
 * primeiro, fora de tela, e só então aparece, em transição. Sem isso, cada passo do controle de
 * qualidade daria um piscar branco no meio da comparação.
 */
export declare function Comparador({ urlOriginal, urlComprimida, largura, altura, rotuloEsquerda, rotuloDireita, ocupado, }: Props): import("react").JSX.Element;
export {};
//# sourceMappingURL=Comparador.d.ts.map