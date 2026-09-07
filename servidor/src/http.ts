import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { formatoDe, trocaExtensao, type Evento, type Opcoes } from '@conversor/nucleo';
import { Armazenamento, nomeSeguro } from './armazenamento.js';
import { Fila } from './fila.js';
import type { Instalacao } from './engines/todas.js';

export interface Config {
  readonly porta: number;
  /** Pasta com a interface compilada. Ausente em desenvolvimento, onde o Vite serve. */
  readonly web?: string;
  readonly tamanhoMaximo: number;
}

export interface Servico {
  readonly servidor: Server;
  readonly fila: Fila;
}

export function montaServidor(
  instalacao: Instalacao,
  armazenamento: Armazenamento,
  fila: Fila,
  cfg: Config,
): Servico {
  const servidor = createServer((req, res) => {
    void atende(req, res, instalacao, armazenamento, fila, cfg).catch((e) => {
      // Rede caindo no meio de uma resposta é rotina, não incidente: o cabeçalho já foi enviado
      // e não há o que responder. Só o que não for isso merece log.
      if (!res.headersSent) responde(res, 500, { erro: 'erro-interno', mensagem: String(e) });
      else res.destroy();
    });
  });
  // Um envio de 500 MB por localhost é rápido, mas não instantâneo, e o padrão de 5 s do Node
  // cortaria a conexão no meio. Zero desliga o corte por inatividade de cabeçalho.
  servidor.headersTimeout = 0;
  servidor.requestTimeout = 0;
  return { servidor, fila };
}

