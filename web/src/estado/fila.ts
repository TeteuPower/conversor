import type { ErroConversao, Etapa, Opcoes, Saida } from '@conversor/nucleo';

/**
 * O estado da fila, como redutor.
 *
 * A fila é a única coisa nesta aplicação com estado de verdade — vários arquivos, cada um com seu
 * progresso, seu destino, suas opções e seu resultado, mudando em paralelo. Redutor puro em vez
 * de um punhado de `useState` porque assim a transição fica testável sem montar componente
 * nenhum: os testes em `fila.teste.ts` atravessam um trabalho inteiro chamando só funções.
 *
 * A regra que atravessa o arquivo: **a chegada de um relato atrasado nunca desfaz um estado
 * final**. Um evento de progresso pode chegar depois de o usuário ter cancelado, ou depois de a
 * conversão ter concluído — o worker e o SSE não param no mesmo instante em que a interface muda
 * de tela. Cada ação confere o estado antes de escrever; ver `EstadosFinais`.
 */

export type EstadoItem =
  /** na fila, com destino escolhido, esperando o botão */
  | 'aguardando'
  | 'enviando'
  | 'na-fila'
  | 'convertendo'
  | 'concluido'
  | 'falhou'
  | 'cancelado';

const FINAIS: readonly EstadoItem[] = ['concluido', 'falhou', 'cancelado'];
export const ehFinal = (e: EstadoItem): boolean => FINAIS.includes(e);
export const ehAtivo = (e: EstadoItem): boolean => e === 'enviando' || e === 'na-fila' || e === 'convertendo';

export interface ItemFila {
  /** Id local, criado no navegador. O id do servidor é outro e vive dentro da promessa. */
  readonly id: string;
  readonly arquivo: File;
  readonly de: string;
  readonly para: string;
  readonly engine: string;
  readonly opcoes: Opcoes;
  readonly estado: EstadoItem;
  /** 0..1, real. */
  readonly fracao: number;
  readonly rotulo: string;
  // `| undefined` explicito: com exactOptionalPropertyTypes, um campo `?:` nao aceita receber
  // undefined, e estes sao justamente os que a transicao LIMPA ao recomecar um trabalho.
  readonly detalhe?: string | undefined;
  readonly etapas?: readonly Etapa[] | undefined;
  readonly etapaAtual?: string | undefined;
  readonly avisos: readonly string[];
  readonly saida?: Saida | undefined;
  readonly erro?: ErroConversao | undefined;
  readonly iniciadoEm?: number;
  readonly duracaoMs?: number | undefined;
  /** URL de objeto da pré-visualização da entrada, quando é imagem que o navegador lê. */
  readonly miniatura?: string;
  /** Ordem de entrada, para o escalonamento da animação. */
  readonly indiceDeEntrada: number;
}

export interface EstadoFila {
  readonly itens: readonly ItemFila[];
  /** Quantos arquivos já entraram nesta sessão. Alimenta o escalonamento e o id local. */
  readonly totalJaEntrou: number;
}

export const filaVazia: EstadoFila = { itens: [], totalJaEntrou: 0 };

export type Acao =
  | { tipo: 'acrescenta'; arquivos: NovoArquivo[] }
  | { tipo: 'remove'; id: string }
  | { tipo: 'limpa-concluidos' }
  | { tipo: 'limpa-tudo' }
  | { tipo: 'escolhe-destino'; id: string; para: string; engine: string }
  | { tipo: 'ajusta-opcoes'; id: string; opcoes: Opcoes }
  | { tipo: 'comeca'; id: string }
  | { tipo: 'anda'; id: string; fracao: number; rotulo: string; detalhe?: string; etapas?: readonly Etapa[]; etapaAtual?: string }
  | { tipo: 'avisa'; id: string; texto: string }
  | { tipo: 'conclui'; id: string; saida: Saida }
  | { tipo: 'falha'; id: string; erro: ErroConversao }
  | { tipo: 'cancela'; id: string }
  | { tipo: 'muda-estado'; id: string; estado: EstadoItem; rotulo?: string };

export interface NovoArquivo {
  arquivo: File;
  de: string;
  para: string;
  engine: string;
  opcoes?: Opcoes;
  miniatura?: string;
}

