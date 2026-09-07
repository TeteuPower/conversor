import { type Saida } from '@conversor/nucleo';
import { type RelatorioDeAndamento } from '../api.js';
import type { PedidoAoWorker } from './vetorizador.worker.js';
/**
 * O vetorizador visto de fora: a mesma assinatura da conversão de servidor, mas nada sai da
 * página.
 *
 * O resultado não passa por `/api`: ele já está aqui, como texto, e é embrulhado num `Blob` cuja
 * URL a interface entrega ao botão de baixar. Isso tem uma consequência boa e uma obrigação.
 * A boa: baixar é instantâneo, sem ida e volta. A obrigação: `URL.createObjectURL` retém o Blob
 * em memória até alguém revogar, e a interface tem de revogar quando o cartão sai da fila — ver
 * `descarta` em `estado/fila.ts`.
 */
export interface PedidoDeVetorizacao {
    arquivo: File;
    opcoes: PedidoAoWorker['opcoes'];
    aoAndar: (r: RelatorioDeAndamento) => void;
    aoAvisar: (texto: string) => void;
    sinal: AbortSignal;
}
export declare function vetorizaNoNavegador(pedido: PedidoDeVetorizacao): Promise<Saida>;
export interface SuporteDeLeitura {
    readonly aceitos: readonly string[];
    readonly recusados: readonly string[];
}
/**
 * Confirma, decodificando de verdade, o que ESTE navegador consegue ler.
 *
 * O servidor manda a lista de entradas do vetorizador com otimismo — ele não tem como saber em
 * que navegador a página abriu. Esta sonda derruba o que não passar.
 *
 * Ela existe por causa do AVIF, cujo suporte muda por versão de navegador e por plataforma; a
 * distância entre "declara suportar" e "decodifica este arquivo" já apareceu nele mais de uma
 * vez. Sondar custa poucos milissegundos na abertura, e é bem mais barato que um destino que
 * falha depois de o usuário escolher e esperar.
 */
export declare function sondaDecodificacao(candidatos: readonly string[]): Promise<SuporteDeLeitura>;
//# sourceMappingURL=vetorizador.d.ts.map