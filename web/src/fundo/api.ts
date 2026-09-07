import { Progresso, type Etapa, type EstadoDosModelos, type OpcoesFundo, type ResultadoFundo } from '@conversor/nucleo';

/**
 * O cliente da ferramenta de remover fundo.
 *
 * Espelha `web/src/api.ts`, que é o cliente da conversão, porque os dois problemas são o mesmo:
 * criar o trabalho, subir os bytes com progresso real, escutar o servidor contar o resto. O que
 * muda aqui é uma etapa a mais, e ela é a maior de todas na primeira vez: **baixar o modelo**.
 */

const RAIZ = '/api/fundo';

/**
 * Os pesos das três fases.
 *
 * O envio some ao lado do resto: uma foto de 3 MB sobe por localhost em dezenas de milissegundos,
 * enquanto o modelo leva cerca de 2 s (medido: 2 040 ms na GPU). Daí 1 contra 20.
 *
 * O download do modelo não entra nesta soma. São 490 MB que acontecem UMA vez na vida da
 * instalação; misturá-los na mesma barra faria a primeira remoção mostrar 3% enquanto o modelo
 * baixa e depois pular para o fim, e todas as outras começarem em 97%. São dois trabalhos
 * diferentes, e a interface mostra dois momentos diferentes.
 */
const PESO_ENVIO = 1;
const PESO_PROCESSO = 20;

export interface Andamento {
  /** 0..1, global, monotônico. */
  fracao: number;
  rotulo: string;
  detalhe?: string | undefined;
  etapas?: readonly Etapa[];
  etapaAtual?: string;
}

export interface PedidoDeRemocao {
  arquivo: File;
  opcoes: OpcoesFundo;
  aoAndar: (a: Andamento) => void;
  aoAvisar: (texto: string) => void;
  /** Chamado quando o modelo precisa ser baixado antes. `fracao` é dos bytes, de verdade. */
  aoBaixarModelo?: (fracao: number, detalhe: string) => void;
  sinal: AbortSignal;
}

export class ErroDeRemocao extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
    readonly detalhe?: string,
  ) {
    super(mensagem);
    this.name = 'ErroDeRemocao';
  }
}

export interface Recorte {
  /** O PNG RGBA já decodificado, pronto para ir a um canvas. */
  readonly imagem: ImageBitmap;
  readonly resultado: ResultadoFundo;
  readonly nome: string;
  readonly duracaoMs: number;
}

export async function buscaModelos(): Promise<EstadoDosModelos> {
  const r = await fetch(`${RAIZ}/modelos`);
  if (!r.ok) throw new ErroDeRemocao('sem-modelos', 'O servidor não respondeu quais modelos existem.');
  return (await r.json()) as EstadoDosModelos;
}

