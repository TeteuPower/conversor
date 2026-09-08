import { deflateSync } from 'node:zlib';

/**
 * Um escritor de PDF, curto e sem dependência.
 *
 * Ele faz uma coisa só: uma página por imagem. Não escreve texto, não desenha vetor, não edita
 * PDF que já existe — para isso a resposta certa é o Ghostscript, e ele está declarado no marco
 * seguinte. O que este arquivo cobre é o caso comum de `png/jpg/tiff → pdf`, e cobre exatamente.
 *
 * ---
 *
 * Por que escrever em vez de usar `pdf-lib`, que é maduro e faria isto.
 *
 * A razão de peso é o **JPEG passar direto**. Um JPEG embutido num PDF com `/DCTDecode` é o mesmo
 * JPEG, byte a byte: nada é decodificado, nada é recomprimido, e a foto dentro do PDF é
 * exatamente a que entrou. Isso é uma linha de código quando se escreve o PDF, e depende de a
 * biblioteca expor esse caminho quando não se escreve. Passando por decodificação, uma foto de
 * 12 MP viraria 36 MB de pixel cru na memória e sairia recomprimida — mais lenta, maior e pior.
 *
 * A razão secundária: o PDF gerado aqui é conferido por um leitor de PDF de verdade nos testes
 * (o pdfium rasteriza de volta e as cores são comparadas), então o risco de escrever à mão fica
 * medido em vez de assumido.
 *
 * ---
 *
 * O formato, para quem for mexer. Um PDF é uma lista de objetos numerados, uma tabela dizendo em
 * que byte cada um começa, e um rodapé apontando para a tabela. A estrutura mínima é:
 *
 *   1  Catalog  ──►  2  Pages  ──►  4,7,10…  Page  ──►  conteúdo + XObject da imagem
 *
 * As coordenadas são em PONTOS, com 72 pontos por polegada, e a origem no canto INFERIOR
 * esquerdo — não no superior, como em tela. É a fonte de erro mais comum aqui.
 */

/** Uma imagem já codificada, pronta para ser embutida. */
export interface ImagemParaPdf {
  /** Os bytes como vão para dentro do PDF, sem transformação. */
  readonly dados: Uint8Array;
  readonly largura: number;
  readonly altura: number;
  /**
   * `jpeg` embute com `/DCTDecode` — os bytes são um JPEG inteiro e passam direto.
   * `rgb` embute com `/FlateDecode` — os bytes são RGB cru, 8 bits por canal, sem alfa.
   */
  readonly tipo: 'jpeg' | 'rgb';
  /**
   * Pontos por polegada da imagem, para calcular o tamanho da página quando ela acompanha a
   * imagem. 96 é o padrão de tela; a densidade declarada no arquivo tem precedência.
   */
  readonly dpi: number;
}

export type TamanhoPagina = 'imagem' | 'a4' | 'carta';

export interface OpcoesEscritor {
  readonly pagina: TamanhoPagina;
  /** Margem em pontos. Só usada quando a página não acompanha a imagem. */
  readonly margem: number;
  /** Quem produziu o arquivo. Vai no dicionário de informações. */
  readonly produtor: string;
}

const PONTOS_POR_MM = 72 / 25.4;

/** Em pontos. A4 e Carta nas medidas da norma. */
const FOLHAS: Readonly<Record<'a4' | 'carta', readonly [number, number]>> = {
  a4: [595.276, 841.89],
  carta: [612, 792],
};

/**
 * Monta o PDF. Uma página por imagem, na ordem.
 *
 * Devolve as partes sem concatenar, pelo mesmo motivo do escritor de ZIP: uma foto de 12 MP
 * embutida sem perda passa de 30 MB, e materializar o arquivo inteiro na memória para depois
 * copiá-lo ao disco dobraria o pico sem necessidade. Quem grava usa `gravaPartes`.
 */