export function reduz(estado: EstadoFila, acao: Acao): EstadoFila {
  switch (acao.tipo) {
    case 'acrescenta': {
      const novos = acao.arquivos.map((n, i) => criaItem(n, estado.totalJaEntrou + i));
      return {
        itens: [...estado.itens, ...novos],
        totalJaEntrou: estado.totalJaEntrou + novos.length,
      };
    }

    case 'remove':
      return { ...estado, itens: estado.itens.filter((i) => i.id !== acao.id) };

    case 'limpa-concluidos':
      return { ...estado, itens: estado.itens.filter((i) => i.estado !== 'concluido') };

    case 'limpa-tudo':
      // Só o que não está em voo: quem está convertendo é cancelado por fora, e o cancelamento
      // é que remove. Tirar o item aqui deixaria a conversão rodando sem ninguém para vê-la.
      return { ...estado, itens: estado.itens.filter((i) => ehAtivo(i.estado)) };

    case 'escolhe-destino':
      return mexe(estado, acao.id, (i) =>
        ehAtivo(i.estado) ? i : reabre({ ...i, para: acao.para, engine: acao.engine }),
      );

    case 'ajusta-opcoes':
      return mexe(estado, acao.id, (i) => (ehAtivo(i.estado) ? i : reabre({ ...i, opcoes: acao.opcoes })));

    case 'comeca':
      return mexe(estado, acao.id, (i) =>
        ehAtivo(i.estado)
          ? i
          : {
              ...i,
              estado: 'enviando',
              fracao: 0,
              rotulo: 'Preparando',
              detalhe: undefined,
              erro: undefined,
              avisos: [],
              saida: undefined,
              duracaoMs: undefined,
              iniciadoEm: Date.now(),
            },
      );

    case 'muda-estado':
      return mexe(estado, acao.id, (i) =>
        ehFinal(i.estado) ? i : { ...i, estado: acao.estado, ...(acao.rotulo ? { rotulo: acao.rotulo } : {}) },
      );

    case 'anda':
      return mexe(estado, acao.id, (i) => {
        // Relato atrasado, que chega depois de o item ter terminado ou sido cancelado.
        if (ehFinal(i.estado)) return i;
        return {
          ...i,
          // Segunda linha de defesa da monotonia. A primeira é o `Progresso` do núcleo; esta
          // pega o caso de duas fontes relatarem o mesmo item — envio e conversão, que são dois
          // canais diferentes e podem chegar fora de ordem pela rede.
          fracao: Math.max(i.fracao, acao.fracao),
          rotulo: acao.rotulo,
          detalhe: acao.detalhe,
          estado: i.estado === 'enviando' && acao.fracao > 0.08 ? 'convertendo' : i.estado,
          ...(acao.etapas ? { etapas: acao.etapas } : {}),
          ...(acao.etapaAtual ? { etapaAtual: acao.etapaAtual } : {}),
        };
      });

    case 'avisa':
      return mexe(estado, acao.id, (i) =>
        // Aviso repetido não empilha: o servidor reproduz o histórico para quem se inscreve
        // atrasado, e sem esta checagem o mesmo aviso apareceria duas vezes no cartão.
        i.avisos.includes(acao.texto) ? i : { ...i, avisos: [...i.avisos, acao.texto] },
      );

    case 'conclui':
      return mexe(estado, acao.id, (i) =>
        ehFinal(i.estado)
          ? i
          : {
              ...i,
              estado: 'concluido',
              fracao: 1,
              rotulo: 'Pronto',
              detalhe: undefined,
              saida: acao.saida,
              duracaoMs: i.iniciadoEm ? Date.now() - i.iniciadoEm : undefined,
            },
      );

    case 'falha':
      return mexe(estado, acao.id, (i) =>
        ehFinal(i.estado) ? i : { ...i, estado: 'falhou', rotulo: 'Falhou', detalhe: undefined, erro: acao.erro },
      );

    case 'cancela':
      return mexe(estado, acao.id, (i) =>
        ehFinal(i.estado) ? i : { ...i, estado: 'cancelado', rotulo: 'Cancelado', detalhe: undefined },
      );
  }
}

/**
 * Devolve um item concluído à fila, para ele poder ser convertido de novo.
 *
 * Isto existe porque trocar a qualidade de um arquivo JÁ convertido não fazia nada visível: as
 * opções mudavam no estado, o cartão continuava mostrando "Pronto" com o arquivo antigo, e o
 * botão de converter seguia desabilitado. O usuário mexia no controle e concluía que a aplicação
 * tinha ignorado.
 *
 * Quem mexeu numa opção quer o resultado com ela. Então o cartão volta a "pronto para converter"
 * e o botão acende. A saída anterior é descartada aqui — e quem chama tem de revogar a URL de
 * objeto ANTES de despachar, porque depois deste ponto ela não é mais alcançável. Ver
 * `aoTrocarDestino` e `aoAplicarOpcoes` no App.
 */