export async function apagaModelo(id: string): Promise<void> {
  await fetch(`${RAIZ}/modelos/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/**
 * Baixa o peso, relatando bytes de verdade.
 *
 * Esta é a barra mais honesta do sistema inteiro: o servidor conhece o `content-length` e conta
 * os bytes que passam. Não há etapa, não há estimativa — é regra de três.
 */
export function baixaModelo(
  id: string,
  aoAndar: (fracao: number, detalhe: string) => void,
  sinal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, rejeita) => {
    const es = new EventSource(`${RAIZ}/modelos/${encodeURIComponent(id)}/baixar`);
    const fecha = () => es.close();
    sinal.addEventListener('abort', () => {
      fecha();
      rejeita(new DOMException('cancelado', 'AbortError'));
    });
    es.onmessage = (ev) => {
      // Tipar como união discriminada não ajuda aqui: o fluxo também carrega eventos que este
      // consumidor ignora, e a união teria de listar todos só para o `default` existir.
      const e = JSON.parse(ev.data) as Record<string, unknown> & { tipo: string };
      if (e.tipo === 'progresso') {
        aoAndar(e['fracao'] as number, (e['detalhe'] as string | undefined) ?? '');
      } else if (e.tipo === 'concluido') {
        fecha();
        resolve();
      } else if (e.tipo === 'falhou') {
        fecha();
        const erro = e['erro'] as { codigo: string; mensagem: string };
        rejeita(new ErroDeRemocao(erro.codigo, erro.mensagem));
      }
    };
    es.onerror = () => {
      fecha();
      rejeita(new ErroDeRemocao('conexao', 'A conexão com o servidor caiu durante o download do modelo.'));
    };
  });
}

/** Remove o fundo de um arquivo, do começo ao fim. */
export async function removeFundo(pedido: PedidoDeRemocao): Promise<Recorte> {
  const { arquivo, opcoes, aoAndar, aoAvisar, aoBaixarModelo, sinal } = pedido;

  const composicao = new Progresso([
    { id: 'envio', rotulo: 'Enviando', peso: PESO_ENVIO },
    { id: 'processo', rotulo: 'Removendo o fundo', peso: PESO_PROCESSO },
  ]);

  /* ---------- 1. criar ---------- */
  const criacao = await fetch(`${RAIZ}/trabalhos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome: arquivo.name, opcoes }),
    signal: sinal,
  });
  if (!criacao.ok) throw await erroDaResposta(criacao);
  const criado = (await criacao.json()) as { id: string; modelo: string; precisaBaixar: boolean };

  /* ---------- 2. o modelo, se ainda não estiver aqui ---------- */
  if (criado.precisaBaixar && aoBaixarModelo) {
    await baixaModelo(criado.modelo, aoBaixarModelo, sinal);
  }

  // Abre o canal antes de subir os bytes: o servidor guarda os eventos e reproduz na inscrição,
  // então nada se perde, mas abrir cedo evita a corrida de o trabalho acabar antes da inscrição.
  const processo = escuta(criado.id, sinal, composicao, aoAndar, aoAvisar);

  /* ---------- 3. enviar ---------- */
  try {
    await envia(criado.id, arquivo, sinal, (enviados) => {
      aoAndar({
        fracao: composicao.em('envio', arquivo.size > 0 ? enviados / arquivo.size : 1),
        rotulo: 'Enviando a imagem',
        detalhe: arquivo.size > 0 ? `${Math.round((enviados / arquivo.size) * 100)}%` : undefined,
        etapaAtual: 'envio',
      });
    });
  } catch (e) {
    processo.catch(() => {});
    throw e;
  }

  /* ---------- 4. esperar ---------- */
  const { resultado, duracaoMs } = await processo;

  /* ---------- 5. trazer o recorte ---------- */
  const resposta = await fetch(resultado.recorteUrl, { signal: sinal });
  if (!resposta.ok) throw new ErroDeRemocao('sem-recorte', 'O recorte ficou pronto mas não veio.');
  const imagem = await createImageBitmap(await resposta.blob());

  return { imagem, resultado, nome: arquivo.name, duracaoMs };
}

