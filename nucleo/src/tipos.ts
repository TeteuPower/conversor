/**
 * O contrato entre o navegador e o servidor. Este arquivo é a única fonte de verdade dos dois
 * lados: o servidor compila contra ele, a interface compila contra ele, e uma divergência de
 * nome de campo passa a ser erro de compilação em vez de bug descoberto em uso.
 */

/** As dez famílias de formato. São as abas do seletor, na ordem em que aparecem. */
export const FAMILIAS = [
  'imagem',
  'vetor',
  'documento',
  'apresentacao',
  'ebook',
  'audio',
  'video',
  'arquivo',
  'fonte',
  'cad',
] as const;

export type Familia = (typeof FAMILIAS)[number];

export interface Formato {
  /** Extensão canônica, minúscula, sem ponto. É a chave do formato em todo o sistema. */
  readonly ext: string;
  /** Como o formato se escreve para gente ler: PNG, JPEG, WebP. */
  readonly nome: string;
  readonly familia: Familia;
  readonly mime: string;
  /** Uma linha dizendo para que este formato serve. Vira a legenda no seletor. */
  readonly descricao: string;
  /** Outras extensões que significam este mesmo formato (jpeg aponta para jpg). */
  readonly apelidos?: readonly string[];
  /** Formato com perda: a interface avisa antes de destruir informação. */
  readonly comPerda?: boolean;
  /** Guarda transparência. */
  readonly temAlfa?: boolean;
  /** Guarda animação. */
  readonly animado?: boolean;
}

/* ==================== engines ==================== */

/**
 * Onde a conversão acontece de fato.
 *
 * `navegador` não é enfeite: o vetorizador roda no navegador porque assim o arquivo não
 * atravessa nem o localhost, e porque o resultado aparece sem ida e volta pela rede.
 * `servidor` é para o que precisa de biblioteca nativa.
 */
export type Onde = 'navegador' | 'servidor';

/** Por que uma engine não está disponível. A interface mostra isto em vez de só esconder. */
export type MotivoAusencia =
  | { tipo: 'nao-instalada'; comoInstalar: string }
  | { tipo: 'versao-antiga'; encontrada: string; minima: string }
  | { tipo: 'sem-suporte'; detalhe: string }
  | { tipo: 'nao-implementada'; marco: string };

export interface EngineDescrita {
  readonly id: string;
  readonly nome: string;
  readonly onde: Onde;
  /** Uma linha sobre o que esta engine faz e por que é ela a escolhida para isso. */
  readonly descricao: string;
  readonly disponivel: boolean;
  /** Preenchido quando `disponivel` é falso. */
  readonly ausencia?: MotivoAusencia;
  /** Versão detectada, quando a engine sabe dizer a sua. */
  readonly versao?: string;
}

/* ==================== o grafo de conversões ==================== */

/**
 * Uma aresta do grafo: deste formato, para aquele, por esta engine.
 *
 * O grafo é montado no servidor a partir do que cada engine declara suportar E do que a
 * detecção confirmou existir na máquina. A interface nunca adivinha: ela pergunta.
 */
export interface Aresta {
  readonly de: string;
  readonly para: string;
  readonly engine: string;
  /**
   * Quando falso, o destino aparece no seletor mas desabilitado, com o motivo à vista.
   * Esconder seria pior: o usuário ficaria procurando um destino que a aplicação sabe existir.
   */
  readonly disponivel: boolean;
  readonly ausencia?: MotivoAusencia;
}

export interface Limites {
  /**
   * Bytes. Local, então é generoso — o teto existe para proteger a memória da máquina, não
   * para vender plano pago.
   */
  readonly tamanhoMaximo: number;
  /** Quantos arquivos convertem ao mesmo tempo. Padrão: núcleos da máquina menos um. */
  readonly emParalelo: number;
  /** Segundos até a saída ser apagada do disco sozinha. */
  readonly validadeSaida: number;
}

export interface Capacidades {
  readonly versao: string;
  readonly formatos: readonly Formato[];
  readonly engines: readonly EngineDescrita[];
  readonly arestas: readonly Aresta[];
  readonly limites: Limites;
}

/* ==================== opções de conversão ==================== */

export type ModoRedimensionar = 'conter' | 'cobrir' | 'esticar';

export interface OpcoesImagem {
  /** 1..100. Só vale para formato com perda. */
  qualidade?: number;
  largura?: number;
  altura?: number;
  /** Como encaixar na largura/altura pedidas. */
  modo?: ModoRedimensionar;
  /** Nunca passar do tamanho original. Ligado por padrão: ampliar não cria detalhe. */
  semAmpliar?: boolean;
  /** Cor por baixo, ao ir de formato com alfa para formato sem alfa. Formato #RRGGBB. */
  fundo?: string;
  /** Jogar fora EXIF, GPS, perfil de cor e afins. Ligado por padrão: são dados pessoais. */
  limparMetadados?: boolean;
  /** Girar conforme o EXIF antes de converter. Ligado por padrão. */
  girarPeloExif?: boolean;
  /**
   * Só para PNG de saída: reduzir a uma paleta indexada. Ligado por padrão.
   *
   * A medição manda no padrão. Em arte chapada — captura de tela, logo, diagrama, que é o que
   * de fato vira PNG — indexar custa 68 ms contra 15 ms e entrega 6 kB contra 11 kB: quase
   * grátis, quase metade do tamanho. Em imagem com ruído em toda parte o preço vira 829 ms
   * contra 15 ms, e aí desligar faz sentido — só que imagem assim é foto, e foto em PNG já é o
   * formato errado. Desligue ao converter muitas fotos para PNG de uma vez.
   */
  paletaIndexada?: boolean;
}

