import { Progresso, type Capacidades, type ErroConversao, type Etapa, type Evento, type Opcoes, type Saida } from '@conversor/nucleo';

/**
 * A conversa com o servidor de conversão.
 *
 * O ciclo de um trabalho tem três chamadas, e a divisão é o que faz a barra funcionar:
 *
 *   1. `POST /api/trabalhos`            — o servidor devolve o id ANTES de haver bytes
 *   2. `PUT  /api/trabalhos/:id/entrada` — os bytes sobem, com progresso real de envio
 *   3. `GET  /api/trabalhos/:id/eventos` — o progresso da conversão, por SSE
 *
 * Ter o id antes de enviar é o que permite abrir o canal de eventos já durante o envio, e é por
 * isso que o `POST` não recebe o arquivo junto. Se o id só chegasse depois dos bytes, a barra
 * não teria o que mostrar durante o envio — que é justamente a parte demorada de um arquivo
 * grande.
 */

const RAIZ = '/api';

export async function buscaCapacidades(): Promise<Capacidades> {
  const r = await fetch(`${RAIZ}/capacidades`);
  if (!r.ok) throw new ErroDeRede(`O servidor respondeu ${r.status} ao listar as capacidades.`);
  return (await r.json()) as Capacidades;
}

export class ErroDeRede extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroDeRede';
  }
}

/**
 * Peso do envio contra o peso da conversão na barra.
 *
 * Sobre localhost, mandar um arquivo é muito mais rápido que convertê-lo: escrever 5 MB em disco
 * local sai em dezenas de milissegundos, enquanto codificar a mesma imagem em AVIF leva mais de
 * um segundo (medido em `medir-pesos.ts`, no servidor). Com 1 contra 12, o envio ocupa 7,7% da
 * barra — perto da fatia real do tempo, e errando para o lado seguro: se o envio acabar antes
 * do previsto, a barra apenas espera na conversão, em vez de ter corrido adiante.
 *
 * Revisar quando entrar vídeo: lá o arquivo de entrada é muito maior, ainda que a conversão
 * também demore mais.
 */
const PESO_ENVIO = 1;
const PESO_CONVERSAO = 12;

export interface RelatorioDeAndamento {
  /** 0..1, global, monotônico. */
  fracao: number;
  /** O que está acontecendo, em texto pronto para a tela. */
  rotulo: string;
  detalhe?: string | undefined;
  /** As etapas declaradas pela engine, quando já chegaram. */
  etapas?: readonly Etapa[];
  etapaAtual?: string;
}

export interface PedidoDeConversao {
  arquivo: File;
  de: string;
  para: string;
  opcoes: Opcoes;
  aoAndar: (r: RelatorioDeAndamento) => void;
  aoAvisar: (texto: string) => void;
  sinal: AbortSignal;
}

export class ErroDeConversao extends Error {
  constructor(readonly erro: ErroConversao) {
    super(erro.mensagem);
    this.name = 'ErroDeConversao';
  }
}

/**
 * Converte um arquivo no servidor, do começo ao fim.
 *
 * A fração global é composta aqui, e não no servidor, porque só o navegador sabe as duas metades:
 * o servidor não tem como saber quantos bytes já subiram, e o navegador não tem como saber em que
 * etapa a engine está. Cada lado relata o que vê, e a soma ponderada acontece neste arquivo.
 */
