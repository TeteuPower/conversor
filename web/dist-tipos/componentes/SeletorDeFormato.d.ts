import { type Grafo } from '@conversor/nucleo';
interface Props {
    de: string;
    paraAtual: string;
    grafo: Grafo;
    aoEscolher: (para: string, engine: string) => void;
    aoFechar: () => void;
}
/**
 * O seletor de formato de destino.
 *
 * A forma vem do Convertio — abas por família, grade de formatos — porque essa forma está certa:
 * são dez famílias e mais de cem formatos, e sem o agrupamento a lista é impossível de varrer.
 * Três coisas aqui são diferentes, e cada uma resolve algo que lá incomoda.
 *
 * **1. O destino indisponível aparece, desabilitado, com o motivo.** No Convertio o que não dá
 * simplesmente não está na lista, e quem procura MP3 numa imagem fica procurando. Aqui o botão
 * está lá, em cinza, dizendo "chega no marco 3" ou "precisa do LibreOffice". A informação de que
 * uma conversão NÃO existe é informação, e sonegá-la faz a pessoa duvidar da própria memória.
 *
 * **2. Cada formato traz uma linha do que ele é.** "AVIF" não diz nada a quem não acompanha
 * formato de imagem; "comprime melhor que WebP, codifica mais devagar" diz. É a diferença entre
 * escolher e adivinhar.
 *
 * **3. Tem busca.** Com mais de cem formatos, quem já sabe o que quer digita três letras em vez
 * de caçar a aba certa. O campo recebe o foco na abertura justamente por isso.
 */
export declare function SeletorDeFormato({ de, paraAtual, grafo, aoEscolher, aoFechar }: Props): import("react").JSX.Element;
export {};
//# sourceMappingURL=SeletorDeFormato.d.ts.map