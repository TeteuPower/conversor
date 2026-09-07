/**
 * A ferramenta de compressão.
 *
 * ====================================================================================
 * POR QUE ELA É SEPARADA DO CONVERSOR
 * ====================================================================================
 *
 * O conversor e esta ferramenta parecem a mesma coisa — as duas transformam imagem — e são
 * duas tarefas diferentes, com dois ritmos diferentes.
 *
 * No conversor, o usuário SABE o que quer: solta trinta arquivos, escolhe o destino, aperta e
 * vai fazer outra coisa. O trabalho é em lote, a interface é uma fila, e o que ela precisa
 * provar é que está progredindo.
 *
 * Aqui ele NÃO sabe o que quer, e está descobrindo. Ele mexe na qualidade, olha, volta, compara,
 * decide. É um arquivo só, o ciclo é de segundos, e o que a interface precisa provar é que o
 * número na tela corresponde ao arquivo que vai sair. Uma fila atrapalharia; um lote não faria
 * sentido.
 *
 * ====================================================================================
 * NADA SAI DA MÁQUINA — NEM PARA O LOCALHOST
 * ====================================================================================
 *
 * Toda a compressão acontece na página, pelo codificador do próprio navegador. O servidor não é
 * consultado uma vez sequer. Isso não é só uma promessa de privacidade: é o que torna o preview
 * ao vivo possível, porque não há ida e volta pela rede entre mexer no controle e ver o
 * resultado.
 */
export declare function Comprimir(): import("react").JSX.Element;
//# sourceMappingURL=Comprimir.d.ts.map