export async function converteNoServidor(pedido: PedidoDeConversao): Promise<Saida> {
  const { arquivo, de, para, opcoes, aoAndar, aoAvisar, sinal } = pedido;

  const composicao = new Progresso([
    { id: 'envio', rotulo: 'Enviando', peso: PESO_ENVIO },
    { id: 'conversao', rotulo: 'Convertendo', peso: PESO_CONVERSAO },
  ]);

  /* ---------- 1. criar ---------- */
  const criacao = await fetch(`${RAIZ}/trabalhos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome: arquivo.name, tamanho: arquivo.size, de, para, opcoes }),
    signal: sinal,
  });
  if (!criacao.ok) throw new ErroDeConversao(await erroDaResposta(criacao));
  const { id } = (await criacao.json()) as { id: string };

  // O canal de eventos abre AGORA, antes de os bytes subirem. Os eventos que chegarem enquanto o
  // envio acontece ficam guardados no servidor e são reproduzidos na inscrição, então nada se
  // perde — mas abrir cedo evita a corrida de o trabalho terminar antes de a inscrição existir.
  const conversao = escutaEventos(id, sinal, composicao, aoAndar, aoAvisar);

  /* ---------- 2. enviar ---------- */
  try {
    await envia(id, arquivo, sinal, (enviados) => {
      aoAndar({
        fracao: composicao.em('envio', arquivo.size > 0 ? enviados / arquivo.size : 1),
        rotulo: 'Enviando',
        detalhe: arquivo.size > 0 ? `${Math.round((enviados / arquivo.size) * 100)}% do arquivo` : undefined,
        etapaAtual: 'envio',
      });
    });
  } catch (e) {
    conversao.catch(() => {});
    throw e;
  }

  /* ---------- 3. esperar a conversão ---------- */
  return conversao;
}

/**
 * O envio, por XHR e não por `fetch`.
 *
 * `fetch` não relata progresso de envio. Existe `ReadableStream` como corpo de requisição, mas
 * exige HTTP/2 e `duplex: 'half'`, e não é aceito por todo navegador. `XMLHttpRequest` tem o
 * evento `upload.onprogress` desde sempre e funciona em todos — e progresso de envio real era o
 * requisito, então quem manda é ele.
 */
function envia(
  id: string,
  arquivo: File,
  sinal: AbortSignal,
  aoSubir: (enviados: number) => void,
): Promise<void> {
  return new Promise((resolve, rejeita) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `${RAIZ}/trabalhos/${id}/entrada`);
    xhr.responseType = 'text';

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) aoSubir(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        aoSubir(arquivo.size);
        resolve();
        return;
      }
      rejeita(
        new ErroDeConversao(
          textoParaErro(xhr.responseText, `O servidor recusou o envio (${xhr.status}).`),
        ),
      );
    };
    xhr.onerror = () =>
      rejeita(
        new ErroDeConversao({
          codigo: 'sem-servidor',
          mensagem:
            'Perdi a conexão com o servidor de conversão. Confira se ele ainda está rodando no ' +
            'terminal onde você o iniciou.',
        }),
      );
    xhr.onabort = () => rejeita(new DOMException('cancelado', 'AbortError'));

    const cancela = () => xhr.abort();
    sinal.addEventListener('abort', cancela, { once: true });
    xhr.onloadend = () => sinal.removeEventListener('abort', cancela);

    xhr.send(arquivo);
  });
}

/**
 * Escuta os eventos do servidor.
 *
 * `fetch` com leitura em fluxo, e não `EventSource`. `EventSource` seria mais curto, mas ele
 * RECONECTA sozinho quando o servidor fecha a conexão — e o servidor fecha de propósito ao
 * concluir. O resultado seria uma reconexão a cada trabalho terminado, cada uma reproduzindo o
 * histórico inteiro de novo. Também não há como cancelá-lo por `AbortSignal`.
 */
async function escutaEventos(
  id: string,
  sinal: AbortSignal,
  composicao: Progresso,
  aoAndar: (r: RelatorioDeAndamento) => void,
  aoAvisar: (texto: string) => void,
): Promise<Saida> {
  const r = await fetch(`${RAIZ}/trabalhos/${id}/eventos`, { signal: sinal });
  if (!r.ok || !r.body) throw new ErroDeConversao(await erroDaResposta(r));

  const leitor = r.body.pipeThrough(new TextDecoderStream()).getReader();
  let sobra = '';
  let etapas: readonly Etapa[] | undefined;
  let rotulo = 'Na fila';
  let etapaAtual: string | undefined;

  try {
    for (;;) {
      const { value, done } = await leitor.read();
      if (done) break;
      sobra += value;

      // Um evento SSE termina em linha vazia. O corte tem de ser feito no acumulado, e não a
      // cada pedaço recebido: um evento pode chegar partido em dois pedaços de rede.
      const blocos = sobra.split('\n\n');
      sobra = blocos.pop() ?? '';

      for (const bloco of blocos) {
        const linha = bloco.split('\n').find((l) => l.startsWith('data:'));
        if (!linha) continue; // comentário de pulso
        const evento = JSON.parse(linha.slice(5).trim()) as Evento;

        switch (evento.tipo) {
          case 'etapas':
            etapas = evento.etapas;
            break;

          case 'estado':
            rotulo = ROTULO_ESTADO[evento.estado] ?? rotulo;
            aoAndar({ fracao: composicao.fracao, rotulo, ...(etapas ? { etapas } : {}) });
            break;

          case 'progresso': {
            etapaAtual = evento.etapa;
            const daEtapa = etapas?.find((e) => e.id === evento.etapa);
            aoAndar({
              fracao: composicao.em('conversao', evento.fracao),
              rotulo: daEtapa?.rotulo ?? rotulo,
              ...(evento.detalhe ? { detalhe: evento.detalhe } : {}),
              ...(etapas ? { etapas } : {}),
              etapaAtual,
            });
            break;
          }

          case 'aviso':
            aoAvisar(evento.texto);
            break;

          case 'concluido':
            // Nao ha `aoAndar` aqui, e a ausencia e o ponto.
            //
            // Relatar fracao 1 neste lugar abria uma janela de um quadro em que a barra mostrava
            // 100% e o botao de baixar ainda nao existia: `aoAndar` despacha um estado, a
            // promessa resolve depois, e so entao o item recebe a saida. Sao dois commits do
            // React, e o de tras mostrava 100% sem arquivo — a mentira exata que este projeto
            // recusa. O teste de ponta a ponta pegou, de forma intermitente.
            //
            // Quem fecha em 1 e a acao `conclui` do redutor, que grava a fracao e a saida
            // JUNTAS, num commit so. E a mesma regra do `Progresso` do nucleo — so o fim
            // devolve 1 — aplicada na fronteira entre a rede e a tela.
            return evento.saida;

          case 'falhou':
            throw new ErroDeConversao(evento.erro);
        }
      }
    }
  } finally {
    leitor.cancel().catch(() => {});
  }

  // O fluxo terminou sem `concluido` nem `falhou`: o servidor caiu no meio.
  throw new ErroDeConversao({
    codigo: 'fluxo-interrompido',
    mensagem:
      'O servidor parou de responder no meio da conversão. Veja o terminal onde ele está ' +
      'rodando — o motivo costuma estar lá.',
  });
}

const ROTULO_ESTADO: Readonly<Record<string, string>> = {
  aguardando: 'Aguardando',
  enviando: 'Enviando',
  'na-fila': 'Na fila',
  convertendo: 'Convertendo',
  concluido: 'Pronto',
  falhou: 'Falhou',
  cancelado: 'Cancelado',
};

export async function cancelaNoServidor(id: string): Promise<void> {
  await fetch(`${RAIZ}/trabalhos/${id}`, { method: 'DELETE' }).catch(() => {});
}

async function erroDaResposta(r: Response): Promise<ErroConversao> {
  return textoParaErro(await r.text().catch(() => ''), `O servidor respondeu ${r.status}.`);
}

function textoParaErro(texto: string, reserva: string): ErroConversao {
  try {
    const j = JSON.parse(texto) as { erro?: string; mensagem?: string };
    if (j.mensagem) return { codigo: j.erro ?? 'erro-do-servidor', mensagem: j.mensagem };
  } catch {
    // Não era JSON. Cai na reserva.
  }
  return { codigo: 'erro-do-servidor', mensagem: reserva };
}