function reabre(i: ItemFila): ItemFila {
  if (i.estado !== 'concluido' && i.estado !== 'falhou' && i.estado !== 'cancelado') return i;
  return {
    ...i,
    estado: 'aguardando',
    fracao: 0,
    rotulo: 'Pronto para converter',
    detalhe: undefined,
    saida: undefined,
    erro: undefined,
    avisos: [],
    duracaoMs: undefined,
    etapas: undefined,
    etapaAtual: undefined,
  };
}

function criaItem(n: NovoArquivo, indice: number): ItemFila {
  return {
    id: `${indice}-${n.arquivo.name}-${n.arquivo.size}-${n.arquivo.lastModified}`,
    arquivo: n.arquivo,
    de: n.de,
    para: n.para,
    engine: n.engine,
    opcoes: n.opcoes ?? {},
    estado: 'aguardando',
    fracao: 0,
    rotulo: 'Pronto para converter',
    avisos: [],
    ...(n.miniatura ? { miniatura: n.miniatura } : {}),
    indiceDeEntrada: indice,
  };
}

function mexe(estado: EstadoFila, id: string, f: (i: ItemFila) => ItemFila): EstadoFila {
  let mudou = false;
  const itens = estado.itens.map((i) => {
    if (i.id !== id) return i;
    const novo = f(i);
    if (novo !== i) mudou = true;
    return novo;
  });
  // Devolver o mesmo objeto quando nada muda evita repintura à toa — e há muitos relatos por
  // segundo com vários arquivos em voo.
  return mudou ? { ...estado, itens } : estado;
}

/* ==================== consultas ==================== */

/**
 * O progresso do conjunto, para a barra do topo.
 *
 * A média é PONDERADA PELO TAMANHO do arquivo, e não simples. Com uma média simples, converter
 * um ícone de 4 kB junto de uma foto de 8 MB levaria a barra a 50% em meio segundo e depois ela
 * ficaria quase parada — o que descreve mal o que falta. Ponderar pelo tamanho aproxima a barra
 * do trabalho restante de verdade.
 *
 * A aproximação tem limite conhecido: o tamanho do arquivo não é proporcional ao custo da
 * conversão (uma vetorização de 200 kB demora mais que um redimensionamento de 5 MB). É a melhor
 * estimativa disponível antes de começar, e ela erra para o lado de não se adiantar.
 */
export function progressoDoConjunto(itens: readonly ItemFila[]): { fracao: number; ativos: number } {
  const relevantes = itens.filter((i) => ehAtivo(i.estado) || i.estado === 'concluido');
  if (relevantes.length === 0) return { fracao: 0, ativos: 0 };

  let peso = 0;
  let feito = 0;
  for (const i of relevantes) {
    // Piso de 1 kB: um arquivo de 0 bytes não pode ter peso zero, ou desapareceria da média.
    const p = Math.max(1000, i.arquivo.size);
    peso += p;
    feito += p * i.fracao;
  }
  return {
    fracao: peso > 0 ? feito / peso : 0,
    ativos: itens.filter((i) => ehAtivo(i.estado)).length,
  };
}

export const contaPor = (itens: readonly ItemFila[], estado: EstadoItem): number =>
  itens.filter((i) => i.estado === estado).length;

export const prontosParaConverter = (itens: readonly ItemFila[]): readonly ItemFila[] =>
  itens.filter((i) => i.estado === 'aguardando' || i.estado === 'falhou' || i.estado === 'cancelado');

export const concluidos = (itens: readonly ItemFila[]): readonly ItemFila[] =>
  itens.filter((i) => i.estado === 'concluido' && i.saida);

/**
 * Solta as URLs de objeto de um item.
 *
 * `URL.createObjectURL` mantém o Blob vivo até ser revogado — o coletor de lixo não desfaz isso
 * sozinho. Sem esta chamada, converter cinquenta imagens numa sessão longa deixaria cinquenta
 * SVGs e cinquenta miniaturas presos na memória da aba, e o vazamento só apareceria como "o
 * navegador está lento hoje".
 */
export function descarta(item: ItemFila): void {
  if (item.miniatura?.startsWith('blob:')) URL.revokeObjectURL(item.miniatura);
  if (item.saida?.url.startsWith('blob:')) URL.revokeObjectURL(item.saida.url);
}
