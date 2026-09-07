import { describe, expect, it } from 'vitest';
import type { Saida } from '@conversor/nucleo';
import {
  ehAtivo,
  ehFinal,
  filaVazia,
  progressoDoConjunto,
  prontosParaConverter,
  reduz,
  type Acao,
  type EstadoFila,
  type ItemFila,
  type NovoArquivo,
} from './fila.js';

/**
 * Um `File` de mentira. `new File([...])` funciona no ambiente do vitest, mas construir um de 8 MB
 * só para testar a média ponderada seria desperdício — e o redutor só olha `name` e `size`.
 */
function arquivo(nome: string, tamanho: number): File {
  return { name: nome, size: tamanho, lastModified: 1, type: 'image/png' } as File;
}

function novo(nome: string, tamanho = 1000, para = 'webp', engine = 'imagem'): NovoArquivo {
  return { arquivo: arquivo(nome, tamanho), de: 'png', para, engine };
}

const SAIDA: Saida = { nome: 'a.webp', tamanho: 500, mime: 'image/webp', url: '/api/x' };

/** Aplica ações em sequência, para o teste ler como o uso real. */
function corre(inicial: EstadoFila, ...acoes: Acao[]): EstadoFila {
  return acoes.reduce(reduz, inicial);
}

const primeiro = (e: EstadoFila): ItemFila => e.itens[0]!;

describe('fila', () => {
  it('acrescenta preservando a ordem e dando índice de entrada', () => {
    const e = corre(filaVazia, { tipo: 'acrescenta', arquivos: [novo('a.png'), novo('b.png')] });
    expect(e.itens.map((i) => i.arquivo.name)).toEqual(['a.png', 'b.png']);
    expect(e.itens.map((i) => i.indiceDeEntrada)).toEqual([0, 1]);
    expect(e.totalJaEntrou).toBe(2);
  });

  it('continua contando entre lotes — o escalonamento depende disso', () => {
    let e = corre(filaVazia, { tipo: 'acrescenta', arquivos: [novo('a.png')] });
    e = corre(e, { tipo: 'acrescenta', arquivos: [novo('b.png')] });
    expect(e.itens[1]!.indiceDeEntrada).toBe(1);
  });

  it('leva um item do começo ao fim', () => {
    const e = corre(
      filaVazia,
      { tipo: 'acrescenta', arquivos: [novo('a.png')] },
      { tipo: 'comeca', id: '0-a.png-1000-1' },
      { tipo: 'anda', id: '0-a.png-1000-1', fracao: 0.5, rotulo: 'Convertendo' },
      { tipo: 'conclui', id: '0-a.png-1000-1', saida: SAIDA },
    );
    expect(primeiro(e).estado).toBe('concluido');
    expect(primeiro(e).fracao).toBe(1);
    expect(primeiro(e).saida).toEqual(SAIDA);
  });

  it('ignora relato atrasado que chega depois do fim', () => {
    // O SSE e o worker não param no mesmo instante em que a interface muda de tela.
    const id = '0-a.png-1000-1';
    const e = corre(
      filaVazia,
      { tipo: 'acrescenta', arquivos: [novo('a.png')] },
      { tipo: 'comeca', id },
      { tipo: 'conclui', id, saida: SAIDA },
      { tipo: 'anda', id, fracao: 0.3, rotulo: 'Convertendo' },
      { tipo: 'falha', id, erro: { codigo: 'x', mensagem: 'atrasado' } },
    );
    expect(primeiro(e).estado).toBe('concluido');
    expect(primeiro(e).fracao).toBe(1);
    expect(primeiro(e).erro).toBeUndefined();
  });

  it('não deixa a fração regredir', () => {
    // Segunda linha de defesa: envio e conversão são dois canais e podem chegar fora de ordem.
    const id = '0-a.png-1000-1';
    const e = corre(
      filaVazia,
      { tipo: 'acrescenta', arquivos: [novo('a.png')] },
      { tipo: 'comeca', id },
      { tipo: 'anda', id, fracao: 0.7, rotulo: 'Convertendo' },
      { tipo: 'anda', id, fracao: 0.2, rotulo: 'Enviando' },
    );
    expect(primeiro(e).fracao).toBeCloseTo(0.7, 5);
  });

  it('não empilha aviso repetido', () => {
    // O servidor reproduz o histórico para quem se inscreve atrasado.
    const id = '0-a.png-1000-1';
    const e = corre(
      filaVazia,
      { tipo: 'acrescenta', arquivos: [novo('a.png')] },
      { tipo: 'avisa', id, texto: 'transparência achatada' },
      { tipo: 'avisa', id, texto: 'transparência achatada' },
      { tipo: 'avisa', id, texto: 'outra coisa' },
    );
    expect(primeiro(e).avisos).toEqual(['transparência achatada', 'outra coisa']);
  });

  it('devolve um item concluído à fila quando as opções mudam', () => {
    // Sem isto, mexer na qualidade de um arquivo já convertido não fazia nada visível: o cartão
    // seguia mostrando "Pronto" com o arquivo antigo e o botão de converter desabilitado.
    const id = '0-a.png-1000-1';
    let e = corre(
      filaVazia,
      { tipo: 'acrescenta', arquivos: [novo('a.png')] },
      { tipo: 'comeca', id },
      { tipo: 'conclui', id, saida: SAIDA },
    );
    expect(prontosParaConverter(e.itens)).toHaveLength(0);

    e = corre(e, { tipo: 'ajusta-opcoes', id, opcoes: { qualidade: 40 } });
    expect(primeiro(e).estado).toBe('aguardando');
    expect(primeiro(e).saida).toBeUndefined();
    expect(primeiro(e).fracao).toBe(0);
    expect(primeiro(e).opcoes.qualidade).toBe(40);
    expect(prontosParaConverter(e.itens)).toHaveLength(1);
  });

  it('devolve à fila também ao trocar o destino', () => {
    const id = '0-a.png-1000-1';
    let e = corre(
      filaVazia,
      { tipo: 'acrescenta', arquivos: [novo('a.png')] },
      { tipo: 'comeca', id },
      { tipo: 'conclui', id, saida: SAIDA },
    );
    e = corre(e, { tipo: 'escolhe-destino', id, para: 'avif', engine: 'imagem' });
    expect(primeiro(e).estado).toBe('aguardando');
    expect(primeiro(e).para).toBe('avif');
  });

  it('não mexe em item que está em voo', () => {
    const id = '0-a.png-1000-1';
    const e = corre(
      filaVazia,
      { tipo: 'acrescenta', arquivos: [novo('a.png')] },
      { tipo: 'comeca', id },
      { tipo: 'escolhe-destino', id, para: 'avif', engine: 'imagem' },
      { tipo: 'ajusta-opcoes', id, opcoes: { qualidade: 10 } },
    );
    expect(primeiro(e).para).toBe('webp');
    expect(primeiro(e).opcoes.qualidade).toBeUndefined();
  });

  it('limpar não tira quem está convertendo', () => {
    // Tirar da lista quem está em voo deixaria a conversão rodando sem ninguém para vê-la.
    let e = corre(filaVazia, { tipo: 'acrescenta', arquivos: [novo('a.png'), novo('b.png')] });
    e = corre(e, { tipo: 'comeca', id: '0-a.png-1000-1' }, { tipo: 'limpa-tudo' });
    expect(e.itens.map((i) => i.arquivo.name)).toEqual(['a.png']);
  });

  it('devolve o MESMO objeto quando a ação não muda nada', () => {
    // Há muitos relatos por segundo com vários arquivos em voo; um objeto novo a cada um
    // repintaria a lista inteira à toa.
    const e = corre(filaVazia, { tipo: 'acrescenta', arquivos: [novo('a.png')] });
    expect(reduz(e, { tipo: 'anda', id: 'inexistente', fracao: 0.5, rotulo: 'x' })).toBe(e);
  });
});

