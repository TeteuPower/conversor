import { describe, expect, it } from 'vitest';
import { FORMATOS, ROTULO_FAMILIA, formatoDe, formatoDoNome } from './formatos.js';
import { bytes, diferencaTamanho, percentual, trocaExtensao } from './humano.js';
import { FAMILIAS } from './tipos.js';

describe('catálogo', () => {
  it('não tem extensão canônica repetida', () => {
    const vistas = new Set<string>();
    for (const f of FORMATOS) {
      expect(vistas.has(f.ext), `ext repetida: ${f.ext}`).toBe(false);
      vistas.add(f.ext);
    }
  });

  it('não tem apelido colidindo com outra coisa', () => {
    // Um apelido que já é ext canônica de outro formato faria formatoDe() devolver o formato
    // errado dependendo da ordem do arquivo — o tipo de bug que só aparece meses depois.
    const canonicas = new Set(FORMATOS.map((f) => f.ext));
    const apelidos = new Map<string, string>();
    for (const f of FORMATOS) {
      for (const a of f.apelidos ?? []) {
        expect(canonicas.has(a), `apelido "${a}" de ${f.ext} já é ext canônica`).toBe(false);
        expect(apelidos.has(a), `apelido "${a}" repetido (${apelidos.get(a)} e ${f.ext})`).toBe(false);
        apelidos.set(a, f.ext);
      }
    }
  });

  it('cobre as dez famílias, cada uma com rótulo', () => {
    for (const familia of FAMILIAS) {
      expect(ROTULO_FAMILIA[familia], `família sem rótulo: ${familia}`).toBeTruthy();
      expect(FORMATOS.some((f) => f.familia === familia), `família vazia: ${familia}`).toBe(true);
    }
  });

  it('descreve todo formato — a legenda do seletor sai daqui', () => {
    for (const f of FORMATOS) {
      expect(f.descricao.length, `descrição curta em ${f.ext}`).toBeGreaterThan(20);
      expect(f.mime, `mime faltando em ${f.ext}`).toMatch(/^[a-z]+\//);
      expect(f.ext, `ext deve ser minúscula e sem ponto: ${f.ext}`).toMatch(/^[a-z0-9]+$/);
    }
  });
});

describe('formatoDe', () => {
  it('normaliza o que chega de nome de arquivo real', () => {
    for (const entrada of ['png', 'PNG', '.png', ' .PNG ']) {
      expect(formatoDe(entrada)?.ext).toBe('png');
    }
  });

  it('resolve apelido para a canônica', () => {
    expect(formatoDe('jpeg')?.ext).toBe('jpg');
    expect(formatoDe('tif')?.ext).toBe('tiff');
    expect(formatoDe('cr2')?.ext).toBe('raw');
  });

  it('devolve undefined para o que não conhece', () => {
    expect(formatoDe('xyz')).toBeUndefined();
    expect(formatoDe('')).toBeUndefined();
  });
});

describe('formatoDoNome', () => {
  it('lê a extensão do nome', () => {
    expect(formatoDoNome('foto.jpg')?.ext).toBe('jpg');
    expect(formatoDoNome('C:/coisas/logo da empresa.PNG')?.ext).toBe('png');
  });

  it('trata a extensão dupla do tar', () => {
    // "gz" sozinho é um fluxo comprimido; ".tar.gz" é um pacote. A extensão simples mentiria.
    expect(formatoDoNome('backup.tar.gz')?.ext).toBe('gz');
    expect(formatoDoNome('backup.tgz')?.ext).toBe('gz');
    expect(formatoDoNome('backup.tar.xz')?.ext).toBe('xz');
  });

  it('não confunde ponto no meio do nome com extensão', () => {
    expect(formatoDoNome('sem extensão')).toBeUndefined();
    expect(formatoDoNome('v1.2.3.png')?.ext).toBe('png');
  });
});

describe('humano', () => {
  it('mostra tamanho em base 1000, como o Explorer', () => {
    expect(bytes(0)).toBe('0 B');
    expect(bytes(999)).toBe('999 B');
    expect(bytes(1000)).toBe('1,0 kB');
    expect(bytes(83_826)).toBe('83,8 kB');
    expect(bytes(1_400_000)).toBe('1,4 MB');
    // Acima de 100 na unidade, casa decimal só faz ruído.
    expect(bytes(842_700_000)).toBe('843 MB');
  });

  it('nunca mostra 100% antes do arquivo estar pronto', () => {
    expect(percentual(0.999)).toBe('99%');
    expect(percentual(0.9999)).toBe('99%');
    expect(percentual(1)).toBe('100%');
    expect(percentual(0)).toBe('0%');
  });

  it('troca extensão preservando ponto no meio do nome', () => {
    expect(trocaExtensao('relatório.final.docx', 'pdf')).toBe('relatório.final.pdf');
    expect(trocaExtensao('C:/pasta/foto.jpg', 'webp')).toBe('foto.webp');
    expect(trocaExtensao('sem-extensão', 'png')).toBe('sem-extensão.png');
  });

  it('descreve crescer e encolher em tom neutro', () => {
    // PNG para BMP cresce sempre, e é a resposta certa para quem pediu BMP.
    expect(diferencaTamanho(100, 50)).toBe('50% menor');
    expect(diferencaTamanho(100, 300)).toBe('200% maior');
    expect(diferencaTamanho(100, 101)).toBe('praticamente do mesmo tamanho');
  });
});
