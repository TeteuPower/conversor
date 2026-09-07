import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ETAPAS_FUNDO,
  bytes as emBytes,
  trocaExtensao,
  type Evento,
  type OpcoesFundo,
  type ResultadoFundo,
} from '@conversor/nucleo';
import type { Armazenamento } from '../armazenamento.js';
import { nomeSeguro } from '../armazenamento.js';
import type { Fila } from '../fila.js';
import type { Engine, Relator, Tarefa } from '../engines/registro.js';
import { ErroDeEntrada } from '../engines/registro.js';
import { ErroDeImagem, caminhoDaMascara, removeFundo } from './pipeline.js';
import { CATALOGO, PADRAO, apaga as apagaModelo, baixa as baixaModelo, definicao, estado } from './modelo.js';

/**
 * As rotas de `/api/fundo`.
 *
 * Ficam num arquivo próprio e o `http.ts` só desvia para cá. Duas razões: a ferramenta é outra,
 * com ciclo de vida próprio, e assim ela cresce sem engordar o roteador principal.
 *
 * **Reaproveita a `Fila` sem se registrar como engine de conversão.** A fila dá de graça o que
 * esta ferramenta precisa — vaga limitada, cancelamento de verdade, histórico de eventos para
 * quem se inscreve tarde — e nada disso valia reescrever. Mas remover fundo não é conversão de
 * formato, então a engine daqui é montada localmente e passada no pedido, em vez de entrar no
 * registro de `todas.ts`. Assim ela não aparece no grafo nem no seletor de formato, que é onde
 * ela não faz sentido nenhum.
 */

export interface ContextoFundo {
  readonly armazenamento: Armazenamento;
  readonly fila: Fila;
  readonly tamanhoMaximo: number;
}

interface Pendente {
  readonly nomeEntrada: string;
  readonly nomeSaida: string;
  readonly opcoes: OpcoesFundo;
}

/**
 * Trabalhos criados que ainda não receberam os bytes.
 *
 * Some sozinho: `recolhePendentes` é chamado pela mesma varredura periódica que limpa o disco.
 * Sem isso, uma aba fechada entre criar e enviar deixaria a entrada aqui para sempre.
 */
const pendentes = new Map<string, Pendente & { criadoEm: number }>();

export function recolhePendentesDeFundo(idadeMs: number): number {
  const limite = Date.now() - idadeMs;
  let mortos = 0;
  for (const [id, p] of pendentes) {
    if (p.criadoEm < limite) {
      pendentes.delete(id);
      mortos++;
    }
  }
  return mortos;
}

/** Devolve `true` quando tratou o caminho; `false` deixa o roteador principal seguir. */
export async function atendeFundo(
  req: IncomingMessage,
  res: ServerResponse,
  caminho: string,
  ctx: ContextoFundo,
): Promise<boolean> {
  if (!caminho.startsWith('/api/fundo/')) return false;

  if (caminho === '/api/fundo/modelos' && req.method === 'GET') {
    responde(res, 200, await estado());
    return true;
  }

  const mm = /^\/api\/fundo\/modelos\/([a-z0-9-]+)(?:\/(baixar))?$/.exec(caminho);
  if (mm) {
    const id = mm[1]!;
    if (mm[2] === 'baixar' && req.method === 'GET') {
      await transmiteDownload(req, res, id);
      return true;
    }
    if (!mm[2] && req.method === 'DELETE') {
      await apagaModelo(id);
      res.writeHead(204).end();
      return true;
    }
  }

  if (caminho === '/api/fundo/trabalhos' && req.method === 'POST') {
    await criaTrabalho(req, res, ctx);
    return true;
  }

  const mt = /^\/api\/fundo\/trabalhos\/([^/]+)(?:\/(entrada|eventos|saida|mascara))?$/.exec(caminho);
  if (mt) {
    const id = decodeURIComponent(mt[1]!);
    const sub = mt[2];
    if (sub === 'entrada' && req.method === 'PUT') {
      await recebeEntrada(req, res, id, ctx);
      return true;
    }
    if (sub === 'eventos' && req.method === 'GET') {
      assina(req, res, id, ctx.fila);
      return true;
    }
    if (sub === 'saida' && req.method === 'GET') {
      await serveImagem(res, id, ctx, 'frente');
      return true;
    }
    if (sub === 'mascara' && req.method === 'GET') {
      await serveImagem(res, id, ctx, 'mascara');
      return true;
    }
    if (!sub && req.method === 'DELETE') {
      ctx.fila.cancela(id);
      ctx.fila.esquece(id);
      pendentes.delete(id);
      await ctx.armazenamento.apaga(id);
      res.writeHead(204).end();
      return true;
    }
  }

  responde(res, 404, { erro: 'rota-desconhecida', mensagem: `Não existe ${caminho}.` });
  return true;
}

