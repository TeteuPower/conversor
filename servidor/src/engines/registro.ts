import type { Aresta, Etapa, MotivoAusencia, Opcoes } from '@conversor/nucleo';

/**
 * O contrato de uma engine do servidor.
 *
 * Uma engine nova é um arquivo neste diretório e uma linha em `todas.ts`. Ela precisa saber
 * responder três coisas, nesta ordem:
 *
 * 1. `detecta()` — estou disponível nesta máquina? Isto roda uma vez ao subir o servidor, e o
 *    resultado alimenta o grafo. Uma engine ausente não é erro: é uma informação que a interface
 *    mostra ao usuário, com o comando de instalação.
 * 2. `arestas()` — dado o que a detecção achou, quais pares origem→destino eu faço? Repare que a
 *    detecção entra aqui: não basta o ffmpeg existir, ele precisa ter sido compilado com o codec.
 * 3. `converte()` — faça, e relate o progresso enquanto faz.
 */
export interface Engine {
  readonly id: string;
  readonly nome: string;
  /** Uma linha sobre o que esta engine faz e por que é ela a escolhida para isso. */
  readonly descricao: string;

  detecta(): Promise<Deteccao>;

  /**
   * As arestas desta engine. Recebe a detecção porque a resposta depende dela: uma engine
   * presente mas sem determinado suporte compilado devolve a aresta com `disponivel: false` e o
   * motivo, em vez de omiti-la.
   */
  arestas(deteccao: Deteccao): readonly Aresta[];

  converte(tarefa: Tarefa, relata: Relator): Promise<ResultadoEngine>;
}

export type Deteccao =
  | { disponivel: true; versao?: string; detalhe?: Record<string, unknown> }
  | { disponivel: false; ausencia: MotivoAusencia };

export interface Tarefa {
  readonly id: string;
  /** Caminho no disco do arquivo de entrada, já gravado. */
  readonly entrada: string;
  /** Caminho onde a engine deve gravar a saída. Ela não escolhe: quem gerencia o disco escolhe. */
  readonly saida: string;
  readonly de: string;
  readonly para: string;
  readonly opcoes: Opcoes;
  readonly nomeOriginal: string;
  /**
   * O nome que a saída teria pelo destino escolhido — já com a extensão trocada e higienizado.
   *
   * A engine usa isto como base quando precisa batizar VÁRIOS arquivos (uma imagem por página de
   * PDF, dentro de um pacote). Partir de `nomeOriginal` faria os nomes de dentro do pacote
   * herdarem a extensão da ENTRADA.
   */
  readonly nomeSaida: string;
  /**
   * Disparado quando o trabalho é cancelado. Toda engine que chama processo externo ou faz laço
   * longo tem obrigação de escutar: sem isso, cancelar na interface não para o trabalho, só
   * esconde ele — e a máquina segue queimando CPU pelo que ninguém mais quer.
   */
  readonly sinal: AbortSignal;
}

/**
 * Como a engine relata o que está fazendo.
 *
 * `etapas` é chamado uma vez, no começo, declarando o plano. Depois, `andou` diz apenas quanto
 * andou dentro da etapa corrente — a fração global é calculada fora, pelo `Progresso` do núcleo,
 * e é lá que ficam as garantias de monotonia.
 */
export interface Relator {
  etapas(etapas: readonly Etapa[]): void;
  andou(etapa: string, dentro?: number, detalhe?: string): void;
  avisa(texto: string): void;
}

export interface ResultadoEngine {
  /** O que a engine tem a dizer sobre esta conversão. Vai para a interface. */
  readonly diagnostico?: Record<string, unknown>;
  /**
   * Nome e tipo da saída, quando a engine entrega algo diferente do que o destino sugere.
   *
   * O caso que forçou isto: rasterizar um PDF de dez páginas para PNG não pode devolver um PNG —
   * dez páginas não cabem numa imagem. A saída é um `.zip` com uma imagem por página. Sem estes
   * campos, o download sairia batizado `documento.png` com um ZIP dentro, e o sistema
   * operacional tentaria abrir como imagem.
   *
   * Quem não precisa disso simplesmente não devolve, e o nome sai do destino escolhido.
   */
  readonly nomeSaida?: string;
  readonly mimeSaida?: string;
}

/**
 * Erro que a engine lança quando a culpa é do arquivo ou da opção, e não do código.
 *
 * A distinção importa para a mensagem: erro de entrada é traduzido para o usuário como algo que
 * ele pode resolver; qualquer outra exceção é bug nosso e vira uma mensagem genérica com o
 * detalhe técnico guardado à parte.
 */
export class ErroDeEntrada extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
    readonly detalhe?: string,
  ) {
    super(mensagem);
    this.name = 'ErroDeEntrada';
  }
}
