import { describe, expect, it } from 'vitest';
import { Progresso, estimaRestante } from './progresso.js';

const ETAPAS = [
  { id: 'ler', rotulo: 'Lendo', peso: 1 },
  { id: 'converter', rotulo: 'Convertendo', peso: 8 },
  { id: 'gravar', rotulo: 'Gravando', peso: 1 },
];

describe('Progresso', () => {
  it('reparte a fração pelos pesos declarados', () => {
    const p = new Progresso(ETAPAS);
    expect(p.em('ler', 0)).toBe(0);
    expect(p.em('ler', 1)).toBeCloseTo(0.1, 5);
    expect(p.em('converter', 0.5)).toBeCloseTo(0.5, 5);
    expect(p.em('gravar', 0)).toBeCloseTo(0.9, 5);
  });

  it('não anda para trás quando o relato chega fora de ordem', () => {
    const p = new Progresso(ETAPAS);
    p.em('converter', 0.75); // 0,7
    expect(p.em('ler', 0.2)).toBeCloseTo(0.7, 5);
    expect(p.fracao).toBeCloseTo(0.7, 5);
  });

  it('apara relato fora de faixa em vez de lançar erro', () => {
    // Uma engine que estima o total errado (quadro 1300 de 1200 previstos) não deve derrubar a
    // conversão por causa da barra.
    const p = new Progresso(ETAPAS);
    expect(p.em('converter', 1.4)).toBeCloseTo(0.9, 5);
    expect(new Progresso(ETAPAS).em('ler', -3)).toBe(0);
  });

  it('só chega a 1 em conclui(), nunca pelas etapas', () => {
    const p = new Progresso(ETAPAS);
    expect(p.em('gravar', 1)).toBe(0.999);
    expect(p.concluido).toBe(false);
    expect(p.conclui()).toBe(1);
    expect(p.concluido).toBe(true);
  });

  it('recusa etapa desconhecida — é erro de programação, não de dado', () => {
    const p = new Progresso(ETAPAS);
    expect(() => p.em('inexistente')).toThrow(/desconhecida/);
  });

  it('recusa declaração inválida na construção', () => {
    expect(() => new Progresso([])).toThrow(/pelo menos uma etapa/);
    expect(() => new Progresso([{ id: 'a', rotulo: 'A', peso: 0 }])).toThrow(/peso/);
    const repetida = [
      { id: 'a', rotulo: 'A', peso: 1 },
      { id: 'a', rotulo: 'A de novo', peso: 1 },
    ];
    expect(() => new Progresso(repetida)).toThrow(/mesmo id/);
  });

  it('atravessa uma conversão inteira sem regredir uma única vez', () => {
    const p = new Progresso(ETAPAS);
    let anterior = -1;
    for (const id of ['ler', 'converter', 'gravar']) {
      for (let i = 0; i <= 10; i++) {
        const f = p.em(id, i / 10);
        expect(f).toBeGreaterThanOrEqual(anterior);
        anterior = f;
      }
    }
    expect(p.conclui()).toBe(1);
  });
});

describe('estimaRestante', () => {
  it('cala a boca enquanto não há base para chutar', () => {
    expect(estimaRestante(0.01, 5000)).toBeUndefined();
    expect(estimaRestante(0.5, 100)).toBeUndefined();
    expect(estimaRestante(1, 5000)).toBeUndefined();
  });

  it('extrapola linear', () => {
    // 25% em 1 s, então faltam 3 s.
    expect(estimaRestante(0.25, 1000)).toBe(3000);
  });

  it('só cai, conforme o progresso avança em ritmo constante', () => {
    let anterior = Infinity;
    for (let f = 0.05; f < 1; f += 0.05) {
      const r = estimaRestante(f, f * 10_000)!;
      expect(r).toBeLessThanOrEqual(anterior);
      anterior = r;
    }
  });
});
