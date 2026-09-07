import { describe, expect, it } from 'vitest';
import { caixaDoAssunto, descontamina, encolhe, fracaoDeBorda, suaviza } from './refino.js';

/**
 * O teste da descontaminação usa verdade conhecida.
 *
 * Compõe-se uma imagem PELA equação `C = α·F + (1−α)·B`, com F, B e α escolhidos aqui. Assim se
 * sabe exatamente qual cor deveria voltar, e dá para MEDIR o erro em vez de olhar e achar bonito.
 *
 * O caso é o que mais dói na prática: assunto vermelho sobre fundo verde forte. Verde é o pior
 * fundo possível porque contamina no canal em que a pele e o cabelo têm menos energia, e a
 * auréola fica gritante quando o fundo vira branco.
 */

const L = 120;
const A = 120;
const FRENTE = [220, 40, 40] as const; // vermelho
const FUNDO = [0, 180, 0] as const; // verde forte

/** Disco com borda macia: alfa vai de 1 no centro a 0 fora, com rampa de 6 px. */
function cena(): { rgb: Uint8Array; alfa: Uint8Array } {
  const rgb = new Uint8Array(L * A * 3);
  const alfa = new Uint8Array(L * A);
  const cx = L / 2;
  const cy = A / 2;
  const raio = 30;
  const rampa = 6;

  for (let y = 0; y < A; y++) {
    for (let x = 0; x < L; x++) {
      const i = y * L + x;
      const dist = Math.hypot(x - cx, y - cy);
      const t = (raio - dist) / rampa;
      const A_ = t <= 0 ? 0 : t >= 1 ? 1 : t;
      alfa[i] = Math.round(A_ * 255);
      for (let c = 0; c < 3; c++) {
        rgb[i * 3 + c] = Math.round(A_ * FRENTE[c]! + (1 - A_) * FUNDO[c]!);
      }
    }
  }
  return { rgb, alfa };
}

/** Erro médio contra a cor verdadeira do primeiro plano, só nos pixels de borda macia. */
function erroNaBorda(rgb: Uint8Array, alfa: Uint8Array): number {
  let soma = 0;
  let conta = 0;
  for (let i = 0; i < alfa.length; i++) {
    const a = alfa[i]!;
    if (a <= 12 || a >= 242) continue;
    for (let c = 0; c < 3; c++) soma += Math.abs(rgb[i * 3 + c]! - FRENTE[c]!);
    conta += 3;
  }
  return conta ? soma / conta : 0;
}

describe('descontamina', () => {
  it('recupera a cor do primeiro plano na borda macia', () => {
    const { rgb, alfa } = cena();
    const antes = erroNaBorda(rgb, alfa);
    descontamina(rgb, alfa, L, A);
    const depois = erroNaBorda(rgb, alfa);

    // O antes é grande porque o pixel de borda É metade verde — é essa a auréola.
    expect(antes).toBeGreaterThan(30);
    // O depois tem de ser muito melhor. O limite é folgado de propósito: a estimativa local do
    // fundo é aproximada, e exigir erro quase zero prenderia o teste a detalhe de implementação.
    expect(depois).toBeLessThan(antes / 3);
  });

  it('tira o verde, que é o sintoma que se vê na tela', () => {
    const { rgb, alfa } = cena();
    // Excesso de verde sobre vermelho, nos pixels de borda: é o que faz o contorno parecer sujo.
    const verdeExcedente = (r: Uint8Array): number => {
      let soma = 0;
      let conta = 0;
      for (let i = 0; i < alfa.length; i++) {
        const a = alfa[i]!;
        if (a <= 60 || a >= 242) continue;
        soma += r[i * 3 + 1]! - r[i * 3]! / 5;
        conta++;
      }
      return soma / conta;
    };
    const antes = verdeExcedente(rgb);
    descontamina(rgb, alfa, L, A);
    const depois = verdeExcedente(rgb);
    expect(antes).toBeGreaterThan(40);
    expect(depois).toBeLessThan(antes / 4);
  });

  it('não mexe no que é opaco nem no que é vazio', () => {
    const { rgb, alfa } = cena();
    const copia = rgb.slice();
    descontamina(rgb, alfa, L, A);
    for (let i = 0; i < alfa.length; i++) {
      const a = alfa[i]!;
      if (a <= 5 || a >= 250) {
        for (let c = 0; c < 3; c++) {
          expect(rgb[i * 3 + c], `pixel ${i} canal ${c} com alfa ${a} foi alterado`).toBe(copia[i * 3 + c]);
        }
      }
    }
  });

  it('desiste em silêncio quando não há fundo puro para estimar', () => {
    // Assunto ocupando tudo: não há de onde tirar a cor do fundo, e inventar seria pior.
    const rgb = new Uint8Array(L * A * 3).fill(200);
    const alfa = new Uint8Array(L * A).fill(255);
    const copia = rgb.slice();
    expect(() => descontamina(rgb, alfa, L, A)).not.toThrow();
    expect(rgb).toEqual(copia);
  });

  it('aguenta imagem minúscula sem estourar índice', () => {
    for (const lado of [1, 2, 3]) {
      const rgb = new Uint8Array(lado * lado * 3).fill(120);
      const alfa = new Uint8Array(lado * lado).fill(128);
      alfa[0] = 0;
      expect(() => descontamina(rgb, alfa, lado, lado)).not.toThrow();
    }
  });
});

describe('ajustes da máscara', () => {
  it('encolhe come a borda, e só ela', () => {
    const alfa = new Uint8Array(L * A).fill(255);
    // zera a moldura, para haver borda
    for (let x = 0; x < L; x++) {
      alfa[x] = 0;
      alfa[(A - 1) * L + x] = 0;
    }
    for (let y = 0; y < A; y++) {
      alfa[y * L] = 0;
      alfa[y * L + L - 1] = 0;
    }
    const menor = encolhe(alfa, L, A, 2);
    expect(menor[2 * L + 2]).toBe(0); // a 2 px da moldura, comido
    expect(menor[(A / 2) * L + L / 2]).toBe(255); // o miolo continua inteiro
  });

  it('suavizar não inventa nem apaga o assunto', () => {
    const { alfa } = cena();
    const macio = suaviza(alfa, L, A, 3);
    expect(macio[(A / 2) * L + L / 2]).toBeGreaterThan(240); // centro segue opaco
    expect(macio[0]).toBeLessThan(15); // canto segue vazio
    expect(fracaoDeBorda(macio)).toBeGreaterThan(fracaoDeBorda(alfa)); // mais borda macia
  });

  it('a caixa do assunto encosta no disco, não na imagem toda', () => {
    const { alfa } = cena();
    const [x, y, l, a] = caixaDoAssunto(alfa, L, A);
    // O disco tem raio 30 no centro de uma imagem 120 x 120.
    expect(x).toBeGreaterThan(24);
    expect(y).toBeGreaterThan(24);
    expect(l).toBeLessThan(72);
    expect(a).toBeLessThan(72);
  });

  it('máscara vazia devolve a imagem inteira, em vez de caixa degenerada', () => {
    const vazia = new Uint8Array(L * A);
    expect(caixaDoAssunto(vazia, L, A)).toEqual([0, 0, L, A]);
  });
});
