import ort from 'onnxruntime-node';
import sharp from 'sharp';
import type { ProvedorExecucao } from '@conversor/nucleo';
import { sessao } from './modelo.js';

/**
 * Levar a imagem até o modelo e trazer a máscara de volta.
 *
 * ---
 *
 * **Sobre distorcer a imagem para entrar no modelo.** O BiRefNet recebe um quadrado fixo de
 * 1024 × 1024, e a foto quase nunca é quadrada. Há dois caminhos: encaixar mantendo a proporção,
 * com faixas vazias nas bordas, ou esticar para o quadrado e desfazer depois.
 *
 * Aqui se estica. Parece errado e não é: é assim que o modelo foi treinado, e é o que a
 * implementação de referência faz. Encaixar com faixas vazias entrega ao modelo uma imagem com
 * moldura preta que ele nunca viu no treino, e o resultado piora justamente na borda — que é o
 * que se está tentando acertar. A distorção é desfeita ao trazer a máscara de volta ao tamanho
 * original, e a máscara não guarda rastro dela.
 *
 * **Sobre a sigmoide.** A saída deste export são logitos, não probabilidade: medida na faixa de
 * 4,4 a 20,5, e sigmoide nenhuma passa de 1. Sem aplicar a sigmoide a máscara sai saturada em
 * branco e recorta a imagem inteira.
 */

export interface Mascara {
  /** Um byte por pixel, no tamanho ORIGINAL da imagem. */
  readonly alfa: Uint8Array;
  readonly largura: number;
  readonly altura: number;
  readonly provedor: ProvedorExecucao;
  readonly ms: number;
  readonly resolucaoDoModelo: number;
}

export interface RelatorInferencia {
  (fracao: number, detalhe?: string): void;
}

/**
 * Roda o modelo sobre os pixels crus e devolve a máscara no tamanho original.
 *
 * `rgb` é entrelaçado de 3 canais, com `l × a` pixels — o mesmo que sai de `sharp().raw()`.
 */
