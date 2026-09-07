/// <reference lib="webworker" />

/**
 * O vetorizador, num worker.
 *
 * Ele PRECISA de um worker. Medido em arte chapada de 900 × 900, uma vetorização leva 1,2 s de
 * JavaScript de laço apertado sobre arrays de pixel, sem um único ponto de espera — e num único
 * bloco há 953 ms seguidos. Na thread principal, isso é a interface congelada por mais de um
 * segundo: a barra de progresso não repinta, a animação de entrada dos cartões para no meio, o
 * botão de cancelar não responde ao clique. Toda a suavidade que este projeto persegue morreria
 * exatamente no momento em que ela mais importa, que é durante a espera.
 *
 * A decodificação da imagem também acontece aqui, e não na thread principal, pelo mesmo motivo:
 * `createImageBitmap` é assíncrono, mas ler os pixels de volta do canvas não é.
 *
 * O núcleo vem de `../../vetorizador/fonte/`, importado direto por apelido do Vite. Não há cópia:
 * o mesmo arquivo alimenta este worker e o `vetorizador.html` de duplo clique.
 */

// @ts-expect-error — módulo JavaScript sem tipos, mantido em português no diretório do vetorizador
import { vetorizar } from '@vetorizador/vetorizar.js';

export interface PedidoAoWorker {
  readonly arquivo: Blob;
  readonly opcoes: {
    tol?: number;
    grausMin?: number;
    casas?: number;
    maxCores?: number;
    forcarFoto?: boolean;
  };
}

export type RespostaDoWorker =
  | { tipo: 'etapas'; etapas: { id: string; rotulo: string; peso: number }[] }
  | { tipo: 'progresso'; etapa: string; dentro: number; detalhe?: string }
  | { tipo: 'aviso'; texto: string }
  | { tipo: 'pronto'; svg: string; diagnostico: Record<string, unknown> }
  | { tipo: 'erro'; codigo: string; mensagem: string; detalhe?: string };

/**
 * Os pesos das etapas, medidos.
 *
 * Arte chapada de 900 × 900, total de 1185 ms: análise 8 ms, classes 963 ms, camadas 117 ms,
 * montagem 69 ms. Em 400 × 400 e em 1800 × 1800 as proporções se mantêm na mesma ordem — a
 * `classes` fica entre 69% e 89% do total.
 *
 * A decodificação entra com peso 2 por não ser medida junto (depende do formato de entrada e do
 * decodificador do navegador), mas na prática é pequena: dezenas de milissegundos.
 */
const ETAPAS = [
  { id: 'decodificar', rotulo: 'Lendo a imagem', peso: 2 },
  { id: 'analise', rotulo: 'Analisando as cores', peso: 2 },
  { id: 'classes', rotulo: 'Escolhendo as classes de cor', peso: 75 },
  { id: 'camadas', rotulo: 'Traçando os contornos', peso: 22 },
  { id: 'montagem', rotulo: 'Montando o SVG', peso: 1 },
];

const responde = (r: RespostaDoWorker) => self.postMessage(r);

self.onmessage = async (e: MessageEvent<PedidoAoWorker>) => {
  const { arquivo, opcoes } = e.data;
  try {
    responde({ tipo: 'etapas', etapas: ETAPAS });
    responde({ tipo: 'progresso', etapa: 'decodificar', dentro: 0 });

    const { rgba, w, h } = await paraPixels(arquivo);
    responde({ tipo: 'progresso', etapa: 'decodificar', dentro: 1, detalhe: `${w} × ${h}` });

    const resultado = vetorizar(rgba, w, h, {
      ...opcoes,
      aoAndar: (etapa: string, dentro: number, detalhe?: string) => {
        responde({ tipo: 'progresso', etapa, dentro, ...(detalhe ? { detalhe } : {}) });
      },
    }) as { svg: string | null; diag: Record<string, unknown> & { avisos?: string[] } };

    if (!resultado.svg) {
      // O vetorizador recusou, e a recusa dele é informada: em imagem fotográfica, o SVG sairia
      // maior que o original e com menos detalhe. Isso não é falha, é a resposta certa — e a
      // mensagem tem de dizer o que fazer, não só que não deu.
      //
      // Os avisos NÃO são reenviados como aviso aqui. O primeiro deles é a própria explicação da
      // recusa, e mandar os dois canais fazia o cartão mostrar a mesma frase duas vezes — uma em
      // amarelo e outra em vermelho, logo abaixo. Ler a mesma coisa duas vezes com dois pesos
      // diferentes faz duvidar de que sejam o mesmo problema.
      responde({
        tipo: 'erro',
        codigo: 'nao-vetorizavel',
        mensagem:
          (resultado.diag.avisos?.[0] as string | undefined) ??
          'Esta imagem não é adequada para vetorização.',
        detalhe:
          (resultado.diag.avisos ?? []).slice(1).join(' ') ||
          'Em Opções, "vetorizar mesmo assim" força a conversão.',
      });
      return;
    }

    // Deu certo: aqui os avisos são informação adicional sobre um resultado que existe, e não a
    // explicação de uma recusa. Então vão como aviso.
    for (const aviso of resultado.diag.avisos ?? []) responde({ tipo: 'aviso', texto: aviso });

    responde({ tipo: 'pronto', svg: resultado.svg, diagnostico: resultado.diag });
  } catch (erro) {
    responde({
      tipo: 'erro',
      codigo: 'falha-na-vetorizacao',
      mensagem:
        'A vetorização falhou por um problema do conversor, não do seu arquivo. O detalhe ' +
        'técnico está no console do navegador.',
      detalhe: (erro as Error)?.stack ?? String(erro),
    });
  }
};

/**
 * Do arquivo aos pixels.
 *
 * `createImageBitmap` deixa o decodificador nativo do navegador fazer o trabalho — é ele que
 * sabe ler PNG entrelaçado, JPEG progressivo, WebP animado e o resto. Reimplementar isso em
 * JavaScript seria trocar código testado por bug novo.
 *
 * `premultiplyAlpha: 'none'` é a parte que importa e a que não é óbvia. Por padrão o navegador
 * pode entregar a cor já multiplicada pelo alfa, e o vetorizador trabalha exatamente na borda
 * onde o alfa é parcial: é de lá que ele tira a posição subpixel do contorno. Com alfa
 * pré-multiplicado, a cor da borda vem escurecida na direção do fundo, e o ajuste de
 * preenchimento veria um degradê que não existe na imagem.
 */
async function paraPixels(arquivo: Blob): Promise<{ rgba: Uint8ClampedArray; w: number; h: number }> {
  const bitmap = await createImageBitmap(arquivo, {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  try {
    const tela = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = tela.getContext('2d', { willReadFrequently: true, alpha: true });
    if (!ctx) throw new Error('OffscreenCanvas sem contexto 2d');
    ctx.drawImage(bitmap, 0, 0);
    const dados = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return { rgba: dados.data, w: bitmap.width, h: bitmap.height };
  } finally {
    bitmap.close();
  }
}
