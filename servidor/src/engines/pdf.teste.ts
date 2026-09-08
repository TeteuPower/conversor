import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFiumLibrary } from '@hyzyla/pdfium';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Etapa } from '@conversor/nucleo';
import { enginePdf, escolhePaginas } from './pdf.js';
import { montaPdf, mmParaPontos, type ImagemParaPdf } from '../pdf/escritor.js';
import type { Relator, Tarefa } from './registro.js';

/**
 * O laço fechado.
 *
 * O escritor de PDF é escrito à mão (ver o cabeçalho de `../pdf/escritor.ts`), e o argumento para
 * escrevê-lo em vez de usar biblioteca só se sustenta se o resultado for CONFERIDO. É isto que
 * estes testes fazem: montam o PDF com o escritor e o leem de volta com o pdfium, que é o
 * mecanismo de PDF do Chrome. Se o arquivo estiver malformado — tabela de referências com o byte
 * errado, comprimento de fluxo torto, matriz invertida —, o pdfium não abre ou devolve pixel
 * errado, e o teste cai.
 *
 * O que estes testes NÃO provam é que outros leitores concordam com o pdfium. Para isso existe o
 * teste de ponta a ponta, que converte um PDF produzido pelo PRÓPRIO Chrome — assim o escritor
 * não é o único elo da corrente que este projeto controla.
 */

/* ==================== apoio ==================== */

/** Uma cor chapada como imagem pronta para embutir, sem perda. */
async function chapado(
  cor: { r: number; g: number; b: number },
  largura = 120,
  altura = 90,
): Promise<ImagemParaPdf> {
  const cru = await sharp({ create: { width: largura, height: altura, channels: 3, background: cor } })
    .raw()
    .toBuffer();
  return { dados: new Uint8Array(cru), largura, altura, tipo: 'rgb', dpi: 96 };
}

/** A mesma cor como JPEG, para o caminho de passagem direta. */
async function chapadoJpeg(
  cor: { r: number; g: number; b: number },
  largura = 120,
  altura = 90,
): Promise<{ paraPdf: ImagemParaPdf; bytes: Buffer }> {
  const bytes = await sharp({ create: { width: largura, height: altura, channels: 3, background: cor } })
    .jpeg({ quality: 92 })
    .toBuffer();
  return {
    paraPdf: { dados: new Uint8Array(bytes), largura, altura, tipo: 'jpeg', dpi: 96 },
    bytes,
  };
}

function pdfDe(imagens: readonly ImagemParaPdf[], pagina: 'imagem' | 'a4' = 'imagem'): Buffer {
  return Buffer.concat(montaPdf(imagens, { pagina, margem: mmParaPontos(10), produtor: 'teste' }));
}

let lib: PDFiumLibrary;
beforeAll(async () => {
  lib = await PDFiumLibrary.init();
});

/** Rasteriza uma página e devolve a cor do pixel do meio. */
async function corDoMeio(pdf: Buffer, pagina = 0): Promise<{ r: number; g: number; b: number }> {
  const doc = await lib.loadDocument(pdf);
  try {
    const bitmap = await doc.getPage(pagina).render({ scale: 1, render: 'bitmap' });
    const meio = (Math.floor(bitmap.height / 2) * bitmap.width + Math.floor(bitmap.width / 2)) * 4;
    /*
     * RGBA, nesta ordem.
     *
     * O bitmap nativo do pdfium é BGRA, e a primeira versão deste ajudante trocou os canais por
     * causa disso — e via azul onde havia vermelho. O wrapper `@hyzyla/pdfium` já entrega RGBA,
     * que é também o que a engine assume ao passar o buffer ao sharp. Os dois concordam, e os
     * testes de cor abaixo são o que garante que continuem concordando.
     */
    return { r: bitmap.data[meio]!, g: bitmap.data[meio + 1]!, b: bitmap.data[meio + 2]! };
  } finally {
    doc.destroy();
  }
}

const perto = (a: number, b: number, tolerancia = 6) => Math.abs(a - b) <= tolerancia;

