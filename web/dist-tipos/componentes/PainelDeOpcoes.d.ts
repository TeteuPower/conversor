import { type Opcoes } from '@conversor/nucleo';
interface Props {
    de: string;
    para: string;
    engine: string;
    opcoes: Opcoes;
    aoAplicar: (o: Opcoes) => void;
    aoFechar: () => void;
}
/**
 * As opções de uma conversão.
 *
 * O painel mostra só o que muda ALGUMA COISA nesta conversão específica. Qualidade não aparece
 * indo para PNG, porque PNG não tem perda e o controle não teria efeito; paleta indexada só
 * aparece indo para PNG; as opções do vetorizador só aparecem quando a engine é o vetorizador.
 * Mostrar um controle inerte é pior que esconder: ele convida a mexer e não faz nada, e o usuário
 * conclui que a aplicação ignorou o que ele pediu.
 *
 * Cada opção com custo mensurado diz o custo. "~14x mais lento" ao lado da paleta indexada é a
 * informação de que a pessoa precisa para decidir, e ela não tem como descobrir sozinha.
 */
export declare function PainelDeOpcoes({ de, para, engine, opcoes, aoAplicar, aoFechar }: Props): import("react").JSX.Element;
export {};
//# sourceMappingURL=PainelDeOpcoes.d.ts.map