export async function inferemascara(
  modeloId: string,
  rgb: Uint8Array,
  l: number,
  a: number,
  relata?: RelatorInferencia,
): Promise<Mascara> {
  const { sessao: s, provedor, definicao: d } = await sessao(modeloId);
  const lado = d.entrada;

  relata?.(0.05, 'redimensionando');
  // Redimensiona com o sharp, e não à mão: ele faz a reamostragem em faixas, com filtro decente,
  // e um laço em JavaScript para 12 milhões de pixels custaria mais que a própria inferência.
  const pequena = await sharp(Buffer.from(rgb.buffer, rgb.byteOffset, rgb.byteLength), {
    raw: { width: l, height: a, channels: 3 },
  })
    .resize(lado, lado, { fit: 'fill', kernel: 'lanczos3' })
    .raw()
    .toBuffer();

  relata?.(0.15, 'normalizando');
  const n = lado * lado;
  const plano = new Float32Array(3 * n);
  // De entrelaçado (RGBRGB) para plano (RRR GGG BBB), normalizando no caminho. O modelo espera
  // NCHW, que é o formato plano.
  for (let c = 0; c < 3; c++) {
    const media = d.media[c]!;
    const desvio = d.desvio[c]!;
    const base = c * n;
    for (let i = 0; i < n; i++) {
      plano[base + i] = (pequena[i * 3 + c]! / 255 - media) / desvio;
    }
  }

  const nome = s.inputNames[0]!;
  const tipoEsperado = tipoDaEntrada(s);
  const entrada =
    tipoEsperado === 'float16'
      ? new ort.Tensor('float16', paraMeio(plano), [1, 3, lado, lado])
      : new ort.Tensor('float32', plano, [1, 3, lado, lado]);

  relata?.(0.25, 'encontrando o assunto');
  const inicio = performance.now();
  const saida = await s.run({ [nome]: entrada });
  const ms = performance.now() - inicio;

  // O BiRefNet devolve várias saídas em alguns exports; a última é sempre a máscara final, e as
  // anteriores são supervisão intermediária do treino.
  const chave = s.outputNames[s.outputNames.length - 1]!;
  const bruta = saida[chave];
  if (!bruta) throw new Error(`O modelo não devolveu a saída "${chave}".`);

  relata?.(0.85, 'montando a máscara');
  const dados = paraFloat32(bruta.data as ArrayLike<number>);
  const mascaraPequena = Buffer.allocUnsafe(n);
  if (d.precisaSigmoide) {
    for (let i = 0; i < n; i++) {
      const v = 1 / (1 + Math.exp(-dados[i]!));
      mascaraPequena[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
    }
  } else {
    for (let i = 0; i < n; i++) {
      const v = dados[i]!;
      mascaraPequena[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
    }
  }

  relata?.(0.95, 'voltando ao tamanho original');
  // `toColourspace('b-w')` antes do `raw()` não é enfeite: sem ele o sharp devolve TRÊS canais
  // aqui, promovendo a máscara de cinza para sRGB no meio do caminho. Isto custou uma
  // investigação: o buffer saía com o triplo do tamanho, cada índice passava a ler o pixel
  // errado, e o recorte vinha com o assunto apagado e o fundo mantido — sem erro nenhum, só o
  // resultado errado. A conferência logo abaixo existe para que, se o comportamento do sharp
  // mudar de novo, isso quebre alto e na hora em vez de virar recorte torto em silêncio.
  const grande = await sharp(mascaraPequena, { raw: { width: lado, height: lado, channels: 1 } })
    .resize(l, a, { fit: 'fill', kernel: 'lanczos3' })
    .toColourspace('b-w')
    .raw()
    .toBuffer();
  if (grande.length !== l * a) {
    throw new Error(
      `A máscara voltou com ${grande.length} bytes para ${l} × ${a} pixels ` +
        `(${(grande.length / (l * a)).toFixed(1)} canais). Era para ser um canal só.`,
    );
  }

  return {
    alfa: new Uint8Array(grande.buffer, grande.byteOffset, grande.byteLength),
    largura: l,
    altura: a,
    provedor,
    ms,
    resolucaoDoModelo: lado,
  };
}

/**
 * O tipo que o modelo espera na entrada.
 *
 * `inputMetadata` é uma união: só o ramo de tensor tem `type`. Medido nos dois pesos deste
 * catálogo, a resposta é `float32` mesmo com peso fp16 — o ONNX guarda os PESOS em meia precisão
 * e mantém a fronteira em float32. O ramo fp16 abaixo existe para o export que não fizer isso, e
 * não é caminho morto: é o que evita uma falha silenciosa se um peso novo entrar no catálogo.
 */
function tipoDaEntrada(s: ort.InferenceSession): string {
  const meta = s.inputMetadata?.[0];
  return meta && meta.isTensor ? meta.type : 'float32';
}

/* ==================== meia precisão ==================== */

/**
 * float32 para IEEE 754 binary16.
 *
 * Existe porque o peso é fp16 e o `onnxruntime-node` recebe meia precisão como `Uint16Array` de
 * bits crus — não há conversão automática. Trata subnormal e infinito porque a normalização da
 * ImageNet produz valores pequenos o bastante para cair no subnormal, e arredondá-los para zero
 * apagaria detalhe justamente nas áreas de pouco contraste.
 */
export function paraMeio(f: Float32Array): Uint16Array {
  const saida = new Uint16Array(f.length);
  const buf = new DataView(new ArrayBuffer(4));
  for (let i = 0; i < f.length; i++) {
    buf.setFloat32(0, f[i]!);
    const x = buf.getUint32(0);
    const sinal = (x >>> 16) & 0x8000;
    let expo = ((x >>> 23) & 0xff) - 127 + 15;
    const mantissa = x & 0x7fffff;
    if (expo >= 31) {
      // Infinito ou NaN.
      saida[i] = sinal | 0x7c00 | (mantissa ? 0x200 : 0);
    } else if (expo <= 0) {
      // Subnormal: desloca a mantissa com o bit implícito de volta.
      if (expo < -10) {
        saida[i] = sinal;
      } else {
        saida[i] = sinal | ((mantissa | 0x800000) >>> (14 - expo));
      }
    } else {
      saida[i] = sinal | (expo << 10) | (mantissa >>> 13);
    }
  }
  return saida;
}

/** binary16 de volta para float32, para quando a saída também vem em meia precisão. */
export function deMeio(u: Uint16Array): Float32Array {
  const saida = new Float32Array(u.length);
  for (let i = 0; i < u.length; i++) {
    const h = u[i]!;
    const sinal = h & 0x8000 ? -1 : 1;
    const expo = (h >> 10) & 0x1f;
    const mantissa = h & 0x3ff;
    saida[i] =
      expo === 0
        ? sinal * Math.pow(2, -14) * (mantissa / 1024)
        : expo === 31
          ? mantissa
            ? NaN
            : sinal * Infinity
          : sinal * Math.pow(2, expo - 15) * (1 + mantissa / 1024);
  }
  return saida;
}

function paraFloat32(d: ArrayLike<number>): Float32Array {
  if (d instanceof Float32Array) return d;
  if (d instanceof Uint16Array) return deMeio(d);
  const saida = new Float32Array(d.length);
  for (let i = 0; i < d.length; i++) saida[i] = d[i]!;
  return saida;
}