/** Uma tarefa de mentira, gravando num diretório temporário. */
async function tarefa(
  entrada: Buffer,
  de: string,
  para: string,
  opcoes: Tarefa['opcoes'] = {},
  nomeOriginal = `prova.${de}`,
): Promise<{ t: Tarefa; leSaida: () => Promise<Buffer> }> {
  const raiz = await mkdtemp(join(tmpdir(), 'conversor-pdf-'));
  const caminhoEntrada = join(raiz, 'entrada');
  const caminhoSaida = join(raiz, 'saida');
  await writeFile(caminhoEntrada, entrada);
  const base = nomeOriginal.replace(/\.[^.]+$/, '');
  return {
    t: {
      id: 'teste',
      entrada: caminhoEntrada,
      saida: caminhoSaida,
      de,
      para,
      opcoes,
      nomeOriginal,
      nomeSaida: `${base}.${para}`,
      sinal: new AbortController().signal,
    },
    leSaida: () => readFile(caminhoSaida),
  };
}

interface Relatado {
  readonly relator: Relator;
  readonly etapas: Etapa[];
  readonly fracoes: { etapa: string; dentro: number; detalhe?: string }[];
  readonly avisos: string[];
}

function relatorio(): Relatado {
  const etapas: Etapa[] = [];
  const fracoes: { etapa: string; dentro: number; detalhe?: string }[] = [];
  const avisos: string[] = [];
  return {
    etapas,
    fracoes,
    avisos,
    relator: {
      etapas: (e) => etapas.push(...e),
      andou: (etapa, dentro = 0, detalhe) =>
        fracoes.push({ etapa, dentro, ...(detalhe ? { detalhe } : {}) }),
      avisa: (texto) => avisos.push(texto),
    },
  };
}

/* ==================== escolhePaginas ==================== */

describe('escolhePaginas', () => {
  it('sem seleção, todas', () => {
    expect(escolhePaginas(undefined, 3)).toEqual([0, 1, 2]);
    expect(escolhePaginas('todas', 3)).toEqual([0, 1, 2]);
    expect(escolhePaginas('  TUDO ', 2)).toEqual([0, 1]);
    expect(escolhePaginas('*', 1)).toEqual([0]);
  });

  it('página única e faixa, contando de 1 para o usuário e de 0 por dentro', () => {
    expect(escolhePaginas('1', 5)).toEqual([0]);
    expect(escolhePaginas('3', 5)).toEqual([2]);
    expect(escolhePaginas('2-4', 5)).toEqual([1, 2, 3]);
  });

  it('lista com faixas, ordenada e sem repetição', () => {
    expect(escolhePaginas('4,1,2-3,1', 9)).toEqual([0, 1, 2, 3]);
  });

  it('faixa invertida é lida como a intenção óbvia', () => {
    // `5-2` é erro de digitação com intenção clara. Descartar seria pedantismo.
    expect(escolhePaginas('5-2', 9)).toEqual([1, 2, 3, 4]);
  });

  it('descarta o que passa do fim, em silêncio', () => {
    // Quem escreve `1-999` num PDF de 3 páginas está pedindo "até o fim".
    expect(escolhePaginas('1-999', 3)).toEqual([0, 1, 2]);
    expect(escolhePaginas('0', 3)).toEqual([]);
    expect(escolhePaginas('7,9', 3)).toEqual([]);
  });

  it('ignora lixo sem explodir', () => {
    expect(escolhePaginas('abc', 3)).toEqual([]);
    expect(escolhePaginas('2,abc,3', 3)).toEqual([1, 2]);
    expect(escolhePaginas('', 3)).toEqual([0, 1, 2]);
  });
});

/* ==================== o escritor, lido de volta ==================== */