export function montaPdf(
  imagens: readonly ImagemParaPdf[],
  opcoes: OpcoesEscritor,
): Uint8Array<ArrayBuffer>[] {
  if (imagens.length === 0) throw new Error('Um PDF precisa de pelo menos uma imagem.');

  const partes: Uint8Array<ArrayBuffer>[] = [];
  /** Deslocamento em bytes de cada objeto, indexado pelo número do objeto. */
  const inicioDoObjeto: number[] = [];
  let deslocamento = 0;

  const escreve = (texto: string | Uint8Array<ArrayBuffer>) => {
    const bytes = typeof texto === 'string' ? bin(texto) : texto;
    partes.push(bytes);
    deslocamento += bytes.length;
  };

  /**
   * O cabeçalho leva um comentário com bytes acima de 127.
   *
   * Não é enfeite: é o que a norma manda para o arquivo ser tratado como binário. Sem ele, um
   * intermediário que decida "isto é texto" pode converter CRLF e corromper os fluxos de imagem
   * — e o PDF passa a abrir com as páginas em branco.
   */
  escreve('%PDF-1.4\n');
  escreve(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const objeto = (numero: number, corpo: string, fluxo?: Uint8Array<ArrayBuffer>) => {
    inicioDoObjeto[numero] = deslocamento;
    escreve(`${numero} 0 obj\n${corpo}\n`);
    if (fluxo) {
      escreve('stream\n');
      escreve(fluxo);
      escreve('\nendstream\n');
    }
    escreve('endobj\n');
  };

  // A numeração é fixa e calculada de antemão: 1 catálogo, 2 lista de páginas, 3 informações, e
  // depois três objetos por página (a página, o conteúdo, a imagem). O PDF exige que as
  // referências existam antes de a tabela ser escrita, e um esquema fixo evita um segundo passe.
  const numeroDaPagina = (i: number) => 4 + i * 3;
  const numeroDoConteudo = (i: number) => 5 + i * 3;
  const numeroDaImagem = (i: number) => 6 + i * 3;
  const totalDeObjetos = 3 + imagens.length * 3;

  objeto(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objeto(
    2,
    `<< /Type /Pages /Count ${imagens.length} /Kids [${imagens
      .map((_, i) => `${numeroDaPagina(i)} 0 R`)
      .join(' ')}] >>`,
  );
  objeto(3, `<< /Producer ${literal(opcoes.produtor)} /CreationDate ${literal(dataPdf())} >>`);

  imagens.forEach((img, i) => {
    const { paginaL, paginaA, x, y, l, a } = encaixa(img, opcoes);

    objeto(
      numeroDaPagina(i),
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${nf(paginaL)} ${nf(paginaA)}] ` +
        `/Resources << /XObject << /Im0 ${numeroDaImagem(i)} 0 R >> >> ` +
        `/Contents ${numeroDoConteudo(i)} 0 R >>`,
    );

    /*
     * O conteúdo da página.
     *
     * `cm` é a matriz que posiciona e escala a imagem. Uma imagem em PDF é desenhada sempre num
     * quadrado de 1 × 1 na origem, então a matriz [l 0 0 a x y] a estica para `l` × `a` pontos e
     * a move para (x, y) — e (x, y) é medido do canto INFERIOR esquerdo.
     *
     * `q` e `Q` salvam e restauram o estado gráfico. Com uma imagem por página eles não são
     * estritamente necessários, mas sem eles a matriz vazaria para qualquer coisa acrescentada
     * depois, e é o tipo de bomba que explode na mão de quem for estender este arquivo.
     */
    const conteudo = bin(`q\n${nf(l)} 0 0 ${nf(a)} ${nf(x)} ${nf(y)} cm\n/Im0 Do\nQ\n`);
    objeto(numeroDoConteudo(i), `<< /Length ${conteudo.length} >>`, conteudo);

    const comum =
      `<< /Type /XObject /Subtype /Image /Width ${img.largura} /Height ${img.altura} ` +
      '/ColorSpace /DeviceRGB /BitsPerComponent 8 ';
    if (img.tipo === 'jpeg') {
      // Os bytes do JPEG entram inteiros. É o caminho que justifica este arquivo existir.
      objeto(
        numeroDaImagem(i),
        `${comum}/Filter /DCTDecode /Length ${img.dados.length} >>`,
        comoBytes(img.dados),
      );
    } else {
      const comprimido = deflateSync(img.dados, { level: 9 });
      objeto(
        numeroDaImagem(i),
        `${comum}/Filter /FlateDecode /Length ${comprimido.length} >>`,
        comoBytes(comprimido),
      );
    }
  });

  /*
   * A tabela de referências cruzadas.
   *
   * Cada linha tem EXATAMENTE 20 bytes — dez dígitos de deslocamento, cinco de geração, uma letra
   * de estado, e dois de fim de linha. A norma é rígida nisso porque leitores localizam a linha
   * por multiplicação, sem varrer. Uma linha de 19 ou 21 bytes gera "arquivo corrompido" num
   * leitor e silêncio noutro, o que é o pior modo de falhar possível.
   */
  const inicioDaTabela = deslocamento;
  escreve(`xref\n0 ${totalDeObjetos + 1}\n`);
  escreve('0000000000 65535 f \n');
  for (let n = 1; n <= totalDeObjetos; n++) {
    const inicio = inicioDoObjeto[n];
    if (inicio === undefined) throw new Error(`O objeto ${n} não foi escrito.`);
    escreve(`${String(inicio).padStart(10, '0')} 00000 n \n`);
  }
  escreve(
    `trailer\n<< /Size ${totalDeObjetos + 1} /Root 1 0 R /Info 3 0 R >>\n` +
      `startxref\n${inicioDaTabela}\n%%EOF\n`,
  );

  return partes;
}

/**
 * Onde a imagem fica na página, e de que tamanho.
 *
 * Com `pagina: 'imagem'`, a página fica do tamanho exato da imagem — sem margem branca que
 * ninguém pediu. O tamanho em pontos vem da DPI: 1200 px a 96 DPI dão 900 pontos, que são 12,5
 * polegadas. Usar 72 DPI aqui faria uma captura de tela de 1920 px virar uma página de 68 cm.
 *
 * Com `a4` ou `carta`, a imagem é encaixada por CONTER — inteira dentro da folha, proporção
 * intacta, centralizada. Cobrir cortaria parte da imagem, e cortar sem avisar é pior que deixar
 * margem.
 */
function encaixa(
  img: ImagemParaPdf,
  opcoes: OpcoesEscritor,
): { paginaL: number; paginaA: number; x: number; y: number; l: number; a: number } {
  const emPontos = (px: number) => (px * 72) / img.dpi;

  if (opcoes.pagina === 'imagem') {
    const l = emPontos(img.largura);
    const a = emPontos(img.altura);
    return { paginaL: l, paginaA: a, x: 0, y: 0, l, a };
  }

  const [folhaL, folhaA] = FOLHAS[opcoes.pagina];
  // A folha gira para acompanhar a imagem: uma foto deitada numa A4 em pé sobraria metade da
  // página em branco, e girar é o que qualquer pessoa faria à mão.
  const deitada = img.largura > img.altura;
  const paginaL = deitada ? folhaA : folhaL;
  const paginaA = deitada ? folhaL : folhaA;

  const util = {
    l: Math.max(1, paginaL - 2 * opcoes.margem),
    a: Math.max(1, paginaA - 2 * opcoes.margem),
  };
  const escala = Math.min(util.l / img.largura, util.a / img.altura);
  const l = img.largura * escala;
  const a = img.altura * escala;
  return { paginaL, paginaA, x: (paginaL - l) / 2, y: (paginaA - a) / 2, l, a };
}

export const mmParaPontos = (mm: number): number => mm * PONTOS_POR_MM;

/* ==================== miudezas do formato ==================== */

/**
 * Texto para bytes, um byte por caractere.
 *
 * `latin1` e não `utf-8`: a sintaxe do PDF é de bytes, e os comprimentos declarados em `/Length`
 * contam bytes. Um acento no nome do produtor codificado em UTF-8 ocuparia dois bytes e
 * deslocaria toda a tabela de referências em um — e o arquivo abriria corrompido, ou não abriria.
 */
const bin = (texto: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(Buffer.from(texto, 'latin1'));

/** Vista de bytes sobre um Buffer, sem copiar. */
const comoBytes = (b: Uint8Array): Uint8Array<ArrayBuffer> =>
  new Uint8Array(b.buffer as ArrayBuffer, b.byteOffset, b.byteLength);

/**
 * Uma cadeia literal do PDF, entre parênteses.
 *
 * Parêntese e barra invertida têm de ser escapados: um `)` solto fecha a cadeia no meio e o resto
 * do dicionário passa a ser lido como sintaxe. Fora do ASCII imprimível vira `?`, porque este
 * escritor não embute o mapa de codificação que um nome com acento exigiria.
 */
const literal = (texto: string): string =>
  `(${texto.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^ -~]/g, '?')})`;

/**
 * Número para o PDF: até três casas, sem expoente e sem zero à direita.
 *
 * `toFixed` em vez de `String`, porque `String(1e-7)` dá `1e-7` e o PDF não tem notação
 * científica — um número assim é erro de sintaxe. Três casas em pontos são um quarto de
 * milésimo de polegada, muito além do que qualquer leitor distingue.
 */
const nf = (v: number): string => {
  const s = v.toFixed(3);
  return s.replace(/\.?0+$/, '') || '0';
};

/** A data no formato do PDF: `D:AAAAMMDDHHMMSS` com o fuso. */
function dataPdf(d = new Date()): string {
  const p = (n: number) => String(Math.abs(n)).padStart(2, '0');
  const minutos = -d.getTimezoneOffset();
  const sinal = minutos >= 0 ? '+' : '-';
  return (
    `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}` +
    `${sinal}${p(Math.floor(Math.abs(minutos) / 60))}'${p(Math.abs(minutos) % 60)}'`
  );
}
