import type { EstadoItem } from '../estado/fila.js';
interface Props {
    /** 0..1. Sempre o valor real; ver o cabeçalho de `movimento.css`. */
    fracao: number;
    estado: EstadoItem;
    /** Quando dado, mostra a estimativa de tempo restante. */
    iniciadoEm?: number;
    agora?: number;
    rotulo?: string;
    detalhe?: string | undefined;
    /** Compacta: só a barra, sem a linha de texto. Para a barra do conjunto. */
    enxuta?: boolean;
    rotuloAcessivel?: string;
}
/**
 * A barra de progresso.
 *
 * O valor que entra aqui é real e monotônico — garantido pelo `Progresso` do núcleo antes de
 * chegar. Este componente não interpola, não estima e não anda sozinho: ele escreve a fração num
 * custom property e deixa o CSS deslizar até lá. Toda a suavização é a transição de 760 ms
 * declarada em `movimento.css`, e ela atrasa a barra em relação à verdade, nunca a adianta.
 *
 * `role="progressbar"` com os três `aria-value*` porque a barra também tem de existir para quem
 * não a vê. O `aria-valuetext` leva o rótulo da etapa junto: "43%" sozinho informa muito menos
 * que "43%, codificando AVIF".
 */
export declare function BarraDeProgresso({ fracao, estado, iniciadoEm, agora, rotulo, detalhe, enxuta, rotuloAcessivel, }: Props): import("react").JSX.Element;
export {};
//# sourceMappingURL=BarraDeProgresso.d.ts.map