import { mkdtemp, readdir, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Armazenamento, nomeSeguro } from './armazenamento.js';

const bases: string[] = [];
async function baseNova(): Promise<string> {
  const b = await mkdtemp(join(tmpdir(), 'conversor-teste-'));
  bases.push(b);
  return b;
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(bases.splice(0).map((b) => rm(b, { recursive: true, force: true })));
});

describe('pastaDe — a tranca contra travessia de caminho', () => {
  it('recusa tudo que não seja um UUID', async () => {
    const a = await Armazenamento.abre(60, await baseNova());
    // Sem esta recusa, GET /api/trabalhos/<isto>/saida seria leitura arbitrária de arquivo.
    for (const veneno of [
      '../../../etc/passwd',
      '..',
      '.',
      '..\\..\\Windows\\System32\\config\\SAM',
      'af3dd0b9-fae0-4eda-b1ce-d136212aeef6/../../..',
      '',
      'nao-e-uuid',
      'af3dd0b9fae04edab1ced136212aeef6',
    ]) {
      expect(a.pastaDe(veneno), `deixou passar: ${veneno}`).toBeUndefined();
    }
  });

  it('aceita UUID de verdade, em qualquer caixa', async () => {
    const a = await Armazenamento.abre(60, await baseNova());
    expect(a.pastaDe('af3dd0b9-fae0-4eda-b1ce-d136212aeef6')).toBeDefined();
    expect(a.pastaDe('AF3DD0B9-FAE0-4EDA-B1CE-D136212AEEF6')).toBeDefined();
  });

  it('monta os caminhos dentro da raiz, sempre', async () => {
    const base = await baseNova();
    const a = await Armazenamento.abre(60, base);
    const { id, pasta } = await a.novoTrabalho();
    expect(pasta.raiz.startsWith(base)).toBe(true);
    expect(pasta.entrada).toBe(join(pasta.raiz, 'entrada'));
    expect(a.pastaDe(id)?.raiz).toBe(pasta.raiz);
  });
});

describe('varredura', () => {
  it('apaga o que passou da validade e deixa o resto', async () => {
    const a = await Armazenamento.abre(1, await baseNova()); // 1 s de validade
    const velho = await a.novoTrabalho();
    const novo = await a.novoTrabalho();
    await writeFile(velho.pasta.entrada, 'x');
    await writeFile(novo.pasta.entrada, 'x');

    // Envelhece pelo mtime, que é de onde a varredura tira a idade — assim ela também recolhe o
    // que sobrou de uma execução anterior do servidor.
    const antes = new Date(Date.now() - 10_000);
    await utimes(velho.pasta.raiz, antes, antes);

    expect(await a.varre()).toBe(1);
    await expect(stat(velho.pasta.raiz)).rejects.toThrow();
    await expect(stat(novo.pasta.raiz)).resolves.toBeDefined();
  });

  it('não explode com pasta estranha na raiz', async () => {
    const base = await baseNova();
    const a = await Armazenamento.abre(1, base);
    await writeFile(join(base, 'coisa-que-nao-e-trabalho.txt'), 'x');
    expect(await a.varre()).toBe(0);
    expect(await readdir(base)).toContain('coisa-que-nao-e-trabalho.txt');
  });
});

describe('nomeSeguro', () => {
  it('preserva acento — é nome de gente, não de caminho', () => {
    expect(nomeSeguro('coração azul.png')).toBe('coração azul.png');
    expect(nomeSeguro('relatório final (v2).pdf')).toBe('relatório final (v2).pdf');
  });

  it('descarta qualquer pedaço de caminho', () => {
    expect(nomeSeguro('../../.ssh/id_rsa')).toBe('id_rsa');
    expect(nomeSeguro('C:\\Windows\\System32\\drivers\\etc\\hosts')).toBe('hosts');
    expect(nomeSeguro('/etc/passwd')).toBe('passwd');
  });

  it('tira o que quebraria o cabeçalho HTTP', () => {
    expect(nomeSeguro('a\r\nContent-Length: 0\r\n\r\nb.png')).not.toMatch(/[\r\n]/);
    expect(nomeSeguro('foto".png')).not.toContain('"');
    expect(nomeSeguro('a\u0000b.png')).toBe('ab.png');
  });

  it('escapa dos nomes de dispositivo do Windows', () => {
    // `CON.png` não grava no Windows, com ou sem extensão.
    expect(nomeSeguro('CON.png')).toBe('_CON.png');
    expect(nomeSeguro('nul')).toBe('_nul');
    expect(nomeSeguro('LPT1.txt')).toBe('_LPT1.txt');
    expect(nomeSeguro('constituicao.pdf')).toBe('constituicao.pdf');
  });

  it('nunca devolve vazio', () => {
    expect(nomeSeguro('')).toBe('arquivo');
    expect(nomeSeguro('...')).toBe('arquivo');
    expect(nomeSeguro('   ')).toBe('arquivo');
    expect(nomeSeguro('/')).toBe('arquivo');
  });

  it('limita o comprimento — sistema de arquivos tem teto', () => {
    expect(nomeSeguro('a'.repeat(500) + '.png').length).toBeLessThanOrEqual(180);
  });
});
