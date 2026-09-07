import { Progresso, type Etapa, type Saida } from '@conversor/nucleo';
import { ErroDeConversao, type RelatorioDeAndamento } from '../api.js';
import type { PedidoAoWorker, RespostaDoWorker } from './vetorizador.worker.js';
import Worker from './vetorizador.worker.ts?worker';

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

export async function vetorizaNoNavegador(pedido: PedidoDeVetorizacao): Promise<Saida> {
  const { arquivo, opcoes, aoAndar, aoAvisar, sinal } = pedido;

  return new Promise<Saida>((resolve, rejeita) => {
    const worker = new Worker();
    let progresso: Progresso | undefined;
    let etapas: readonly Etapa[] | undefined;

    /**
     * Encerrar é `terminate()`, e não uma bandeira que o worker consulte.
     *
     * O laço do vetorizador não tem ponto de espera: ele não volta ao laço de eventos por 950 ms
     * seguidos, então um `if (cancelado)` dentro dele nunca seria lido no meio do bloco.
     * `terminate()` mata a thread na hora, que é o que "cancelar" tem de significar — senão o
     * núcleo do processador segue ocupado com um trabalho que ninguém mais quer.
     */
    const encerra = () => {
      worker.terminate();
      sinal.removeEventListener('abort', aoCancelar);
    };
    const aoCancelar = () => {
      encerra();
      rejeita(new DOMException('cancelado', 'AbortError'));
    };
    if (sinal.aborted) {
      aoCancelar();
      return;
    }
    sinal.addEventListener('abort', aoCancelar, { once: true });

    worker.onmessage = (e: MessageEvent<RespostaDoWorker>) => {
      const msg = e.data;
      switch (msg.tipo) {
        case 'etapas':
          etapas = msg.etapas;
          progresso = new Progresso(msg.etapas);
          aoAndar({ fracao: 0, rotulo: msg.etapas[0]?.rotulo ?? 'Preparando', etapas });
          break;

        case 'progresso': {
          if (!progresso) break;
          const rotulo = etapas?.find((x) => x.id === msg.etapa)?.rotulo ?? 'Vetorizando';
          aoAndar({
            fracao: progresso.em(msg.etapa, msg.dentro),
            rotulo,
            ...(msg.detalhe ? { detalhe: msg.detalhe } : {}),
            ...(etapas ? { etapas } : {}),
            etapaAtual: msg.etapa,
          });
          break;
        }

        case 'aviso':
          aoAvisar(msg.texto);
          break;

        case 'pronto': {
          // Sem `aoAndar` de fracao 1 aqui: quem fecha em 1 e a acao `conclui` do redutor, que
          // grava a fracao e a saida no mesmo commit. Ver o comentario equivalente em api.ts.
          const blob = new Blob([msg.svg], { type: 'image/svg+xml' });
          resolve({
            nome: trocaParaSvg(arquivo.name),
            tamanho: blob.size,
            mime: 'image/svg+xml',
            url: URL.createObjectURL(blob),
            diagnostico: msg.diagnostico,
          });
          encerra();
          break;
        }

        case 'erro':
          rejeita(
            new ErroDeConversao({
              codigo: msg.codigo,
              mensagem: msg.mensagem,
              ...(msg.detalhe ? { detalhe: msg.detalhe } : {}),
            }),
          );
          encerra();
          break;
      }
    };

    worker.onerror = (e) => {
      rejeita(
        new ErroDeConversao({
          codigo: 'worker-caiu',
          mensagem:
            'O vetorizador parou de responder. Recarregue a página; se repetir, o detalhe está ' +
            'no console do navegador.',
          detalhe: e.message,
        }),
      );
      encerra();
    };

    const mensagem: PedidoAoWorker = { arquivo, opcoes };
    worker.postMessage(mensagem);
  });
}

function trocaParaSvg(nome: string): string {
  const ponto = nome.lastIndexOf('.');
  return `${ponto <= 0 ? nome : nome.slice(0, ponto)}.svg`;
}

