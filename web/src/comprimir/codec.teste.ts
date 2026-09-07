import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Compressor, type Ajuste, type Canal, type Resultado } from './codec.js';
import type { PedidoAoWorker, RespostaDoWorker } from './protocolo.js';

/**
 * Um canal falso no lugar do worker.
 *
 * O teste guarda os pedidos e responde quando MANDAM responder. É isso que permite exercitar a
 * política de fila — que só se manifesta quando um pedido chega com outro ainda em voo, uma
 * corrida que com o worker de verdade seria irreproduzível.
 */
class CanalFalso implements Canal {
  readonly pedidos: PedidoAoWorker[] = [];
  private ouvinte: ((e: MessageEvent<RespostaDoWorker>) => void) | undefined;
  encerrado = false;

  postMessage(p: PedidoAoWorker): void {
    this.pedidos.push(p);
  }

  addEventListener(_: 'message', ouvinte: (e: MessageEvent<RespostaDoWorker>) => void): void {
    this.ouvinte = ouvinte;
  }

  terminate(): void {
    this.encerrado = true;
  }

  responde(msg: RespostaDoWorker): void {
    this.ouvinte?.({ data: msg } as MessageEvent<RespostaDoWorker>);
  }

  /** Conclui uma codificação pelo id, com um tamanho qualquer. */
  conclui(id: number, tamanho = 1000): void {
    this.responde({
      tipo: 'pronto',
      id,
      dados: new ArrayBuffer(8),
      mime: 'image/webp',
      tamanho,
      largura: 100,
      altura: 80,
      ms: 12,
    });
  }

  get codificacoes(): Extract<PedidoAoWorker, { tipo: 'codifica' }>[] {
    return this.pedidos.filter((p): p is Extract<PedidoAoWorker, { tipo: 'codifica' }> => p.tipo === 'codifica');
  }
}

const ajuste = (qualidade: number): Ajuste => ({ formato: 'webp', qualidade });

function monta() {
  const canal = new CanalFalso();
  const resultados: Resultado[] = [];
  const erros: string[] = [];
  const ocupado: boolean[] = [];
  const c = new Compressor(canal, {
    aoResultado: (r) => resultados.push(r),
    aoErro: (m) => erros.push(m),
    aoOcupado: (o) => ocupado.push(o),
  });
  return { canal, c, resultados, erros, ocupado };
}

beforeEach(() => {
  // jsdom não traz URL.createObjectURL, e o Compressor cria uma por resultado.
  globalThis.URL.createObjectURL = vi.fn(() => `blob:falso-${Math.random()}`);
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe('política de fila: um em voo, o último esperando', () => {
  it('despacha o primeiro pedido na hora', () => {
    const { canal, c } = monta();
    c.pede(ajuste(80));
    expect(canal.codificacoes).toHaveLength(1);
    expect(canal.codificacoes[0]!.qualidade).toBe(80);
  });

  it('não empilha: com um em voo, os que chegam disputam uma vaga só', () => {
    const { canal, c } = monta();
    c.pede(ajuste(80));
    // O arrasto do controle deslizante: dezenas de eventos enquanto o primeiro ainda roda.
    for (const q of [70, 60, 50, 40, 30]) c.pede(ajuste(q));
    expect(canal.codificacoes).toHaveLength(1);

    canal.conclui(1);
    // Entrou o ÚLTIMO, não o segundo: o preview salta para onde o controle está agora, sem
    // passar por cinco posições que o usuário já deixou para trás.
    expect(canal.codificacoes).toHaveLength(2);
    expect(canal.codificacoes[1]!.qualidade).toBe(30);
  });

  it('a fila nunca passa de dois pedidos, por mais que se arraste', () => {
    const { canal, c } = monta();
    for (let q = 100; q > 0; q--) c.pede(ajuste(q));
    expect(canal.codificacoes).toHaveLength(1);
    canal.conclui(1);
    expect(canal.codificacoes).toHaveLength(2);
    canal.conclui(2);
    // Nada mais esperando: o último pedido já foi atendido, e a fila secou.
    expect(canal.codificacoes).toHaveLength(2);
  });

  it('volta a despachar na hora quando não há nada em voo', () => {
    const { canal, c } = monta();
    c.pede(ajuste(80));
    canal.conclui(1);
    c.pede(ajuste(50));
    expect(canal.codificacoes).toHaveLength(2);
  });
});

describe('resultados', () => {
  it('entrega o resultado com o ajuste que o gerou', () => {
    const { canal, c, resultados } = monta();
    c.pede(ajuste(64));
    canal.conclui(1, 4321);
    expect(resultados).toHaveLength(1);
    expect(resultados[0]!.ajuste.qualidade).toBe(64);
    expect(resultados[0]!.tamanho).toBe(4321);
  });

  it('ignora em silêncio a resposta de um pedido superado', () => {
    const { canal, c, resultados } = monta();
    c.pede(ajuste(80));
    c.pede(ajuste(30));
    canal.conclui(1); // despacha o 2
    canal.conclui(1); // resposta duplicada e velha do 1
    expect(resultados).toHaveLength(1);
    canal.conclui(2);
    expect(resultados).toHaveLength(2);
    expect(resultados[1]!.ajuste.qualidade).toBe(30);
  });

  it('mantém no máximo uma URL de objeto viva por vez', () => {
    // Sem isto, um arrasto de ponta a ponta deixaria dezenas de Blobs de megabytes presos na
    // memória da aba até o F5.
    const { canal, c } = monta();
    c.pede(ajuste(80));
    canal.conclui(1);
    c.pede(ajuste(60));
    canal.conclui(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    c.encerra();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});

describe('ocupado', () => {
  it('acende ao despachar e apaga só quando a fila seca', () => {
    const { canal, c, ocupado } = monta();
    c.pede(ajuste(80));
    expect(ocupado).toEqual([true]);
    c.pede(ajuste(40));
    canal.conclui(1);
    // Ainda ocupado: o pendente entrou em voo. Piscar o indicador entre os dois seria ruído.
    expect(ocupado).toEqual([true, true]);
    canal.conclui(2);
    expect(ocupado).toEqual([true, true, false]);
  });
});

describe('erros', () => {
  it('relata a falha de uma codificação', () => {
    const { canal, c, erros } = monta();
    c.pede(ajuste(80));
    canal.responde({ tipo: 'erro', id: 1, mensagem: 'não codifica AVIF' });
    expect(erros).toEqual(['não codifica AVIF']);
  });

  it('não engole erro sem id — é falha do worker inteiro', () => {
    // Sem o desvio para este caso, `id !== this.emVoo` seria sempre verdade e a interface
    // ficaria esperando para sempre por um resultado que não vem.
    const { canal, c, erros, ocupado } = monta();
    c.pede(ajuste(80));
    canal.responde({ tipo: 'erro', mensagem: 'createImageBitmap falhou' });
    expect(erros).toEqual(['createImageBitmap falhou']);
    expect(ocupado.at(-1)).toBe(false);
  });

  it('destrava a fila depois de um erro', () => {
    const { canal, c } = monta();
    c.pede(ajuste(80));
    c.pede(ajuste(40));
    canal.responde({ tipo: 'erro', id: 1, mensagem: 'falhou' });
    expect(canal.codificacoes).toHaveLength(2);
    expect(canal.codificacoes[1]!.qualidade).toBe(40);
  });
});

describe('encerrar', () => {
  it('para de aceitar pedidos e desliga o worker', () => {
    const { canal, c } = monta();
    c.encerra();
    c.pede(ajuste(80));
    expect(canal.codificacoes).toHaveLength(0);
    expect(canal.encerrado).toBe(true);
  });
});