/* ==================== o modelo ==================== */

/**
 * Baixa o peso relatando o andamento, por SSE.
 *
 * É um `GET` que muda o estado do disco, o que normalmente seria feio. Duas coisas resolvem: o
 * `EventSource` do navegador só faz `GET`, e a operação é idempotente — baixar um peso que já
 * está completo retorna na hora, sem tocar em nada.
 */
async function transmiteDownload(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
  const d = definicao(id);
  if (!d) {
    responde(res, 404, { erro: 'modelo-desconhecido', mensagem: `Não conheço o modelo "${id}".` });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let vivo = true;
  req.on('close', () => {
    vivo = false;
  });

  const manda = (obj: unknown) => {
    if (vivo) res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  manda({ tipo: 'estado', estado: 'convertendo' });
  manda({ tipo: 'etapas', etapas: [{ id: 'baixar', rotulo: `Baixando ${d.nome}`, peso: 1 }] });

  let ultimo = -1;
  try {
    await baixaModelo(id, (baixados, total) => {
      const fracao = total > 0 ? Math.min(0.999, baixados / total) : 0;
      // Só relata a cada meio por cento. Sem isso seriam milhares de eventos para meio giga, e
      // serializar cada um custaria mais que o próprio download.
      const passo = Math.floor(fracao * 200);
      if (passo === ultimo) return;
      ultimo = passo;
      manda({
        tipo: 'progresso',
        fracao,
        etapa: 'baixar',
        detalhe: `${emBytes(baixados)} de ${emBytes(total)}`,
      });
    });
    manda({ tipo: 'progresso', fracao: 1, etapa: 'baixar' });
    manda({ tipo: 'estado', estado: 'concluido' });
    manda({ tipo: 'concluido', saida: { nome: d.arquivo, tamanho: d.bytes, mime: 'application/octet-stream', url: '' }, duracaoMs: 0 });
  } catch (e) {
    manda({
      tipo: 'falhou',
      erro: { codigo: 'download-falhou', mensagem: (e as Error).message },
    });
  }
  res.end();
}

/* ==================== os trabalhos ==================== */

/**
 * A engine que embrulha o pipeline para a `Fila` poder tocá-lo.
 *
 * `arestas()` devolve lista vazia de propósito: esta engine não participa do grafo de conversão.
 * Ela existe só para satisfazer o contrato que a fila espera.
 */
const engineDeFundo: Engine = {
  id: 'remover-fundo',
  nome: 'Remover fundo',
  descricao: 'Separa o assunto do fundo com o BiRefNet e limpa a cor da borda.',
  async detecta() {
    return { disponivel: true };
  },
  arestas() {
    return [];
  },
  async converte(tarefa: Tarefa, relata: Relator) {
    relata.etapas(ETAPAS_FUNDO);
    try {
      const r = await removeFundo(
        {
          entrada: tarefa.entrada,
          saida: tarefa.saida,
          opcoes: tarefa.opcoes as OpcoesFundo,
          sinal: tarefa.sinal,
        },
        Object.assign(
          (etapa: string, dentro: number, detalhe?: string) => relata.andou(etapa, dentro, detalhe),
          { avisa: (texto: string) => relata.avisa(texto) },
        ),
      );
      const diagnostico: ResultadoFundo & Record<string, unknown> = {
        ...r,
        recorteUrl: `/api/fundo/trabalhos/${tarefa.id}/saida`,
        mascaraUrl: `/api/fundo/trabalhos/${tarefa.id}/mascara`,
      };
      return { diagnostico };
    } catch (e) {
      // Erro de imagem é culpa do arquivo e tem mensagem escrita para ser lida; o resto sobe
      // como está e a fila traduz para "problema do conversor".
      if (e instanceof ErroDeImagem) throw new ErroDeEntrada(e.codigo, e.message, e.detalhe);
      throw e;
    }
  },
};

interface CorpoNovo {
  nome?: unknown;
  opcoes?: unknown;
}

async function criaTrabalho(req: IncomingMessage, res: ServerResponse, ctx: ContextoFundo): Promise<void> {
  let corpo: CorpoNovo;
  try {
    corpo = JSON.parse(await leTexto(req, 64 * 1024)) as CorpoNovo;
  } catch {
    responde(res, 400, { erro: 'json-invalido', mensagem: 'O corpo do pedido não é JSON válido.' });
    return;
  }

  const nome = nomeSeguro(typeof corpo.nome === 'string' ? corpo.nome : 'imagem', 'imagem');
  const opcoes = (typeof corpo.opcoes === 'object' && corpo.opcoes ? corpo.opcoes : {}) as OpcoesFundo;

  const modeloId = opcoes.modelo ?? PADRAO;
  const d = definicao(modeloId);
  if (!d) {
    responde(res, 400, {
      erro: 'modelo-desconhecido',
      mensagem: `Não conheço o modelo "${modeloId}". Disponíveis: ${CATALOGO.map((m) => m.id).join(', ')}.`,
    });
    return;
  }

  const { id, pasta } = await ctx.armazenamento.novoTrabalho();
  void pasta;
  ctx.fila.registra(id);
  pendentes.set(id, {
    nomeEntrada: nome,
    // A saída é sempre PNG: é o único formato de uso geral que guarda alfa sem perda, e o alfa é
    // justamente o produto desta ferramenta. Trocar o fundo por cor e exportar em JPEG é
    // decisão do navegador, depois.
    nomeSaida: trocaExtensao(nome, 'png'),
    opcoes,
    criadoEm: Date.now(),
  });
  responde(res, 201, { id, modelo: modeloId, precisaBaixar: !(await estaBaixado(modeloId)) });
}

async function estaBaixado(id: string): Promise<boolean> {
  const e = await estado();
  return e.modelos.find((m) => m.id === id)?.baixado === true;
}

async function recebeEntrada(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  ctx: ContextoFundo,
): Promise<void> {
  const pendente = pendentes.get(id);
  const pasta = ctx.armazenamento.pastaDe(id);
  if (!pendente || !pasta) {
    responde(res, 404, {
      erro: 'trabalho-desconhecido',
      mensagem: 'Este trabalho não existe, ou já recebeu o arquivo, ou expirou.',
    });
    return;
  }
  pendentes.delete(id);

  let escritos = 0;
  const arquivo = await open(pasta.entrada, 'w');
  try {
    for await (const pedaco of req) {
      escritos += (pedaco as Buffer).length;
      if (escritos > ctx.tamanhoMaximo) {
        await arquivo.close();
        await ctx.armazenamento.apaga(id);
        ctx.fila.falha(id, {
          codigo: 'muito-grande',
          mensagem: `A imagem passou do teto de ${emBytes(ctx.tamanhoMaximo)}.`,
        });
        res.writeHead(413).end();
        req.destroy();
        return;
      }
      await arquivo.write(pedaco as Buffer);
    }
    await arquivo.close();
  } catch (e) {
    await arquivo.close().catch(() => {});
    ctx.fila.cancela(id);
    await ctx.armazenamento.apaga(id);
    if (!res.headersSent) responde(res, 400, { erro: 'envio-interrompido', mensagem: String(e) });
    return;
  }

  if (escritos === 0) {
    await ctx.armazenamento.apaga(id);
    ctx.fila.falha(id, { codigo: 'arquivo-vazio', mensagem: 'A imagem chegou vazia (0 bytes).' });
    responde(res, 400, { erro: 'arquivo-vazio', mensagem: 'A imagem chegou vazia.' });
    return;
  }

  ctx.fila.enfileira({
    id,
    pasta,
    nomeEntrada: pendente.nomeEntrada,
    tamanhoEntrada: escritos,
    de: 'imagem',
    para: 'png',
    opcoes: pendente.opcoes as never,
    engine: engineDeFundo,
    nomeSaida: pendente.nomeSaida,
    mimeSaida: 'image/png',
  });
  responde(res, 202, { id, tamanho: escritos });
}

function assina(req: IncomingMessage, res: ServerResponse, id: string, fila: Fila): void {
  if (fila.estadoDe(id) === undefined) {
    responde(res, 404, { erro: 'trabalho-desconhecido', mensagem: 'Este trabalho não existe mais.' });
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const manda = (e: Evento) => {
    res.write(`data: ${JSON.stringify(e)}\n\n`);
    if (e.tipo === 'concluido' || e.tipo === 'falhou') res.end();
  };
  const sair = fila.ouve(id, manda);
  if (!sair) {
    res.end();
    return;
  }
  const pulso = setInterval(() => res.write(': .\n\n'), 15_000);
  const encerra = () => {
    clearInterval(pulso);
    sair();
  };
  req.on('close', encerra);
  res.on('close', encerra);
}

/**
 * Serve o primeiro plano ou a máscara.
 *
 * Os dois vão `inline`, e não como anexo: o navegador desenha ambos num canvas para compor. Quem
 * baixa é a interface, depois de o usuário escolher o fundo e passar o pincel — e ela baixa do
 * canvas, sem pedir nada ao servidor.
 */
async function serveImagem(
  res: ServerResponse,
  id: string,
  ctx: ContextoFundo,
  qual: 'frente' | 'mascara',
): Promise<void> {
  const pasta = ctx.armazenamento.pastaDe(id);
  const saida = ctx.fila.saidaDe(id);
  if (!pasta || !saida) {
    responde(res, 404, { erro: 'sem-saida', mensagem: 'Este recorte não está pronto, ou já expirou.' });
    return;
  }
  const caminho = qual === 'frente' ? pasta.saida : caminhoDaMascara(pasta.saida);
  let tamanho: number;
  try {
    tamanho = (await stat(caminho)).size;
  } catch {
    responde(res, 404, { erro: 'sem-saida', mensagem: 'O arquivo do recorte não está mais no disco.' });
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Length': String(tamanho),
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(saida.nome)}`,
    'Cache-Control': 'no-store',
  });
  createReadStream(caminho).pipe(res);
}

/* ==================== utilidades ==================== */

function responde(res: ServerResponse, codigo: number, corpo: unknown): void {
  const texto = JSON.stringify(corpo);
  res.writeHead(codigo, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(texto),
  });
  res.end(texto);
}

async function leTexto(req: IncomingMessage, maximo: number): Promise<string> {
  let total = 0;
  const partes: Buffer[] = [];
  for await (const p of req) {
    total += (p as Buffer).length;
    if (total > maximo) throw new Error('corpo grande demais');
    partes.push(p as Buffer);
  }
  return Buffer.concat(partes).toString('utf8');
}