describe('escritor de PDF, conferido pelo pdfium', () => {
  it('uma imagem vira um PDF de uma página, com a cor certa', async () => {
    const pdf = pdfDe([await chapado({ r: 0x2f, g: 0x6f, b: 0xff })]);
    expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');

    const doc = await lib.loadDocument(pdf);
    expect(doc.getPageCount()).toBe(1);
    doc.destroy();

    const cor = await corDoMeio(pdf);
    expect(
      perto(cor.r, 0x2f) && perto(cor.g, 0x6f) && perto(cor.b, 0xff),
      JSON.stringify(cor),
    ).toBe(true);
  });

  it('três imagens viram três páginas, cada uma com a sua cor', async () => {
    const cores = [
      { r: 0xff, g: 0x00, b: 0x00 },
      { r: 0x00, g: 0xff, b: 0x00 },
      { r: 0x00, g: 0x00, b: 0xff },
    ];
    const pdf = pdfDe(await Promise.all(cores.map((c) => chapado(c))));
    const doc = await lib.loadDocument(pdf);
    expect(doc.getPageCount()).toBe(3);
    doc.destroy();

    for (const [i, esperada] of cores.entries()) {
      const cor = await corDoMeio(pdf, i);
      expect(
        perto(cor.r, esperada.r) && perto(cor.g, esperada.g) && perto(cor.b, esperada.b),
        `página ${i + 1}: esperava ${JSON.stringify(esperada)}, veio ${JSON.stringify(cor)}`,
      ).toBe(true);
    }
  });

  it('o JPEG embutido é o MESMO arquivo, byte a byte', async () => {
    // É a razão de este escritor existir em vez de uma biblioteca. Se o JPEG for decodificado e
    // recomprimido em algum ponto, esta busca falha.
    const { paraPdf, bytes } = await chapadoJpeg({ r: 0xff, g: 0xc4, b: 0x00 });
    const pdf = pdfDe([paraPdf]);
    expect(pdf.includes(bytes), 'os bytes do JPEG original não estão dentro do PDF').toBe(true);
    const doc = await lib.loadDocument(pdf);
    expect(doc.getPageCount()).toBe(1);
    doc.destroy();
  });

  it('a página acompanha a imagem, na densidade dela', async () => {
    // 120 px a 96 DPI são 90 pontos exatos; 90 px são 67,5, e o rasterizador arredonda para
    // baixo. Escala 1 no pdfium é 1 pixel por ponto.
    const pdf = pdfDe([await chapado({ r: 0x11, g: 0x22, b: 0x33 }, 120, 90)]);
    const doc = await lib.loadDocument(pdf);
    const bitmap = await doc.getPage(0).render({ scale: 1, render: 'bitmap' });
    doc.destroy();
    expect(bitmap.width).toBe(90);
    expect(bitmap.height).toBe(67);
  });

  it('em A4, a imagem cabe inteira e a folha gira para acompanhá-la', async () => {
    const deitada = pdfDe([await chapado({ r: 1, g: 2, b: 3 }, 200, 100)], 'a4');
    const doc1 = await lib.loadDocument(deitada);
    const b1 = await doc1.getPage(0).render({ scale: 1, render: 'bitmap' });
    doc1.destroy();
    // A4 deitada: 842 x 595 pontos, arredondados pelo rasterizador.
    expect(b1.width).toBeGreaterThan(b1.height);
    expect(perto(b1.width, 842, 2)).toBe(true);

    const empe = pdfDe([await chapado({ r: 1, g: 2, b: 3 }, 100, 200)], 'a4');
    const doc2 = await lib.loadDocument(empe);
    const b2 = await doc2.getPage(0).render({ scale: 1, render: 'bitmap' });
    doc2.destroy();
    expect(b2.height).toBeGreaterThan(b2.width);
    expect(perto(b2.height, 842, 2)).toBe(true);
  });

  it('recusa montar um PDF sem imagem nenhuma', () => {
    expect(() => montaPdf([], { pagina: 'imagem', margem: 0, produtor: 'x' })).toThrow(
      /pelo menos uma imagem/,
    );
  });
});

/* ==================== a engine ==================== */

