export type Ferramenta = 'converter' | 'comprimir' | 'remover-fundo';
/**
 * Qual ferramenta está aberta, decidido pelo hash da URL.
 *
 * O hash, e não um estado em memória, por três razões concretas:
 *
 * - **O F5 não perde o lugar.** Quem estava comprimindo e recarregou volta comprimindo.
 * - **O botão voltar do navegador funciona**, sem nenhum código nosso para isso.
 * - **Dá para mandar o link.** `#comprimir` abre direto na ferramenta certa.
 *
 * E o principal: nada disso obriga o conversor a saber que existe outra ferramenta. O `App` não
 * recebe nenhuma propriedade nova e não muda uma linha — ele só deixou de ser a raiz.
 */
export declare function usaFerramenta(): Ferramenta;
export declare function Ferramentas(): import("react").JSX.Element;
//# sourceMappingURL=Ferramentas.d.ts.map