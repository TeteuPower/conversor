/// <reference lib="webworker" />

/**
 * O codificador, fora da thread principal.
 *
 * Duas razões para ele existir como worker, e a segunda é a que manda.
 *
 * A primeira, a óbvia: codificar 1600 × 1200 em WebP custa 125 ms medidos. Na thread principal
 * isso seriam 125 ms sem repintar, e o divisor da comparação — que o usuário está arrastando com
 * o dedo naquele exato momento — engasgaria a cada recodificação.
 *
 * A segunda: aqui o `ImageBitmap` fica GUARDADO entre uma codificação e outra. Decodificar o
 * arquivo é caro e não muda quando o usuário mexe na qualidade; separar "carregar" de
 * "codificar" faz cada passo do controle deslizante pagar só a codificação. É o que permite o
 * preview reagir ao arrasto em vez de reagir ao soltar.
 */

import { MIME, type FormatoSaida, type PedidoAoWorker, type RespostaDoWorker } from './protocolo.js';

let original: ImageBitmap | undefined;

/**
 * Confirma o que ESTE navegador codifica, codificando de verdade.
 *
 * Isto não é excesso de zelo, é a correção de uma armadilha medida. `convertToBlob` com um tipo
 * que o navegador não codifica NÃO lança erro e NÃO avisa: ele devolve um PNG, com
 * `blob.type === 'image/png'`, como se tivesse atendido. Foi exatamente o que aconteceu com AVIF
 * no Chromium 153 — 13 ms, 557 kB, e um PNG disfarçado.
 *
 * Confiar na lista de formatos sem conferir o `type` do Blob entregaria ao usuário um "AVIF" que
 * é PNG com o nome errado: maior que o original, quando ele pediu justamente para diminuir.
 * Comparar o tipo devolvido com o pedido é o único jeito de saber.
 */
async function sonda(): Promise<{ suportados: FormatoSaida[]; recusados: FormatoSaida[] }> {
  const cv = new OffscreenCanvas(8, 8);
  const ctx = cv.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#2f66f5';
    ctx.fillRect(0, 0, 8, 8);
  }
  const suportados: FormatoSaida[] = [];
  const recusados: FormatoSaida[] = [];
  for (const f of Object.keys(MIME) as FormatoSaida[]) {
    try {
      const b = await cv.convertToBlob({ type: MIME[f], quality: 0.75 });
      (b.type === MIME[f] ? suportados : recusados).push(f);
    } catch {
      recusados.push(f);
    }
  }
  return { suportados, recusados };
}

async function codifica(p: Extract<PedidoAoWorker, { tipo: 'codifica' }>): Promise<RespostaDoWorker> {
  if (!original) return { tipo: 'erro', id: p.id, mensagem: 'Nenhuma imagem carregada.' };
  const inicio = performance.now();

  // Redimensionar pelo `createImageBitmap` e não desenhando num canvas menor: `resizeQuality`
  // alto usa a redução de escala do próprio navegador, que faz média de área. Desenhar direto
  // num canvas menor usa interpolação bilinear simples e produz serrilhado em imagem com
  // detalhe fino — que é justamente onde o usuário vai olhar para julgar a compressão.
  let quadro: ImageBitmap = original;
  let temporario = false;
  if (p.largura && p.largura < original.width) {
    const altura = Math.max(1, Math.round((p.largura * original.height) / original.width));
    quadro = await createImageBitmap(original, {
      resizeWidth: p.largura,
      resizeHeight: altura,
      resizeQuality: 'high',
    });
    temporario = true;
  }

  try {
    const cv = new OffscreenCanvas(quadro.width, quadro.height);
    const ctx = cv.getContext('2d');
    if (!ctx) return { tipo: 'erro', id: p.id, mensagem: 'Não consegui abrir um contexto 2D.' };

    // JPEG não tem transparência. Sem esta base branca o canvas compõe contra preto, e um PNG
    // de logo com fundo vazado sairia um retângulo preto — tecnicamente correto, inútil.
    if (p.formato === 'jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cv.width, cv.height);
    }
    ctx.drawImage(quadro, 0, 0);

    const blob = await cv.convertToBlob({ type: MIME[p.formato], quality: p.qualidade / 100 });
    if (blob.type !== MIME[p.formato]) {
      return {
        tipo: 'erro',
        id: p.id,
        mensagem: `Este navegador não codifica ${p.formato.toUpperCase()} — ele devolveu ${blob.type} sem avisar.`,
      };
    }

    const dados = await blob.arrayBuffer();
    return {
      tipo: 'pronto',
      id: p.id,
      dados,
      mime: blob.type,
      tamanho: blob.size,
      largura: cv.width,
      altura: cv.height,
      ms: Math.round(performance.now() - inicio),
    };
  } finally {
    if (temporario) quadro.close();
  }
}

self.onmessage = async (e: MessageEvent<PedidoAoWorker>) => {
  const p = e.data;
  try {
    switch (p.tipo) {
      case 'sonda': {
        const { suportados, recusados } = await sonda();
        self.postMessage({ tipo: 'sonda', suportados, recusados } satisfies RespostaDoWorker);
        return;
      }
      case 'carrega': {
        original?.close();
        original = await createImageBitmap(p.arquivo);
        self.postMessage({
          tipo: 'carregado',
          largura: original.width,
          altura: original.height,
        } satisfies RespostaDoWorker);
        return;
      }
      case 'codifica': {
        const r = await codifica(p);
        // O ArrayBuffer vai TRANSFERIDO, não copiado: uma imagem grande em PNG passa de 1 MB, e
        // copiar isso a cada passo do controle deslizante apareceria como engasgo no arrasto.
        self.postMessage(r, r.tipo === 'pronto' ? [r.dados] : []);
        return;
      }
    }
  } catch (erro) {
    self.postMessage({
      tipo: 'erro',
      ...(p.tipo === 'codifica' ? { id: p.id } : {}),
      mensagem: (erro as Error)?.message ?? String(erro),
    } satisfies RespostaDoWorker);
  }
};