/**
 * O canário da sonda.
 *
 * Todo navegador que roda esta aplicação decodifica PNG — ele não teria como desenhar a própria
 * interface sem isso. Então, se a amostra de PNG NÃO decodificar, o defeito não está no
 * navegador: está na sonda. E sonda quebrada não merece crédito nenhum.
 *
 * Isto não é precaução teórica, é a correção de um bug que aconteceu aqui. As amostras eram
 * base64 escritas à mão, e as de PNG, JPEG e AVIF estavam malformadas. A sonda concluiu que o
 * Chrome não lia nenhum dos três e removeu do seletor três conversões que funcionavam
 * perfeitamente — em silêncio, sem nada na tela dizendo por que o destino tinha sumido. Quem
 * pegou foi o teste de ponta a ponta, não a interface.
 *
 * As amostras de agora são geradas pelo sharp e conferidas num Chrome de verdade, 1 × 1 pixel
 * cada. O canário fica de todo jeito: é ele que faz a próxima amostra ruim degradar para "aceita
 * tudo" em vez de "recusa tudo". Errar para o lado de oferecer uma conversão que talvez falhe é
 * muito melhor que esconder uma que funciona.
 */
const CANARIO = 'png';

/**
 * As menores imagens válidas de cada formato, uma por linha, em base64. Geradas por
 * `temporario/gera-amostras.mjs` e conferidas com `createImageBitmap` num Chrome real.
 */
const AMOSTRAS: Readonly<Record<string, string>> = {
  png:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==',
  jpg:
    'data:image/jpeg;base64,/9j/2wBDACgcHiMeGSgjISMtKygwPGRBPDc3PHtYXUlkkYCZlo+AjIqgtObDoKrarYqMyP/L2u71////m8H////6/+b9//j/2wBDASstLTw1PHZBQXb4pYyl+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AIoAP//Z',
  webp:
    'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEABUB8JaQAA3AA/vDmwAA=',
  gif:
    'data:image/gif;base64,R0lGODlhAQABAIAAAExpcQAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQFAAAAACwAAAAAAQABAAACAkwBADs=',
  bmp:
    'data:image/bmp;base64,Qk1GAAAAAAAAADYAAAAoAAAAAQAAAAEAAAABABgAAAAAABAAAAATCwAAEwsAAAAAAAAAAAAAAAAAAAAAAA==',
  avif:
    'data:image/avif;base64,AAAAHGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZgAAAYRtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAAA5waXRtAAAAAAABAAAANGlsb2MAAAAAREAAAgACAAAAAAGoAAEAAAAAAAAAEwABAAAAAAG7AAEAAAAAAAAAGAAAADhpaW5mAAAAAAACAAAAFWluZmUCAAAAAAEAAGF2MDEAAAAAFWluZmUCAAAAAAIAAGF2MDEAAAAAw2lwcnAAAACdaXBjbwAAABNjb2xybmNseAABAA0ABoAAAAAMYXYxQ4EAHAAAAAAUaXNwZQAAAAAAAAABAAAAAQAAAA5waXhpAAAAAAEIAAAAOGF1eEMAAAAAdXJuOm1wZWc6bXBlZ0I6Y2ljcDpzeXN0ZW1zOmF1eGlsaWFyeTphbHBoYQAAAAAMYXYxQ4EgAgAAAAAQcGl4aQAAAAADCAgIAAAAHmlwbWEAAAAAAAAAAgABBAGGAwcAAgSCAwSFAAAAGmlyZWYAAAAAAAAADmF1eGwAAgABAAEAAAAzbWRhdBIACgQYAAYVMgkcgKaRAAIhHBgSAAoHOAAGEBDQaTILHIAppppEAACwE3I=',
};

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
export async function sondaDecodificacao(candidatos: readonly string[]): Promise<SuporteDeLeitura> {
  const decodifica = async (ext: string): Promise<boolean> => {
    const amostra = AMOSTRAS[ext];
    // Sem amostra não há como sondar, e aceitar é o certo: o servidor declarou o formato, e
    // recusá-lo por falta de teste esconderia uma conversão que provavelmente funciona.
    if (!amostra) return true;
    try {
      const blob = await (await fetch(amostra)).blob();
      const bitmap = await createImageBitmap(blob);
      bitmap.close();
      return true;
    } catch {
      return false;
    }
  };

  if (!(await decodifica(CANARIO))) {
    console.warn(
      `[conversor] A sonda de decodificação não passou no próprio canário (${CANARIO}): as ` +
        'amostras embutidas devem estar corrompidas. Aceitando todos os formatos declarados pelo ' +
        'servidor, para não esconder conversão que funciona. Ver CANARIO em engines/vetorizador.ts.',
    );
    return { aceitos: [...candidatos], recusados: [] };
  }

  const resultados = await Promise.all(
    candidatos.map(async (ext) => [ext, await decodifica(ext)] as const),
  );
  return {
    aceitos: resultados.filter(([, ok]) => ok).map(([ext]) => ext),
    recusados: resultados.filter(([, ok]) => !ok).map(([ext]) => ext),
  };
}