export async function cancela(id: string): Promise<void> {
  await fetch(`${RAIZ}/trabalhos/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
}

/* ==================== por dentro ==================== */

/**
 * O envio por XHR, e não por `fetch`, pelo mesmo motivo do outro cliente: `fetch` não relata
 * progresso de envio, e progresso real era o requisito.
 */
function envia(
  id: string,
  arquivo: File,
  sinal: AbortSignal,
  aoEnviar: (enviados: number) => void,
): Promise<void> {
  return new Promise((resolve, rejeita) => {
    const x = new XMLHttpRequest();
    x.open('PUT', `${RAIZ}/trabalhos/${encodeURIComponent(id)}/entrada`);
    x.upload.onprogress = (ev) => {
      if (ev.lengthComputable) aoEnviar(ev.loaded);
    };
    x.onload = () =>
      x.status >= 200 && x.status < 300
        ? resolve()
        : rejeita(paraErro(x.responseText, `O envio falhou (HTTP ${x.status}).`));
    x.onerror = () => rejeita(new ErroDeRemocao('conexao', 'A conexão caiu durante o envio.'));
    x.onabort = () => rejeita(new DOMException('cancelado', 'AbortError'));
    sinal.addEventListener('abort', () => x.abort());
    x.send(arquivo);
  });
}

const ROTULO_ESTADO: Readonly<Record<string, string>> = {
  aguardando: 'Preparando',
  enviando: 'Enviando a imagem',
  'na-fila': 'Na fila',
  convertendo: 'Removendo o fundo',
};

function escuta(
  id: string,
  sinal: AbortSignal,
  composicao: Progresso,
  aoAndar: (a: Andamento) => void,
  aoAvisar: (texto: string) => void,
): Promise<{ resultado: ResultadoFundo; duracaoMs: number }> {
  return new Promise((resolve, rejeita) => {
    const es = new EventSource(`${RAIZ}/trabalhos/${encodeURIComponent(id)}/eventos`);
    let etapas: readonly Etapa[] | undefined;
    let rotulo = 'Preparando';

    const fecha = () => es.close();
    sinal.addEventListener('abort', () => {
      fecha();
      rejeita(new DOMException('cancelado', 'AbortError'));
    });

    es.onmessage = (ev) => {
      const e = JSON.parse(ev.data) as Record<string, unknown> & { tipo: string };
      switch (e.tipo) {
        case 'estado':
          rotulo = ROTULO_ESTADO[e['estado'] as string] ?? rotulo;
          aoAndar({ fracao: composicao.fracao, rotulo, ...(etapas ? { etapas } : {}) });
          break;

        case 'etapas':
          etapas = e['etapas'] as readonly Etapa[];
          aoAndar({ fracao: composicao.fracao, rotulo, etapas });
          break;

        case 'progresso': {
          const etapa = e['etapa'] as string;
          const daEngine = e['fracao'] as number;
          const doTodo = composicao.em('processo', daEngine);
          const dessaEtapa = etapas?.find((x) => x.id === etapa);
          aoAndar({
            fracao: doTodo,
            rotulo: dessaEtapa?.rotulo ?? rotulo,
            detalhe: e['detalhe'] as string | undefined,
            ...(etapas ? { etapas } : {}),
            etapaAtual: etapa,
          });
          break;
        }

        case 'aviso':
          aoAvisar(e['texto'] as string);
          break;

        case 'concluido': {
          // O servidor não emite progresso em 1 de propósito — o sinal de pronto é ESTE evento.
          // Ver o comentário na conclusão de `servidor/src/fila.ts`. É aqui, e só aqui, que a
          // barra fecha em 100%.
          composicao.conclui();
          aoAndar({ fracao: 1, rotulo: 'Pronto', ...(etapas ? { etapas } : {}) });
          fecha();
          const saida = e['saida'] as { diagnostico?: ResultadoFundo };
          if (!saida?.diagnostico) {
            rejeita(new ErroDeRemocao('sem-diagnostico', 'O recorte veio sem os dados de que a tela precisa.'));
            return;
          }
          resolve({ resultado: saida.diagnostico, duracaoMs: (e['duracaoMs'] as number) ?? 0 });
          break;
        }

        case 'falhou': {
          fecha();
          const erro = e['erro'] as { codigo: string; mensagem: string; detalhe?: string };
          rejeita(new ErroDeRemocao(erro.codigo, erro.mensagem, erro.detalhe));
          break;
        }
      }
    };

    es.onerror = () => {
      fecha();
      rejeita(new ErroDeRemocao('conexao', 'A conexão com o servidor caiu no meio do trabalho.'));
    };
  });
}

async function erroDaResposta(r: Response): Promise<ErroDeRemocao> {
  return paraErro(await r.text().catch(() => ''), `O servidor respondeu ${r.status}.`);
}

function paraErro(texto: string, reserva: string): ErroDeRemocao {
  try {
    const o = JSON.parse(texto) as { erro?: string; mensagem?: string };
    return new ErroDeRemocao(o.erro ?? 'erro', o.mensagem ?? reserva);
  } catch {
    return new ErroDeRemocao('erro', reserva);
  }
}
