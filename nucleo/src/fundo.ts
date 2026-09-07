/**
 * O contrato da ferramenta de remover fundo.
 *
 * Fica num arquivo próprio, e não em `tipos.ts`, porque remover fundo NÃO é uma conversão de
 * formato: a origem e o destino podem ser o mesmo PNG. O que muda é o conteúdo, não o
 * invólucro. Enfiar isso no grafo de conversões exigiria uma aresta `png → png`, que o grafo
 * descarta de propósito, e faria o seletor de formato oferecer "remover fundo" como se fosse um
 * destino. São duas ferramentas na mesma casa, com a mesma fila e a mesma barra de progresso.
 *
 * ---
 *
 * A divisão de trabalho entre servidor e navegador, que é a decisão que organiza o resto:
 *
 * O servidor roda o modelo UMA vez e devolve duas imagens: o primeiro plano opaco, já com a cor
 * da borda descontaminada, e a máscara em tons de cinza. Daí para a frente é tudo no navegador:
 * trocar o fundo, passar o pincel, exportar. Nada disso volta ao servidor.
 *
 * O motivo é o pincel. Se cada pincelada tivesse de subir, o servidor recompor e a imagem
 * descer, cada toque custaria uma ida e volta e o pincel deixaria de parecer um pincel. Com as
 * duas imagens na mão, o navegador pinta na máscara e recompõe no mesmo quadro — que é a
 * sensação que faz o Pincel Mágico do remove.bg funcionar.
 *
 * Serem DUAS imagens, e não um RGBA só, também é por causa do pincel; o motivo está na etapa de
 * gravação de `servidor/src/fundo/pipeline.ts`.
 */

/* ==================== modelos ==================== */

export type ProvedorExecucao = 'dml' | 'cuda' | 'cpu' | 'webgpu';

export interface ModeloFundo {
  readonly id: string;
  readonly nome: string;
  /** Uma linha sobre o que este modelo acerta e o que ele erra. */
  readonly descricao: string;
  readonly bytes: number;
  /** Licença do peso, não do código. Importa para uso comercial. */
  readonly licenca: string;
  readonly origem: string;
  /** Lado do quadrado que o modelo recebe. BiRefNet usa 1024. */
  readonly entrada: number;
  readonly baixado: boolean;
  /** Preenchido quando o modelo já rodou pelo menos uma vez nesta máquina. */
  readonly medido?: {
    readonly provedor: ProvedorExecucao;
    readonly ms: number;
  };
}

export interface EstadoDosModelos {
  readonly modelos: readonly ModeloFundo[];
  /** O que será usado se o pedido não escolher. */
  readonly padrao: string;
  /** Provedores que esta máquina de fato aceitou, na ordem de preferência. */
  readonly provedores: readonly ProvedorExecucao[];
}

/* ==================== o pedido ==================== */

export interface OpcoesFundo {
  /** `id` de um `ModeloFundo`. Ausente usa o padrão. */
  modelo?: string;
  /**
   * Tirar do pixel semitransparente a cor do fundo antigo. Ligado por padrão.
   *
   * É o que separa recorte bom de recorte amador, e não vem do modelo: é conta nossa, feita
   * depois. Ver `refino.ts` no servidor.
   */
  descontaminar?: boolean;
  /**
   * Quanto encolher a máscara antes de compor, em pixels. Zero por padrão.
   *
   * Serve para o caso em que sobra uma orla clara do fundo antigo em volta do objeto. Encolher
   * come um fio do objeto, então não é ligado sozinho.
   */
  encolher?: number;
  /** Suavizar a borda da máscara, em pixels de raio. Zero por padrão. */
  suavizar?: number;
}

/* ==================== o resultado ==================== */

export interface ResultadoFundo {
  /**
   * PNG OPACO com o primeiro plano descontaminado — a foto inteira, sem alfa.
   *
   * Vem separado da máscara por causa do pincel: canvas guarda pixel pré-multiplicado, e num
   * RGBA único a cor sob alfa zero se perderia, fazendo o pincel de restaurar revelar preto.
   * Ver a etapa de gravação em `servidor/src/fundo/pipeline.ts`.
   */
  readonly recorteUrl: string;
  /** PNG em tons de cinza com o alfa. É isto que o pincel edita. */
  readonly mascaraUrl: string;
  readonly largura: number;
  readonly altura: number;
  /** Em que resolução o modelo trabalhou, antes de a máscara voltar ao tamanho original. */
  readonly resolucaoDoModelo: number;
  readonly modelo: string;
  readonly provedor: ProvedorExecucao;
  readonly msModelo: number;
  /**
   * Retângulo do assunto dentro da imagem, em pixels: `[x, y, largura, altura]`.
   *
   * O navegador usa para o recorte automático e para enquadrar a prévia. Vem do servidor porque
   * é onde a máscara existe inteira; refazer isso no navegador seria varrer os pixels de novo.
   */
  readonly caixa: readonly [number, number, number, number];
  /**
   * Fração de pixels com alfa entre 0,05 e 0,95 — quanto do recorte é borda macia.
   *
   * A interface usa para saber quando vale avisar que o pincel ajuda: um recorte quase todo
   * binário em imagem de cabelo é sinal de que o modelo não pegou os fios.
   */
  readonly fracaoDeBorda: number;
}

/* ==================== progresso ==================== */

/**
 * As etapas da remoção, com o peso de cada uma.
 *
 * Diferente da conversão de imagem, aqui a etapa cara é conhecida e domina tudo: a inferência.
 * Medido numa foto de 960 × 960, com o BiRefNet na GPU: 2 040 ms de modelo contra cerca de 330 ms
 * de todo o resto somado. Daí o peso 20 da etapa `modelo` — com pesos iguais a barra correria
 * até 33% e ficaria parada os dois segundos que importam.
 */
export const ETAPAS_FUNDO = [
  { id: 'ler', rotulo: 'Lendo a imagem', peso: 1 },
  { id: 'preparar', rotulo: 'Preparando para o modelo', peso: 1 },
  { id: 'modelo', rotulo: 'Encontrando o assunto', peso: 20 },
  { id: 'mascara', rotulo: 'Refinando a borda', peso: 3 },
  { id: 'descontaminar', rotulo: 'Limpando a cor da borda', peso: 2 },
  { id: 'gravar', rotulo: 'Gravando', peso: 2 },
] as const;

/** O download do modelo tem barra própria, porque acontece antes e uma vez só. */
export const ETAPAS_DOWNLOAD = [{ id: 'baixar', rotulo: 'Baixando o modelo', peso: 1 }] as const;
