import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { ETAPAS_FUNDO, type OpcoesFundo, type ResultadoFundo } from '@conversor/nucleo';
import { inferemascara } from './inferencia.js';
import { caixaDoAssunto, descontamina, encolhe, fracaoDeBorda, suaviza } from './refino.js';
import { PADRAO, definicao } from './modelo.js';

/**
 * O caminho inteiro: arquivo entra, primeiro plano e máscara saem.
 *
 * Daqui para a frente quem manda é o navegador: trocar o fundo, passar o pincel e exportar
 * acontecem lá, sem voltar ao servidor. O porquê está no cabeçalho de `nucleo/src/fundo.ts`; o
 * porquê de serem DOIS arquivos, e não um PNG RGBA, está na etapa de gravação mais abaixo.
 */

export interface RelatorFundo {
  (etapa: string, dentro: number, detalhe?: string): void;
  avisa?: (texto: string) => void;
}

export interface EntradaPipeline {
  readonly entrada: string;
  readonly saida: string;
  readonly opcoes: OpcoesFundo;
  readonly sinal: AbortSignal;
}

/** Teto de pixels. Ver o comentário no corpo — o número tem motivo. */
const MAX_PIXELS = 40_000_000;

export async function removeFundo(
  { entrada, saida, opcoes, sinal }: EntradaPipeline,
  relata: RelatorFundo,
): Promise<ResultadoFundo> {
  const modeloId = opcoes.modelo ?? PADRAO;
  const d = definicao(modeloId);
  if (!d) throw new ErroDeImagem('modelo-desconhecido', `Não conheço o modelo "${modeloId}".`);

  /* ---------- ler ---------- */
  relata('ler', 0);
  const bytes = await readFile(entrada);
  sinal.throwIfAborted();

  const fonte = sharp(bytes, { limitInputPixels: false });
  let meta: sharp.Metadata;
  try {
    meta = await fonte.metadata();
  } catch (e) {
    throw new ErroDeImagem(
      'entrada-ilegivel',
      'Não deu para ler esta imagem. O arquivo pode estar truncado, ou a extensão pode não ' +
        'corresponder ao conteúdo.',
      (e as Error).message,
    );
  }
  const l = meta.width ?? 0;
  const a = meta.height ?? 0;
  if (!l || !a) {
    throw new ErroDeImagem('sem-dimensao', 'Este arquivo não declara largura e altura.');
  }

  // O teto existe por memória, não por política. Os campos de cor da descontaminação são
  // Float32Array de 3 canais: são 12 bytes por pixel só neles, mais 12 de outros, e a 40 MP isso
  // já passa de 1 GB. Acima disto o processo morreria sem explicação, o que é bem pior do que
  // uma mensagem dizendo o que fazer.
  if (l * a > MAX_PIXELS) {
    throw new ErroDeImagem(
      'imagem-grande-demais',
      `Esta imagem tem ${(((l * a) / 1e6) | 0)} megapixels, e o limite é ${MAX_PIXELS / 1e6}. ` +
        'Reduza antes na aba de conversão — o modelo trabalha em 1024 × 1024 de todo jeito, ' +
        'então acima disso não há detalhe a ganhar na máscara.',
    );
  }

  const rgbBuf = await fonte.clone().removeAlpha().toColorspace('srgb').raw().toBuffer();
  const rgb = new Uint8Array(rgbBuf.buffer, rgbBuf.byteOffset, rgbBuf.byteLength);
  relata('ler', 1, `${l} × ${a}`);
  sinal.throwIfAborted();

  /* ---------- modelo ---------- */
  relata('preparar', 1);
  const mascara = await inferemascara(modeloId, rgb, l, a, (f, detalhe) => {
    relata('modelo', f, detalhe);
  });
  sinal.throwIfAborted();
  relata('modelo', 1);

  /* ---------- ajustes na máscara ---------- */
  relata('mascara', 0);
  let alfa = mascara.alfa;
  if (opcoes.encolher && opcoes.encolher > 0) alfa = encolhe(alfa, l, a, Math.min(opcoes.encolher, 12));
  if (opcoes.suavizar && opcoes.suavizar > 0) alfa = suaviza(alfa, l, a, Math.min(opcoes.suavizar, 24));
  relata('mascara', 1);
  sinal.throwIfAborted();

  /* ---------- descontaminar ---------- */
  relata('descontaminar', 0);
  if (opcoes.descontaminar !== false) {
    descontamina(rgb, alfa, l, a);
  }
  relata('descontaminar', 1);
  sinal.throwIfAborted();

  /* ---------- gravar ---------- */
  relata('gravar', 0);

  /*
   * Saem DOIS arquivos, e não um PNG RGBA. A razão é o pincel, e ela é sutil o bastante para
   * merecer o parágrafo.
   *
   * O canvas do navegador guarda pixel com alfa PRÉ-MULTIPLICADO. Num pixel com alfa zero, a cor
   * é multiplicada por zero e some — sem volta. Se o recorte viesse como um RGBA só, tudo o que
   * o modelo apagou chegaria ao navegador com a cor perdida, e o pincel de RESTAURAR revelaria
   * preto em vez da foto. O usuário pediu o pincel; então o formato tem de servir ao pincel.
   *
   * Mandando o primeiro plano OPACO e a máscara à parte, nada é multiplicado por zero: o
   * navegador tem a foto inteira e a máscara inteira, e o pincel só mexe na segunda. De quebra,
   * cada arquivo é uma imagem válida por si — dá para olhar a máscara para depurar.
   *
   * `compressionLevel: 6` e não 9: estes arquivos são consumidos pelo navegador em seguida, não
   * arquivados. Medido na engine de imagem, o 9 gasta tempo para tirar bytes que ninguém guarda.
   * `palette: false` porque indexar destruiria a gradação de alfa que existe justamente para
   * preservar a borda macia.
   */
  const frente = await sharp(Buffer.from(rgb.buffer, rgb.byteOffset, rgb.byteLength), {
    raw: { width: l, height: a, channels: 3 },
  })
    .png({ compressionLevel: 6, palette: false })
    .toBuffer();
  await writeFile(saida, frente);

  // `toColourspace('b-w')` de novo, pelo mesmo motivo da volta da máscara em `inferencia.ts`: sem
  // ele o sharp promove um canal para três, e a máscara sairia como PNG RGB — três vezes maior,
  // dizendo a mesma coisa em triplicata. Medido: 68 kB contra 30 kB numa máscara de 960 × 960.
  const mascaraPng = await sharp(Buffer.from(alfa.buffer, alfa.byteOffset, alfa.byteLength), {
    raw: { width: l, height: a, channels: 1 },
  })
    .toColourspace('b-w')
    .png({ compressionLevel: 6, palette: false })
    .toBuffer();
  await writeFile(caminhoDaMascara(saida), mascaraPng);

  relata('gravar', 1);

  const caixa = caixaDoAssunto(alfa, l, a);
  const borda = fracaoDeBorda(alfa);

  if (caixa[2] >= l * 0.995 && caixa[3] >= a * 0.995) {
    relata.avisa?.(
      'O modelo marcou quase a imagem inteira como assunto. Se não era isso, provavelmente não ' +
        'há um objeto destacado do fundo — o pincel resolve mais rápido que tentar de novo.',
    );
  }

  return {
    recorteUrl: '',
    mascaraUrl: '',
    largura: l,
    altura: a,
    resolucaoDoModelo: mascara.resolucaoDoModelo,
    modelo: modeloId,
    provedor: mascara.provedor,
    msModelo: Math.round(mascara.ms),
    caixa,
    fracaoDeBorda: borda,
  };
}

/**
 * Onde fica a máscara, dado o caminho da saída.
 *
 * Ao lado do arquivo principal, na mesma pasta do trabalho, para sumir junto quando a varredura
 * recolher a pasta inteira. É função e não constante porque quem manda no caminho é o
 * `Armazenamento`, não este arquivo.
 */
export const caminhoDaMascara = (saida: string): string => `${saida}.mascara.png`;

/** As etapas, para o relator declarar antes de começar. */
export const ETAPAS = ETAPAS_FUNDO;

export class ErroDeImagem extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
    readonly detalhe?: string,
  ) {
    super(mensagem);
    this.name = 'ErroDeImagem';
  }
}
