import { stat } from 'node:fs/promises';
import { Progresso, type ErroConversao, type Etapa, type Evento, type EstadoTrabalho, type Opcoes, type Saida } from '@conversor/nucleo';
import { ErroDeEntrada, type Engine, type Relator } from './engines/registro.js';
import type { Pasta } from './armazenamento.js';

/**
 * A fila de conversões.
 *
 * Três decisões desenham este arquivo.
 *
 * **1. Os eventos ficam guardados, não só transmitidos.** A interface cria o trabalho, manda os
 * bytes e só então abre o canal de progresso — e a conversão pode ter começado, ou até acabado,
 * nesse intervalo. Um canal que só transmita o que acontece DEPOIS da inscrição perderia
 * justamente o começo, e a barra apareceria já em 40% sem nunca ter mostrado as etapas. Então
 * todo evento vai para uma lista por trabalho, e quem se inscreve recebe a lista antes do fluxo
 * ao vivo. É também o que faz o F5 no meio de uma conversão funcionar.
 *
 * **2. Cancelar cancela de verdade.** Cada trabalho tem o seu `AbortController`, e o sinal chega
 * à engine. Sem isso, cancelar na interface apenas esconderia o cartão enquanto a máquina segue
 * queimando CPU por um AVIF que ninguém mais quer — e numa aplicação que roda junto do resto do
 * trabalho do usuário, isso se nota.
 *
 * **3. O paralelismo é limitado, e o limite é conservador.** Ver `emParalelo` em `index.ts`.
 */

export interface PedidoDeTrabalho {
  readonly id: string;
  readonly pasta: Pasta;
  readonly nomeEntrada: string;
  readonly tamanhoEntrada: number;
  readonly de: string;
  readonly para: string;
  readonly opcoes: Opcoes;
  readonly engine: Engine;
  /** Como batizar e servir a saída quando terminar. */
  readonly nomeSaida: string;
  readonly mimeSaida: string;
}

type Ouvinte = (e: Evento) => void;

interface Registro {
  readonly id: string;
  estado: EstadoTrabalho;
  readonly eventos: Evento[];
  readonly ouvintes: Set<Ouvinte>;
  readonly abortar: AbortController;
  /** Preenchido ao concluir; é o que a rota de download consulta. */
  saida?: Saida;
  erro?: ErroConversao;
  iniciadoEm?: number;
}

export class Fila {
  private readonly registros = new Map<string, Registro>();
  private readonly esperando: PedidoDeTrabalho[] = [];
  private rodando = 0;

  constructor(
    private readonly emParalelo: number,
    private readonly aoLogar: (msg: string) => void = () => {},
  ) {}

  /**
   * Registra o trabalho antes de haver bytes.
   *
   * A separação entre registrar e enfileirar é o que permite à interface abrir o canal de
   * progresso durante o envio: ela já tem o id, e o estado `enviando` já é observável.
   */
  registra(id: string): void {
    this.registros.set(id, {
      id,
      estado: 'aguardando',
      eventos: [],
      ouvintes: new Set(),
      abortar: new AbortController(),
    });
  }

  estadoDe(id: string): EstadoTrabalho | undefined {
    return this.registros.get(id)?.estado;
  }

  saidaDe(id: string): Saida | undefined {
    return this.registros.get(id)?.saida;
  }

  marca(id: string, estado: EstadoTrabalho): void {
    const r = this.registros.get(id);
    if (!r || terminal(r.estado)) return;
    r.estado = estado;
    this.emite(r, { tipo: 'estado', estado });
  }

  enfileira(pedido: PedidoDeTrabalho): void {
    const r = this.registros.get(pedido.id);
    if (!r || terminal(r.estado)) return;
    this.esperando.push(pedido);
    this.marca(pedido.id, 'na-fila');
    this.puxa();
  }

  /**
   * Inscreve um ouvinte. Devolve como sair.
   *
   * O histórico vai primeiro, e vai SINCRONAMENTE: se fosse assíncrono, um evento ao vivo
   * poderia furar a fila e chegar antes do histórico, e a interface veria `concluido` antes de
   * `etapas`.
   */
  ouve(id: string, ouvinte: Ouvinte): (() => void) | undefined {
    const r = this.registros.get(id);
    if (!r) return undefined;
    for (const e of r.eventos) ouvinte(e);
    if (terminal(r.estado)) return () => {};
    r.ouvintes.add(ouvinte);
    return () => r.ouvintes.delete(ouvinte);
  }

  cancela(id: string): boolean {
    const r = this.registros.get(id);
    if (!r || terminal(r.estado)) return false;
    r.abortar.abort();
    const i = this.esperando.findIndex((p) => p.id === id);
    if (i >= 0) this.esperando.splice(i, 1);
    r.estado = 'cancelado';
    this.emite(r, { tipo: 'estado', estado: 'cancelado' });
    this.fecha(r);
    return true;
  }

  /** Solta o que o trabalho guardava em memória. O disco é do `Armazenamento`. */
  esquece(id: string): void {
    const r = this.registros.get(id);
    if (r) {
      r.ouvintes.clear();
      this.registros.delete(id);
    }
  }

  falha(id: string, erro: ErroConversao): void {
    const r = this.registros.get(id);
    if (!r || terminal(r.estado)) return;
    r.estado = 'falhou';
    r.erro = erro;
    this.emite(r, { tipo: 'estado', estado: 'falhou' });
    this.emite(r, { tipo: 'falhou', erro });
    this.fecha(r);
  }

  get ocupacao(): { rodando: number; esperando: number } {
    return { rodando: this.rodando, esperando: this.esperando.length };
  }

  /* ---------- por dentro ---------- */

