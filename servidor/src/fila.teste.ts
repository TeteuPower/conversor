import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Evento } from '@conversor/nucleo';
import { Fila, type PedidoDeTrabalho } from './fila.js';
import { ErroDeEntrada, type Engine, type Relator, type Tarefa } from './engines/registro.js';

/** Uma engine de mentira, para poder testar a fila sem envolver o libvips. */
function engineFalsa(
  faz: (t: Tarefa, r: Relator) => Promise<void>,
  id = 'falsa',
): Engine {
  return {
    id,
    nome: id,
    descricao: 'engine de teste',
    detecta: async () => ({ disponivel: true }),
    arestas: () => [],
    converte: async (t, r) => {
      await faz(t, r);
      return {};
    },
  };
}

async function pedido(engine: Engine, id: string): Promise<PedidoDeTrabalho> {
  const raiz = await mkdtemp(join(tmpdir(), 'conversor-fila-'));
  return {
    id,
    pasta: { raiz, entrada: join(raiz, 'entrada'), saida: join(raiz, 'saida') },
    nomeEntrada: 'entrada.png',
    tamanhoEntrada: 10,
    de: 'png',
    para: 'webp',
    opcoes: {},
    engine,
    nomeSaida: 'saida.webp',
    mimeSaida: 'image/webp',
  };
}

function coleta(fila: Fila, id: string): Evento[] {
  const vistos: Evento[] = [];
  fila.ouve(id, (e) => vistos.push(e));
  return vistos;
}

const ID = 'af3dd0b9-fae0-4eda-b1ce-d136212aeef6';

