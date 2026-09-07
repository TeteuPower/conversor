import { type Capacidades } from '@conversor/nucleo';
interface Props {
    capacidades: Capacidades;
}
/**
 * O que dá para converter hoje.
 *
 * Isto ocupa o espaço embaixo da zona de soltar na tela vazia, e não é enfeite: sem ele, a
 * primeira tela é uma caixa de arrastar sozinha num fundo, e não responde a pergunta que a
 * pessoa traz — "isto serve para o meu arquivo?". O Convertio responde essa pergunta com um
 * "mais de 300 formatos" e uma parede de logotipos de cliente; a resposta honesta é dizer
 * exatamente quais famílias funcionam agora, com os formatos à vista, e admitir o resto.
 *
 * A ordem também é uma escolha: o que funciona vem primeiro, em destaque, e o que está por vir
 * fica numa linha discreta no fim. Uma lista misturada faria a pessoa ter de conferir cada item
 * para saber onde está pisando.
 */
export declare function OQueDaHoje({ capacidades }: Props): import("react").JSX.Element;
export {};
//# sourceMappingURL=OQueDaHoje.d.ts.map