/** As opções do vetorizador. Espelham `vetorizar(rgba, w, h, opc)` do núcleo já existente. */
export interface OpcoesVetor {
  /** Tolerância do ajuste de Bézier, em pixels. Menor quer dizer mais fiel e mais nós. */
  tol?: number;
  /** Ângulo mínimo, em graus, para um ponto contar como canto. */
  grausMin?: number;
  /** Casas decimais nas coordenadas do path. */
  casas?: number;
  /** Teto de classes de cor. O número real é escolhido pelo resíduo, não por esta opção. */
  maxCores?: number;
  /** Vetorizar mesmo que a análise diga que a imagem é fotográfica. */
  forcarFoto?: boolean;
}

/** As opções do eixo do PDF: rasterizar páginas, e montar PDF a partir de imagem. */
export interface OpcoesPdf {
  /**
   * Quais páginas rasterizar. `todas` por padrão; aceita `3`, `2-5`, `1,4,7-9`.
   *
   * Quando a seleção resolve para mais de uma página, a saída é um `.zip` com uma imagem por
   * página — não há como caber várias páginas num PNG, e escolher a primeira em silêncio seria
   * perder o resto sem avisar. A interface avisa quando isso acontece.
   */
  paginas?: string;
  /**
   * Resolução da rasterização, em pontos por polegada. 150 por padrão.
   *
   * DPI, e não fator de escala, porque é assim que a pessoa pensa: 150 serve para tela e para
   * impressão caseira, 300 é o de gráfica e dobra a memória e o tempo. Uma página A4 a 150 DPI
   * dá 1240 × 1754 px.
   */
  dpi?: number;
  /**
   * Ao montar PDF a partir de imagem: o tamanho da página.
   *
   * `imagem` por padrão — a página fica do tamanho da imagem, sem margem branca que ninguém
   * pediu. `a4` e `carta` encaixam a imagem na folha, respeitando a proporção.
   */
  pdfPagina?: 'imagem' | 'a4' | 'carta';
  /** Margem em milímetros, só quando a página é `a4` ou `carta`. */
  pdfMargem?: number;
  /**
   * Ao montar PDF: embutir a imagem sem perda.
   *
   * O padrão não é um booleano fixo, é uma regra: origem SEM perda (PNG, TIFF, BMP, GIF, SVG)
   * entra sem perda, e origem COM perda (JPEG, WebP, AVIF, HEIC) entra como JPEG. A regra
   * respeita a intenção de quem escolheu o arquivo — quem tem um PNG de captura de tela se
   * importa com o texto nítido, e quem tem um JPEG já aceitou a perda. Marcar isto força sem
   * perda em qualquer origem, ao preço de um arquivo bem maior em foto.
   */
  pdfSemPerda?: boolean;
}

export type Opcoes = OpcoesImagem & OpcoesVetor & OpcoesPdf;

/* ==================== trabalhos ==================== */

export type EstadoTrabalho =
  /** criado, ainda não começou a enviar */
  | 'aguardando'
  /** bytes subindo (só para engine de servidor) */
  | 'enviando'
  /** no servidor, esperando vaga */
  | 'na-fila'
  | 'convertendo'
  | 'concluido'
  | 'falhou'
  | 'cancelado';

export interface Trabalho {
  readonly id: string;
  readonly nomeEntrada: string;
  readonly tamanhoEntrada: number;
  readonly de: string;
  readonly para: string;
  readonly engine: string;
  readonly opcoes: Opcoes;
  readonly estado: EstadoTrabalho;
  readonly criadoEm: number;
}

export interface Saida {
  readonly nome: string;
  readonly tamanho: number;
  readonly mime: string;
  /** Onde baixar. Relativo à raiz da API. */
  readonly url: string;
  /**
   * O que a engine tem a dizer sobre esta conversão: avisos, diagnóstico, medições. O
   * vetorizador devolve bastante coisa aqui (resíduo, nós, paleta) e vale mostrar.
   */
  readonly diagnostico?: Record<string, unknown>;
}

/* ==================== progresso ==================== */

/**
 * Uma etapa declarada da conversão. `peso` é a fatia desta etapa no total.
 *
 * Isto existe para a barra de progresso ser HONESTA. A barra falsa — a que anda sozinha num
 * timer e trava em 90% esperando o fim — é pior que barra nenhuma: ela mente sobre quanto
 * falta e gasta a confiança do usuário na próxima vez. Cada engine declara as suas etapas e
 * informa quanto andou DENTRO da etapa corrente; a fração global sai da soma ponderada e, por
 * construção, não anda para trás.
 */
export interface Etapa {
  readonly id: string;
  readonly rotulo: string;
  readonly peso: number;
}

export interface ErroConversao {
  readonly codigo: string;
  /** Mensagem para o usuário: o que aconteceu e o que fazer. Sem stack trace. */
  readonly mensagem: string;
  /** Detalhe técnico, para quem for depurar. */
  readonly detalhe?: string;
}

export type Evento =
  | { tipo: 'estado'; estado: EstadoTrabalho }
  | { tipo: 'etapas'; etapas: readonly Etapa[] }
  | {
      tipo: 'progresso';
      /** 0..1, global, monotônico. */
      fracao: number;
      /** `id` da etapa corrente. */
      etapa: string;
      /** Texto curto e concreto: "quadro 340 de 1200", "camada 3 de 7". */
      detalhe?: string;
    }
  | { tipo: 'aviso'; texto: string }
  | { tipo: 'concluido'; saida: Saida; duracaoMs: number }
  | { tipo: 'falhou'; erro: ErroConversao };