async function atende(
  req: IncomingMessage,
  res: ServerResponse,
  instalacao: Instalacao,
  armazenamento: Armazenamento,
  fila: Fila,
  cfg: Config,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const caminho = url.pathname;

  /**
   * Trava contra religação de DNS.
   *
   * O servidor escuta só em 127.0.0.1, e isso costuma ser tratado como suficiente. Não é: um
   * site qualquer aberto noutra aba pode apontar um domínio dele para 127.0.0.1 e passar a
   * conversar com este servidor pelo navegador do usuário — com acesso aos arquivos que ele
   * estiver convertendo. O que barra o ataque é justamente isto: exigir que o `Host` seja
   * localhost. O domínio do atacante chega no `Host` como o domínio dele, e cai aqui.
   */
  const host = (req.headers.host ?? '').split(':')[0]?.toLowerCase();
  if (host && !['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) {
    responde(res, 403, {
      erro: 'host-nao-permitido',
      mensagem:
        `Esta requisição chegou com Host "${host}". O conversor só atende em localhost, para ` +
        'que nenhuma página aberta noutra aba consiga falar com ele.',
    });
    return;
  }

  if (caminho === '/api/capacidades' && req.method === 'GET') {
    // Sem cache: instalar o LibreOffice e reiniciar o servidor tem de aparecer no F5.
    res.setHeader('Cache-Control', 'no-store');
    responde(res, 200, instalacao.capacidades);
    return;
  }

  if (caminho === '/api/saude' && req.method === 'GET') {
    responde(res, 200, { ok: true, ...fila.ocupacao });
    return;
  }

  if (caminho === '/api/trabalhos' && req.method === 'POST') {
    await criaTrabalho(req, res, instalacao, armazenamento, fila, cfg);
    return;
  }

  const m = /^\/api\/trabalhos\/([^/]+)(?:\/(entrada|eventos|saida))?$/.exec(caminho);
  if (m) {
    const id = decodeURIComponent(m[1]!);
    const sub = m[2];
    if (sub === 'entrada' && req.method === 'PUT') return recebeEntrada(req, res, id, armazenamento, fila, cfg);
    if (sub === 'eventos' && req.method === 'GET') return assina(req, res, id, fila);
    if (sub === 'saida' && req.method === 'GET') return baixa(req, res, id, armazenamento, fila);
    if (!sub && req.method === 'DELETE') {
      fila.cancela(id);
      fila.esquece(id);
      await armazenamento.apaga(id);
      res.writeHead(204).end();
      return;
    }
    responde(res, 405, { erro: 'metodo-errado', mensagem: `${req.method} não serve para ${caminho}.` });
    return;
  }

  if (caminho.startsWith('/api/')) {
    responde(res, 404, { erro: 'rota-desconhecida', mensagem: `Não existe ${caminho}.` });
    return;
  }

  if (cfg.web) return serveEstatico(res, caminho, cfg.web);
  responde(res, 404, {
    erro: 'sem-interface',
    mensagem:
      'O servidor está sem interface compilada. Em desenvolvimento, abra o endereço do Vite; ' +
      'em produção, rode `npm run build` antes de `npm start`.',
  });
}

/* ==================== trabalhos ==================== */

interface CorpoNovoTrabalho {
  nome?: unknown;
  tamanho?: unknown;
  de?: unknown;
  para?: unknown;
  opcoes?: unknown;
}

async function criaTrabalho(
  req: IncomingMessage,
  res: ServerResponse,
  instalacao: Instalacao,
  armazenamento: Armazenamento,
  fila: Fila,
  cfg: Config,
): Promise<void> {
  let corpo: CorpoNovoTrabalho;
  try {
    corpo = JSON.parse(await leTexto(req, 64 * 1024)) as CorpoNovoTrabalho;
  } catch {
    responde(res, 400, { erro: 'json-invalido', mensagem: 'O corpo não é JSON válido.' });
    return;
  }

  const nome = typeof corpo.nome === 'string' ? corpo.nome : '';
  const tamanho = typeof corpo.tamanho === 'number' ? corpo.tamanho : -1;
  const de = formatoDe(String(corpo.de ?? ''));
  const para = formatoDe(String(corpo.para ?? ''));

  if (!nome) return void responde(res, 400, { erro: 'sem-nome', mensagem: 'Falta o nome do arquivo.' });
  if (!de) return void responde(res, 400, { erro: 'origem-desconhecida', mensagem: `Formato de origem desconhecido: ${corpo.de}.` });
  if (!para) return void responde(res, 400, { erro: 'destino-desconhecido', mensagem: `Formato de destino desconhecido: ${corpo.para}.` });
  if (tamanho > cfg.tamanhoMaximo) {
    return void responde(res, 413, {
      erro: 'muito-grande',
      mensagem: `Este arquivo tem ${tamanho} bytes e o teto é ${cfg.tamanhoMaximo}. O teto está em servidor/src/index.ts.`,
    });
  }

  // A aresta é conferida AQUI, e não só na interface. A interface é a nossa, mas a API é
  // acessível e uma versão dela em cache pode oferecer um par que já não existe.
  const aresta = instalacao.capacidades.arestas.find((a) => a.de === de.ext && a.para === para.ext && a.disponivel);
  if (!aresta) {
    return void responde(res, 422, {
      erro: 'conversao-indisponivel',
      mensagem: `Este servidor não converte ${de.nome} para ${para.nome} agora.`,
    });
  }
  const registrada = instalacao.engines.get(aresta.engine);
  if (!registrada?.deteccao.disponivel) {
    return void responde(res, 422, {
      erro: 'engine-indisponivel',
      mensagem: `A engine "${aresta.engine}" faria esta conversão, mas não está disponível nesta máquina.`,
    });
  }

  const { id, pasta } = await armazenamento.novoTrabalho();
  fila.registra(id);
  pendentes.set(id, {
    pasta,
    nomeEntrada: nomeSeguro(nome),
    de: de.ext,
    para: para.ext,
    opcoes: (corpo.opcoes ?? {}) as Opcoes,
    engine: registrada.engine,
    nomeSaida: nomeSeguro(trocaExtensao(nome, para.ext)),
    mimeSaida: para.mime,
    criadoEm: Date.now(),
  });
  fila.marca(id, 'enviando');
  responde(res, 201, { id });
}

/**
 * O que o `POST` decidiu, esperando os bytes do `PUT`.
 *
 * Fica fora da `Fila` de propósito: a fila cuida de conversão, e isto é um trabalho que ainda
 * não tem arquivo. A varredura do armazenamento recolhe o disco de quem nunca envia; o registro
 * em memória sai junto, em `recolhePendentes`.
 */
interface Pendente {
  pasta: { raiz: string; entrada: string; saida: string };
  nomeEntrada: string;
  de: string;
  para: string;
  opcoes: Opcoes;
  engine: import('./engines/registro.js').Engine;
  nomeSaida: string;
  mimeSaida: string;
  criadoEm?: number;
}

const pendentes = new Map<string, Pendente>();

/** Solta o pendente que nunca recebeu bytes. Chamado pela mesma agenda da varredura de disco. */
export function recolhePendentes(idadeMs: number): number {
  const limite = Date.now() - idadeMs;
  let n = 0;
  for (const [id, p] of pendentes) {
    if ((p.criadoEm ?? 0) < limite) {
      pendentes.delete(id);
      n++;
    }
  }
  return n;
}

async function recebeEntrada(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  armazenamento: Armazenamento,
  fila: Fila,
  cfg: Config,
): Promise<void> {
  const pendente = pendentes.get(id);
  const pasta = armazenamento.pastaDe(id);
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
      if (escritos > cfg.tamanhoMaximo) {
        // Cortar a conexão em vez de ler o resto: continuar lendo para depois recusar gastaria
        // tempo e disco por um arquivo que já se sabe que não serve.
        await arquivo.close();
        await armazenamento.apaga(id);
        fila.falha(id, {
          codigo: 'muito-grande',
          mensagem: `O arquivo passou do teto de ${cfg.tamanhoMaximo} bytes.`,
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
    // Envio interrompido (aba fechada, cancelamento) é o caso comum aqui.
    fila.cancela(id);
    await armazenamento.apaga(id);
    if (!res.headersSent) responde(res, 400, { erro: 'envio-interrompido', mensagem: String(e) });
    return;
  }

  if (escritos === 0) {
    await armazenamento.apaga(id);
    fila.falha(id, { codigo: 'arquivo-vazio', mensagem: 'O arquivo chegou vazio (0 bytes).' });
    responde(res, 400, { erro: 'arquivo-vazio', mensagem: 'O arquivo chegou vazio.' });
    return;
  }

  fila.enfileira({
    id,
    pasta,
    nomeEntrada: pendente.nomeEntrada,
    tamanhoEntrada: escritos,
    de: pendente.de,
    para: pendente.para,
    opcoes: pendente.opcoes,
    engine: pendente.engine,
    nomeSaida: pendente.nomeSaida,
    mimeSaida: pendente.mimeSaida,
  });
  responde(res, 202, { id, tamanho: escritos });
}

/**
 * O canal de progresso, por eventos enviados pelo servidor.
 *
 * SSE, e não WebSocket: o fluxo é de mão única (servidor conta, interface escuta), reconecta
 * sozinho e passa por qualquer intermediário sem negociação. WebSocket traria um protocolo a
 * mais para não usar a volta.
 */
function assina(req: IncomingMessage, res: ServerResponse, id: string, fila: Fila): void {
  if (fila.estadoDe(id) === undefined) {
    responde(res, 404, { erro: 'trabalho-desconhecido', mensagem: 'Este trabalho não existe mais.' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    // Desliga o buffer de intermediário: com buffer, os eventos chegariam em bloco no fim e a
    // barra pularia de 0 a 100.
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

  // Comentário periódico para a conexão não morrer de inatividade num trabalho longo em que a
  // engine passe muito tempo sem relatar.
  const pulso = setInterval(() => res.write(': .\n\n'), 15_000);
  const encerra = () => {
    clearInterval(pulso);
    sair();
  };
  req.on('close', encerra);
  res.on('close', encerra);
}

async function baixa(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  armazenamento: Armazenamento,
  fila: Fila,
): Promise<void> {
  const saida = fila.saidaDe(id);
  const pasta = armazenamento.pastaDe(id);
  if (!saida || !pasta) {
    responde(res, 404, { erro: 'saida-inexistente', mensagem: 'Não há saída pronta para este trabalho.' });
    return;
  }
  let s;
  try {
    s = await stat(pasta.saida);
  } catch {
    responde(res, 410, {
      erro: 'saida-expirada',
      mensagem: 'A saída já foi apagada do disco. Converta de novo.',
    });
    return;
  }

  res.writeHead(200, {
    'Content-Type': saida.mime,
    'Content-Length': s.size,
    // `filename*` em UTF-8 para nome com acento chegar certo; `filename` simples fica como
    // reserva para cliente antigo. Sem os dois, "coração.png" baixa como "coraÃ§Ã£o.png".
    'Content-Disposition':
      `attachment; filename="${asciiOuPadrao(saida.nome)}"; ` +
      `filename*=UTF-8''${encodeURIComponent(saida.nome)}`,
    'Cache-Control': 'no-store',
  });
  const fluxo = createReadStream(pasta.saida);
  req.on('close', () => fluxo.destroy());
  fluxo.pipe(res);
}

/* ==================== estáticos ==================== */

const MIME_ESTATICO: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json; charset=utf-8',
};

async function serveEstatico(res: ServerResponse, caminho: string, raiz: string): Promise<void> {
  const pedido = caminho === '/' ? '/index.html' : caminho;
  // `normalize` resolve o `..` ANTES da checagem de contenção; sem essa ordem, a checagem olharia
  // um caminho que o sistema de arquivos ainda vai reinterpretar.
  const alvo = resolve(join(raiz, normalize(decodeURIComponent(pedido))));
  const dentro = alvo === resolve(raiz) || alvo.startsWith(resolve(raiz) + sep);

  // Fora da raiz, ou caminho sem arquivo: devolve o index. A interface é uma página só, e
  // qualquer rota dela tem de abrir no F5.
  const arquivo = dentro ? alvo : join(raiz, 'index.html');
  try {
    const s = await stat(arquivo);
    if (!s.isFile()) throw new Error('nao e arquivo');
    const ext = extname(arquivo).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_ESTATICO[ext] ?? 'application/octet-stream',
      'Content-Length': s.size,
      // O nome do arquivo compilado carrega hash, então pode cachear para sempre; o index não.
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=31536000, immutable',
    });
    createReadStream(arquivo).pipe(res);
  } catch {
    try {
      const index = join(raiz, 'index.html');
      const s = await stat(index);
      res.writeHead(200, { 'Content-Type': MIME_ESTATICO['.html']!, 'Content-Length': s.size, 'Cache-Control': 'no-store' });
      createReadStream(index).pipe(res);
    } catch {
      responde(res, 404, { erro: 'nao-encontrado', mensagem: `Não achei ${caminho}.` });
    }
  }
}

/* ==================== utilitários ==================== */

function responde(res: ServerResponse, codigo: number, corpo: unknown): void {
  const texto = JSON.stringify(corpo);
  res.writeHead(codigo, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(texto),
  });
  res.end(texto);
}

async function leTexto(req: IncomingMessage, maximo: number): Promise<string> {
  const partes: Buffer[] = [];
  let n = 0;
  for await (const p of req) {
    n += (p as Buffer).length;
    if (n > maximo) throw new Error('corpo grande demais');
    partes.push(p as Buffer);
  }
  return Buffer.concat(partes).toString('utf-8');
}

/** Reserva ASCII do nome, para o `filename` simples do Content-Disposition. */
function asciiOuPadrao(nome: string): string {
  const ascii = nome.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  return ascii.trim() || 'arquivo';
}

export { pendentes as _pendentes };
