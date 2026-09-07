interface Props {
    aoReceber: (arquivos: File[]) => void;
    /** Extensões aceitas, para o filtro do seletor de arquivo do sistema. */
    aceita: readonly string[];
    tamanhoMaximo: number;
    /** Compacta, para quando a fila já tem itens. */
    enxuta?: boolean;
}
/**
 * A zona de soltar.
 *
 * Duas coisas aqui são menos óbvias do que parecem.
 *
 * **1. O contador de entradas e saídas de arrasto.** `dragleave` dispara ao passar o ponteiro
 * sobre qualquer elemento FILHO da zona, não só ao sair dela. A implementação ingênua — ligar
 * no `dragenter` e desligar no `dragleave` — faz o realce piscar enquanto o usuário move o
 * arquivo por cima. Contar entradas e saídas e só desligar no zero resolve, e é o motivo de
 * `profundidade` ser um `useRef` em vez de estado: ele muda várias vezes por segundo durante o
 * arrasto e não deve provocar repintura.
 *
 * **2. A janela inteira é alvo.** O `document` também escuta, então soltar em qualquer lugar da
 * página funciona. Sem isso, soltar dois pixels fora da caixa faz o NAVEGADOR abrir o arquivo,
 * trocando a página do usuário pela imagem dele — perdendo a fila inteira. É a pior falha
 * possível aqui, e ela acontece por omissão.
 */
export declare function ZonaDeSoltar({ aoReceber, aceita, tamanhoMaximo, enxuta }: Props): import("react").JSX.Element;
export {};
//# sourceMappingURL=ZonaDeSoltar.d.ts.map