  private emite(r: Registro, e: Evento): void {
    r.eventos.push(e);
    // Um trabalho longo relata muito; sem teto, a lista cresceria sem limite em memória. 500
    // eventos cobrem qualquer conversão com folga, e os primeiros (estado e etapas) são os que
    // um inscrito atrasado precisa, então o corte é do MEIO: mantém o começo e o fim.
    if (r.eventos.length > 500) r.eventos.splice(100, 200);
    for (const o of r.ouvintes) {
      try {
        o(e);
      } catch {
        // Ouvinte que explode (conexão já fechada) não interrompe os outros.
      }
    }
  }

  private fecha(r: Registro): void {
    r.ouvintes.clear();
  }

  private puxa(): void {
    while (this.rodando < this.emParalelo && this.esperando.length > 0) {
      const pedido = this.esperando.shift()!;
      const r = this.registros.get(pedido.id);
      if (!r || terminal(r.estado)) continue;
      this.rodando++;
      void this.executa(pedido, r).finally(() => {
        this.rodando--;
        this.puxa();
      });
    }
  }

  private async executa(pedido: PedidoDeTrabalho, r: Registro): Promise<void> {
    r.estado = 'convertendo';
    r.iniciadoEm = Date.now();
    this.emite(r, { tipo: 'estado', estado: 'convertendo' });

    // O `Progresso` nasce vazio e é substituído quando a engine declara as etapas. Enquanto não
    // declarar, `andou` não tem o que calcular e é ignorado — engine que relata antes de
    // declarar é bug dela, e não motivo para derrubar a conversão.
    let progresso: Progresso | undefined;
    let ultimaFracao = -1;

    const relator: Relator = {
      etapas: (etapas: readonly Etapa[]) => {
        progresso = new Progresso(etapas);
        this.emite(r, { tipo: 'etapas', etapas });
      },
      andou: (etapa: string, dentro = 0, detalhe?: string) => {
        if (!progresso) return;
        const fracao = progresso.em(etapa, dentro);
        // Só emite quando o número muda de verdade. Uma engine que relate a cada iteração de um
        // laço encheria o canal de eventos idênticos, e o custo de serializar cada um apareceria
        // no tempo total da conversão.
        if (fracao === ultimaFracao && !detalhe) return;
        ultimaFracao = fracao;
        this.emite(r, { tipo: 'progresso', fracao, etapa, ...(detalhe ? { detalhe } : {}) });
      },
      avisa: (texto: string) => this.emite(r, { tipo: 'aviso', texto }),
    };

    try {
      const resultado = await pedido.engine.converte(
        {
          id: pedido.id,
          entrada: pedido.pasta.entrada,
          saida: pedido.pasta.saida,
          de: pedido.de,
          para: pedido.para,
          opcoes: pedido.opcoes,
          nomeOriginal: pedido.nomeEntrada,
          sinal: r.abortar.signal,
        },
        relator,
      );

      if (r.abortar.signal.aborted) return;

      const s = await stat(pedido.pasta.saida);
      const saida: Saida = {
        nome: pedido.nomeSaida,
        tamanho: s.size,
        mime: pedido.mimeSaida,
        url: `/api/trabalhos/${pedido.id}/saida`,
        ...(resultado.diagnostico ? { diagnostico: resultado.diagnostico } : {}),
      };
      r.saida = saida;
      r.estado = 'concluido';
      // O fluxo NAO emite `progresso` com fracao 1.
      //
      // Quem consome a API direto veria esse 1 antes de a saida estar servivel, e concluiria
      // (com razao) que o arquivo esta pronto. O sinal de pronto e o evento `concluido`, que ja
      // carrega a saida. O `Progresso` do cliente tambem apara qualquer 1 vindo de etapa, mas
      // depender disso seria consertar no consumidor um contrato torto na origem.
      if (progresso) progresso.conclui();
      this.emite(r, { tipo: 'estado', estado: 'concluido' });
      this.emite(r, { tipo: 'concluido', saida, duracaoMs: Date.now() - (r.iniciadoEm ?? Date.now()) });
      this.fecha(r);
      this.aoLogar(`${pedido.nomeEntrada} -> ${pedido.nomeSaida} (${s.size} B)`);
    } catch (e) {
      if (r.abortar.signal.aborted || (e as Error)?.name === 'AbortError') {
        this.cancela(pedido.id);
        return;
      }
      this.falha(pedido.id, traduzErro(e));
      this.aoLogar(`FALHOU ${pedido.nomeEntrada}: ${(e as Error).message}`);
    }
  }
}

const terminal = (e: EstadoTrabalho): boolean => e === 'concluido' || e === 'falhou' || e === 'cancelado';

/**
 * Traduz a exceção para uma mensagem que serve ao usuário.
 *
 * `ErroDeEntrada` é o que a engine lança quando a culpa é do arquivo ou da opção: a mensagem
 * dela já foi escrita para ser lida e passa direto. Qualquer outra exceção é bug nosso, e aí a
 * mensagem é honesta sobre isso — dizer "arquivo inválido" quando o defeito é do nosso código
 * manda o usuário procurar problema onde não tem.
 */
function traduzErro(e: unknown): ErroConversao {
  if (e instanceof ErroDeEntrada) {
    return { codigo: e.codigo, mensagem: e.message, ...(e.detalhe ? { detalhe: e.detalhe } : {}) };
  }
  const err = e as Error;
  return {
    codigo: 'erro-interno',
    mensagem:
      'A conversão falhou por um problema do conversor, não do seu arquivo. O detalhe técnico ' +
      'está aqui embaixo e no terminal onde o servidor está rodando.',
    detalhe: err?.stack ?? String(e),
  };
}