describe('engine de PDF', () => {
  it('está disponível e declara as duas direções', async () => {
    const d = await enginePdf.detecta();
    expect(d.disponivel).toBe(true);
    const arestas = enginePdf.arestas(d);
    const disponivel = (de: string, para: string) =>
      arestas.some((a) => a.de === de && a.para === para && a.disponivel);
    expect(disponivel('pdf', 'png')).toBe(true);
    expect(disponivel('pdf', 'txt')).toBe(true);
    expect(disponivel('png', 'pdf')).toBe(true);
    expect(disponivel('jpg', 'pdf')).toBe(true);
  });

  it('rasteriza uma página só, direto na imagem pedida', async () => {
    const pdf = pdfDe([await chapado({ r: 0x2f, g: 0x6f, b: 0xff }, 200, 150)]);
    const { t, leSaida } = await tarefa(pdf, 'pdf', 'png');
    const r = relatorio();
    const resultado = await enginePdf.converte(t, r.relator);

    // Sem sobrescrita de nome: uma página cabe num PNG.
    expect(resultado.nomeSaida).toBeUndefined();
    expect(resultado.diagnostico?.empacotadoEmZip).toBe(false);

    const png = await leSaida();
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe('png');
    const { dominant } = await sharp(png).stats();
    expect(
      perto(dominant.r, 0x2f, 12) && perto(dominant.b, 0xff, 12),
      JSON.stringify(dominant),
    ).toBe(true);
  });

  it('a DPI manda no tamanho da saída', async () => {
    const pdf = pdfDe([await chapado({ r: 9, g: 9, b: 9 }, 96, 96)]); // 96px a 96dpi = 72pt
    for (const [dpi, esperado] of [
      [72, 72],
      [150, 150],
      [300, 300],
    ] as const) {
      const { t, leSaida } = await tarefa(pdf, 'pdf', 'png', { dpi });
      await enginePdf.converte(t, relatorio().relator);
      const meta = await sharp(await leSaida()).metadata();
      expect(perto(meta.width!, esperado, 2), `dpi ${dpi}: veio ${meta.width}`).toBe(true);
    }
  });

  it('mais de uma página vira um .zip, e o nome da saída muda junto', async () => {
    const pdf = pdfDe([
      await chapado({ r: 0xff, g: 0, b: 0 }),
      await chapado({ r: 0, g: 0xff, b: 0 }),
      await chapado({ r: 0, g: 0, b: 0xff }),
    ]);
    const { t, leSaida } = await tarefa(pdf, 'pdf', 'png', {}, 'relatório.pdf');
    const r = relatorio();
    const resultado = await enginePdf.converte(t, r.relator);

    // Sem isto, o download sairia `relatório.png` com um ZIP dentro.
    expect(resultado.nomeSaida).toBe('relatório-paginas.zip');
    expect(resultado.mimeSaida).toBe('application/zip');
    expect(resultado.diagnostico?.paginasConvertidas).toBe(3);
    expect(r.avisos.join(' ')).toMatch(/não cabem num PNG.*\.zip/);

    const zip = await leSaida();
    expect(zip.subarray(0, 2).toString('latin1')).toBe('PK');
    // Os nomes de dentro vêm do nome de SAÍDA, com a extensão do destino.
    //
    // A busca é feita nos BYTES em UTF-8, e não no texto: o ZIP guarda o nome em UTF-8 (é o que
    // o bit 11 do cabeçalho declara), então "relatório" está no arquivo como `relat\xc3\xb3rio`.
    // A primeira versão deste teste procurava o texto decodificado como latin1 e nunca acharia
    // nome com acento — falharia sem que houvesse defeito nenhum.
    for (const n of ['relatório-p1.png', 'relatório-p2.png', 'relatório-p3.png']) {
      expect(zip.includes(Buffer.from(n, 'utf-8')), `não achei "${n}" no pacote`).toBe(true);
    }
  });

  it('escolher uma página no meio devolve aquela página, e não a primeira', async () => {
    const pdf = pdfDe([
      await chapado({ r: 0xff, g: 0, b: 0 }),
      await chapado({ r: 0, g: 0xff, b: 0 }),
      await chapado({ r: 0, g: 0, b: 0xff }),
    ]);
    const { t, leSaida } = await tarefa(pdf, 'pdf', 'png', { paginas: '2' });
    const resultado = await enginePdf.converte(t, relatorio().relator);
    expect(resultado.nomeSaida).toBeUndefined();

    const { dominant } = await sharp(await leSaida()).stats();
    expect(dominant.g).toBeGreaterThan(200);
    expect(dominant.r).toBeLessThan(60);
  });

  it('recusa uma seleção que não alcança página nenhuma', async () => {
    const pdf = pdfDe([await chapado({ r: 1, g: 1, b: 1 })]);
    const { t } = await tarefa(pdf, 'pdf', 'png', { paginas: '9' });
    await expect(enginePdf.converte(t, relatorio().relator)).rejects.toThrow(/não alcança/);
  });

  it('o progresso conta página por página, e é exato', async () => {
    const pdf = pdfDe(await Promise.all([1, 2, 3, 4].map(() => chapado({ r: 5, g: 5, b: 5 }))));
    const { t } = await tarefa(pdf, 'pdf', 'png');
    const r = relatorio();
    await enginePdf.converte(t, r.relator);

    expect(r.etapas.map((e) => e.id)).toEqual(['abrir', 'paginas', 'gravar']);
    const detalhes = r.fracoes.filter((f) => f.detalhe?.startsWith('página')).map((f) => f.detalhe);
    expect(detalhes).toEqual(['página 1 de 4', 'página 2 de 4', 'página 3 de 4', 'página 4 de 4']);
    // Dentro da etapa das páginas, a fração é exatamente k/n.
    const dentro = r.fracoes.filter((f) => f.etapa === 'paginas').map((f) => f.dentro);
    expect(dentro).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('recusa com explicação quando as páginas passam do teto de memória, em vez de morrer', async () => {
    /*
     * O caminho de recusa existe para trocar a morte por falta de memória por uma mensagem que
     * diz o que fazer. Testá-lo de verdade exigiria alocar centenas de megabytes — teste lento e
     * mal-educado com quem roda a CI. Daí `CONVERSOR_TETO_PAGINAS_MB`: aqui ele desce a um
     * milésimo de megabyte, e três páginas de cor chapada já passam.
     *
     * A variável não é um gancho de teste disfarçado: ela serve a quem tem memória de sobra e
     * quer rasterizar um PDF grande de uma vez.
     */
    const anterior = process.env.CONVERSOR_TETO_PAGINAS_MB;
    process.env.CONVERSOR_TETO_PAGINAS_MB = '0.001';
    try {
      const pdf = pdfDe(
        await Promise.all([1, 2, 3].map(() => chapado({ r: 3, g: 3, b: 3 }, 300, 300))),
      );
      const { t } = await tarefa(pdf, 'pdf', 'png', { dpi: 200 });
      const erro = await enginePdf.converte(t, relatorio().relator).catch((e) => e);

      expect(erro).toBeInstanceOf(Error);
      expect(erro.codigo).toBe('saida-grande-demais');
      // A mensagem tem de dizer o que fazer, e citar a resolução que o usuário escolheu.
      expect(erro.message).toMatch(/Baixe a resolução/);
      expect(erro.message).toMatch(/200 DPI/);
      expect(erro.message).toMatch(/de 3 páginas/);
    } finally {
      if (anterior === undefined) delete process.env.CONVERSOR_TETO_PAGINAS_MB;
      else process.env.CONVERSOR_TETO_PAGINAS_MB = anterior;
    }
  });

  it('o teto volta ao padrão sem a variável, e um PDF normal passa longe dele', async () => {
    expect(process.env.CONVERSOR_TETO_PAGINAS_MB).toBeUndefined();
    const pdf = pdfDe(
      await Promise.all([1, 2, 3].map(() => chapado({ r: 3, g: 3, b: 3 }, 300, 300))),
    );
    const { t } = await tarefa(pdf, 'pdf', 'png', { dpi: 200 });
    await expect(enginePdf.converte(t, relatorio().relator)).resolves.toBeDefined();
  });

  it('recusa um arquivo que não é PDF, com mensagem para gente', async () => {
    const { t } = await tarefa(Buffer.from('isto nao e um pdf'), 'pdf', 'png');
    await expect(enginePdf.converte(t, relatorio().relator)).rejects.toThrow(/não ser um PDF/);
  });

  it('imagem para PDF: PNG entra sem perda, JPEG entra como JPEG', async () => {
    const png = await sharp({
      create: { width: 80, height: 60, channels: 3, background: { r: 0x2f, g: 0x6f, b: 0xff } },
    })
      .png()
      .toBuffer();
    const a = await tarefa(png, 'png', 'pdf');
    const rp = await enginePdf.converte(a.t, relatorio().relator);
    // A regra: origem sem perda entra sem perda. Ver `OpcoesPdf.pdfSemPerda`.
    expect(rp.diagnostico?.embutidoComo).toMatch(/sem perda/);

    const jpg = await sharp({
      create: { width: 80, height: 60, channels: 3, background: { r: 0x2f, g: 0x6f, b: 0xff } },
    })
      .jpeg({ quality: 90 })
      .toBuffer();
    const b = await tarefa(jpg, 'jpg', 'pdf');
    const rj = await enginePdf.converte(b.t, relatorio().relator);
    expect(rj.diagnostico?.embutidoComo).toMatch(/byte a byte/);

    // E o PDF dos dois abre com a cor certa.
    for (const ler of [a.leSaida, b.leSaida]) {
      const cor = await corDoMeio(await ler());
      expect(perto(cor.r, 0x2f, 10) && perto(cor.b, 0xff, 10), JSON.stringify(cor)).toBe(true);
    }
  });

  it('imagem com alfa vira PDF achatado, e avisa', async () => {
    const comAlfa = await sharp({
      create: { width: 60, height: 60, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const { t, leSaida } = await tarefa(comAlfa, 'png', 'pdf', { fundo: '#FFC400' });
    const r = relatorio();
    await enginePdf.converte(t, r.relator);
    expect(r.avisos.join(' ')).toMatch(/PDF não guarda transparência/);
    const cor = await corDoMeio(await leSaida());
    expect(
      perto(cor.r, 0xff, 8) && perto(cor.g, 0xc4, 8) && perto(cor.b, 0, 8),
      JSON.stringify(cor),
    ).toBe(true);
  });

  it('não avisa de transparência quando o canal alfa existe mas nada é transparente', async () => {
    /*
     * O caso que produzia aviso falso: um PNG rasterizado de SVG tem canal alfa e é inteiramente
     * opaco. `metadata().hasAlpha` responde `true` — ele fala do CANAL, não dos pixels —, e a
     * aplicação avisava "o que era transparente ficou branco" sobre uma imagem em que nada era
     * transparente. Aviso que não corresponde ao arquivo gasta a credibilidade dos que
     * correspondem.
     */
    const opacoComCanal = await sharp({
      create: {
        width: 60,
        height: 60,
        channels: 4,
        background: { r: 0x2f, g: 0x6f, b: 0xff, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    expect(
      (await sharp(opacoComCanal).metadata()).hasAlpha,
      'a prova precisa ter canal alfa',
    ).toBe(true);

    const { t } = await tarefa(opacoComCanal, 'png', 'pdf');
    const r = relatorio();
    await enginePdf.converte(t, r.relator);
    expect(r.avisos.join(' ')).not.toMatch(/transparência/);
  });

  it('PDF para texto: lê o que é texto e avisa quando não há nenhum', async () => {
    // O PDF montado aqui é só imagem — não carrega texto, de propósito.
    const pdf = pdfDe([await chapado({ r: 1, g: 2, b: 3 })]);
    const { t, leSaida } = await tarefa(pdf, 'pdf', 'txt');
    const r = relatorio();
    const resultado = await enginePdf.converte(t, r.relator);

    expect(resultado.diagnostico?.paginasComTexto).toBe(0);
    expect(r.avisos.join(' ')).toMatch(/digitalização|reconhecimento de caracteres/);

    const texto = await leSaida();
    // BOM no começo, para o Bloco de Notas não trocar os acentos.
    expect(texto.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(texto.toString('utf-8')).toMatch(/--- página 1 ---/);
    expect(texto.toString('utf-8')).toMatch(/\(sem texto\)/);
  });

  it('cancelar interrompe no meio das páginas', async () => {
    const pdf = pdfDe(
      await Promise.all([1, 2, 3, 4, 5, 6].map(() => chapado({ r: 7, g: 7, b: 7 }, 400, 300))),
    );
    const controlador = new AbortController();
    const { t } = await tarefa(pdf, 'pdf', 'png');
    const comSinal: Tarefa = { ...t, sinal: controlador.signal };

    const r = relatorio();
    const emVoo = enginePdf.converte(comSinal, {
      ...r.relator,
      andou: (etapa, dentro, detalhe) => {
        r.relator.andou(etapa, dentro, detalhe);
        if (detalhe === 'página 2 de 6') controlador.abort();
      },
    });
    await expect(emVoo).rejects.toThrow();
    // Parou antes do fim: sem o `throwIfAborted` no laço, ele rasterizaria as seis.
    const vistas = r.fracoes.filter((f) => f.detalhe?.startsWith('página')).length;
    expect(vistas).toBeLessThan(6);
  });
});