describe('Fila', () => {
  it('leva um trabalho do registro à conclusão, relatando na ordem', async () => {
    const fila = new Fila(1);
    fila.registra(ID);
    const vistos = coleta(fila, ID);

    const engine = engineFalsa(async (t, r) => {
      r.etapas([
        { id: 'a', rotulo: 'A', peso: 1 },
        { id: 'b', rotulo: 'B', peso: 1 },
      ]);
      r.andou('a', 1);
      r.andou('b', 0.5);
      await writeFile(t.saida, 'saida');
    });

    fila.enfileira(await pedido(engine, ID));
    await vi.waitFor(() => expect(fila.estadoDe(ID)).toBe('concluido'));

    const tipos = vistos.map((e) => e.tipo);
    expect(tipos.indexOf('etapas')).toBeLessThan(tipos.indexOf('progresso'));
    expect(tipos.at(-1)).toBe('concluido');

    // A última fração é 1, e só chega a 1 no fim.
    const fracoes = vistos.filter((e) => e.tipo === 'progresso').map((e) => e.fracao);
    expect(fracoes.at(-1)).toBe(1);
    expect(fracoes.filter((f) => f === 1)).toHaveLength(1);
    expect(fila.saidaDe(ID)?.nome).toBe('saida.webp');
  });

  it('entrega o histórico a quem se inscreve depois, inclusive já concluído', async () => {
    // É o caso real: a interface cria o trabalho, manda os bytes e só então abre o canal. Uma
    // conversão rápida termina nesse intervalo, e sem histórico a barra nunca apareceria.
    const fila = new Fila(1);
    fila.registra(ID);
    const engine = engineFalsa(async (t, r) => {
      r.etapas([{ id: 'a', rotulo: 'A', peso: 1 }]);
      r.andou('a', 1);
      await writeFile(t.saida, 'x');
    });
    fila.enfileira(await pedido(engine, ID));
    await vi.waitFor(() => expect(fila.estadoDe(ID)).toBe('concluido'));

    const atrasado = coleta(fila, ID);
    expect(atrasado.map((e) => e.tipo)).toContain('etapas');
    expect(atrasado.at(-1)?.tipo).toBe('concluido');
  });

  it('respeita o limite de paralelismo', async () => {
    const fila = new Fila(2);
    let emVoo = 0;
    let pico = 0;
    const solta: (() => void)[] = [];
    const engine = engineFalsa(async (t) => {
      emVoo++;
      pico = Math.max(pico, emVoo);
      await new Promise<void>((r) => solta.push(r));
      emVoo--;
      await writeFile(t.saida, 'x');
    });

    const ids = ['1', '2', '3', '4', '5'].map((n) => ID.slice(0, -1) + n);
    for (const id of ids) {
      fila.registra(id);
      fila.enfileira(await pedido(engine, id));
    }
    await vi.waitFor(() => expect(solta.length).toBe(2));
    expect(fila.ocupacao).toEqual({ rodando: 2, esperando: 3 });

    // Soltar as duas em voo faz a fila puxar as próximas duas, que voltam a esperar aqui. Então
    // é preciso drenar até o fim, e não só uma vez — o primeiro esboço deste teste soltava uma
    // rodada e concluía que a fila tinha travado.
    for (let volta = 0; volta < 10 && fila.ocupacao.rodando + fila.ocupacao.esperando > 0; volta++) {
      while (solta.length) solta.pop()!();
      await new Promise((r) => setTimeout(r, 10));
    }
    await vi.waitFor(() => expect(fila.ocupacao).toEqual({ rodando: 0, esperando: 0 }), { timeout: 3000 });
    for (const id of ids) expect(fila.estadoDe(id), `${id} não concluiu`).toBe('concluido');
    // O ponto do teste: nunca passou de 2 ao mesmo tempo, com 5 na fila.
    expect(pico).toBe(2);
  });

  it('cancela de verdade: o sinal chega à engine', async () => {
    const fila = new Fila(1);
    fila.registra(ID);
    let sinalVisto: AbortSignal | undefined;
    const engine = engineFalsa(async (t) => {
      sinalVisto = t.sinal;
      await new Promise((_, rejeita) => t.sinal.addEventListener('abort', () => rejeita(t.sinal.reason)));
    });
    fila.enfileira(await pedido(engine, ID));
    await vi.waitFor(() => expect(sinalVisto).toBeDefined());

    expect(fila.cancela(ID)).toBe(true);
    expect(sinalVisto!.aborted).toBe(true);
    expect(fila.estadoDe(ID)).toBe('cancelado');
    // Cancelar duas vezes não é erro, mas também não faz nada.
    expect(fila.cancela(ID)).toBe(false);
  });

  it('passa adiante a mensagem de ErroDeEntrada e esconde bug nosso', async () => {
    const fila = new Fila(1);

    fila.registra(ID);
    const vistosEntrada = coleta(fila, ID);
    fila.enfileira(
      await pedido(
        engineFalsa(async () => {
          throw new ErroDeEntrada('entrada-ilegivel', 'O arquivo parece truncado.', 'detalhe técnico');
        }),
        ID,
      ),
    );
    await vi.waitFor(() => expect(fila.estadoDe(ID)).toBe('falhou'));
    const falhaEntrada = vistosEntrada.find((e) => e.tipo === 'falhou');
    expect(falhaEntrada?.erro.codigo).toBe('entrada-ilegivel');
    expect(falhaEntrada?.erro.mensagem).toBe('O arquivo parece truncado.');

    const outro = ID.slice(0, -1) + '9';
    fila.registra(outro);
    const vistosBug = coleta(fila, outro);
    fila.enfileira(
      await pedido(
        engineFalsa(async () => {
          throw new TypeError('cannot read properties of undefined');
        }),
        outro,
      ),
    );
    await vi.waitFor(() => expect(fila.estadoDe(outro)).toBe('falhou'));
    const falhaBug = vistosBug.find((e) => e.tipo === 'falhou');
    // Dizer "arquivo inválido" quando o defeito é nosso manda o usuário procurar problema onde
    // não tem.
    expect(falhaBug?.erro.codigo).toBe('erro-interno');
    expect(falhaBug?.erro.mensagem).toMatch(/problema do conversor, não do seu arquivo/);
    expect(falhaBug?.erro.detalhe).toMatch(/TypeError/);
  });

  it('ignora relato de engine que não declarou etapas', async () => {
    // Bug da engine, e não motivo para derrubar a conversão do usuário.
    const fila = new Fila(1);
    fila.registra(ID);
    const vistos = coleta(fila, ID);
    fila.enfileira(
      await pedido(
        engineFalsa(async (t, r) => {
          r.andou('inexistente', 0.5);
          await writeFile(t.saida, 'x');
        }),
        ID,
      ),
    );
    await vi.waitFor(() => expect(fila.estadoDe(ID)).toBe('concluido'));
    expect(vistos.some((e) => e.tipo === 'falhou')).toBe(false);
  });

  it('a fração nunca regride, evento a evento', async () => {
    const fila = new Fila(1);
    fila.registra(ID);
    const vistos = coleta(fila, ID);
    fila.enfileira(
      await pedido(
        engineFalsa(async (t, r) => {
          r.etapas([
            { id: 'a', rotulo: 'A', peso: 1 },
            { id: 'b', rotulo: 'B', peso: 9 },
          ]);
          r.andou('b', 0.9);
          r.andou('a', 0.1); // fora de ordem, de propósito
          for (let i = 0; i <= 10; i++) r.andou('b', i / 10);
          await writeFile(t.saida, 'x');
        }),
        ID,
      ),
    );
    await vi.waitFor(() => expect(fila.estadoDe(ID)).toBe('concluido'));

    let anterior = -1;
    for (const e of vistos) {
      if (e.tipo !== 'progresso') continue;
      expect(e.fracao, 'a barra andou para trás').toBeGreaterThanOrEqual(anterior);
      anterior = e.fracao;
    }
  });
});