describe('progressoDoConjunto', () => {
  it('pondera pelo tamanho, não pela contagem', () => {
    // Um ícone de 4 kB junto de uma foto de 8 MB: média simples levaria a barra a 50% em meio
    // segundo e depois ficaria quase parada, descrevendo mal o que falta.
    let e = corre(filaVazia, {
      tipo: 'acrescenta',
      arquivos: [novo('icone.png', 4_000), novo('foto.png', 8_000_000)],
    });
    e = corre(
      e,
      { tipo: 'comeca', id: '0-icone.png-4000-1' },
      { tipo: 'comeca', id: '1-foto.png-8000000-1' },
      { tipo: 'conclui', id: '0-icone.png-4000-1', saida: SAIDA },
    );
    // O ícone é 0,05% do peso: o conjunto quase não andou.
    expect(progressoDoConjunto(e.itens).fracao).toBeLessThan(0.01);
    expect(progressoDoConjunto(e.itens).ativos).toBe(1);
  });

  it('dá piso a arquivo de tamanho zero, para ele não desaparecer da média', () => {
    let e = corre(filaVazia, { tipo: 'acrescenta', arquivos: [novo('vazio.png', 0)] });
    e = corre(e, { tipo: 'comeca', id: '0-vazio.png-0-1' });
    expect(Number.isFinite(progressoDoConjunto(e.itens).fracao)).toBe(true);
  });

  it('é zero quando não há nada em voo nem concluído', () => {
    const e = corre(filaVazia, { tipo: 'acrescenta', arquivos: [novo('a.png')] });
    expect(progressoDoConjunto(e.itens)).toEqual({ fracao: 0, ativos: 0 });
  });
});

describe('classificação de estado', () => {
  it('separa final de ativo sem sobreposição', () => {
    for (const estado of ['concluido', 'falhou', 'cancelado'] as const) {
      expect(ehFinal(estado)).toBe(true);
      expect(ehAtivo(estado)).toBe(false);
    }
    for (const estado of ['enviando', 'na-fila', 'convertendo'] as const) {
      expect(ehAtivo(estado)).toBe(true);
      expect(ehFinal(estado)).toBe(false);
    }
    expect(ehAtivo('aguardando')).toBe(false);
    expect(ehFinal('aguardando')).toBe(false);
  });
});
