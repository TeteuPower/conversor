import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import ort from 'onnxruntime-node';
import type { EstadoDosModelos, ModeloFundo, ProvedorExecucao } from '@conversor/nucleo';

/**
 * De onde vem o modelo, onde ele fica e em qual processador ele roda.
 *
 * ---
 *
 * **Por que o peso não está no repositório.** São 490 MB. Git guarda binário mal, o clone
 * passaria de meio giga e a CI baixaria isso a cada execução. O peso é baixado na primeira vez
 * que a ferramenta é usada, verificado por SHA-256 e guardado fora do projeto.
 *
 * **Por que fora do projeto.** Em `%LOCALAPPDATA%` (ou `~/.local/share` no Linux) o arquivo
 * sobrevive a um `git clean -xdf`, não entra em backup e não é sincronizado para nuvem nenhuma.
 * Baixar 490 MB de novo porque alguém limpou a árvore seria um castigo desnecessário.
 *
 * ---
 *
 * **Por que fp16 e não o fp32 "completo".**
 *
 * Medido nesta máquina — RTX 4070 Laptop, i7-14700HX, Windows 11, entrada de 1024 × 1024:
 *
 * | peso                    | provedor  | por imagem                        |
 * |-------------------------|-----------|-----------------------------------|
 * | BiRefNet fp32, 972 MB   | DirectML  | **falha** — estoura a memória     |
 * | BiRefNet fp32, 972 MB   | CPU       | 29 530 ms                         |
 * | BiRefNet fp16, 490 MB   | DirectML  | **2 040 ms**                      |
 * | BiRefNet lite fp16, 114 | DirectML  | 2 697 ms                          |
 *
 * O fp32 foi baixado, testado e descartado: na GPU ele nem roda (`8007000E`, num nó fundido do
 * DirectML, em todos os `deviceId`), e na CPU leva meio minuto por imagem, o que não é uma
 * ferramenta interativa. O fp16 é o MESMO modelo com metade da memória de peso — a diferença de
 * precisão não aparece numa máscara que vira 8 bits por pixel no fim — e cabe na GPU.
 *
 * Curiosidade útil: o modelo completo em fp16 é mais RÁPIDO que o lite (2,0 s contra 2,7 s). O
 * lite tem menos parâmetros, mas a arquitetura dele mapeia pior nos núcleos do DirectML. É o
 * tipo de coisa que só a medição diz — pelo tamanho do arquivo, a aposta seria a contrária. O
 * lite fica no catálogo porque é o que salva máquina sem GPU sobrando.
 *
 * **A escolha do provedor, e as duas conclusões que viraram código.**
 *
 * A primeira: **criar a sessão não prova nada.** O DirectML aceitou criar a sessão do fp32 e só
 * quebrou ao executar. Então a detecção aqui não pergunta "dá para criar?", ela RODA uma
 * inferência de verdade e só confia no provedor que devolveu resultado.
 *
 * A segunda: **o resultado é lembrado em disco.** Descobrir o provedor custa uma inferência
 * falha mais uma boa; refazer isso a cada vez que o servidor sobe seria cobrar do usuário um
 * imposto por uma resposta que não muda. Fica em `provedores.json`, ao lado dos pesos, e some
 * junto se o modelo for apagado.
 */

export const DIR_MODELOS = (): string => {
  const base =
    process.platform === 'win32'
      ? (process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'))
      : (process.env['XDG_DATA_HOME'] ?? join(homedir(), '.local', 'share'));
  return join(base, 'conversor', 'modelos');
};

interface Definicao {
  readonly id: string;
  readonly nome: string;
  readonly descricao: string;
  readonly arquivo: string;
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly entrada: number;
  readonly licenca: string;
  readonly origem: string;
  /** Normalização esperada pelo modelo. BiRefNet usa a da ImageNet. */
  readonly media: readonly [number, number, number];
  readonly desvio: readonly [number, number, number];
  /**
   * A saída é logito e precisa de sigmoide?
   *
   * Verificado rodando: a saída do BiRefNet veio na faixa 4,4 a 20,5, e sigmoide nenhuma passa
   * de 1. Então é logito, e sem a sigmoide a máscara sairia saturada em branco.
   */
  readonly precisaSigmoide: boolean;
}

/**
 * Os pesos disponíveis.
 *
 * Só entra aqui peso com licença permissiva — os dois são MIT. O RMBG da BRIA, que aparece em
 * toda comparação como um dos melhores, ficou de fora de propósito: é CC BY-NC, proibido em uso
 * comercial, e isto aqui roda numa máquina de trabalho.
 */
export const CATALOGO: readonly Definicao[] = [
  {
    id: 'birefnet',
    nome: 'BiRefNet',
    descricao:
      'O melhor recorte de borda fina que existe em peso aberto: cabelo solto, pelo, folhagem e ' +
      'vão entre dedos. É o mais pesado dos dois e o que vale a espera.',
    arquivo: 'birefnet-fp16.onnx',
    url: 'https://huggingface.co/onnx-community/BiRefNet-ONNX/resolve/main/onnx/model_fp16.onnx',
    bytes: 489_666_272,
    sha256: '3654c741eb80bd926ada8fed1713b506ccf8d30eb1f6487e87eb9f234f33df09',
    entrada: 1024,
    licenca: 'MIT',
    origem: 'onnx-community/BiRefNet-ONNX',
    media: [0.485, 0.456, 0.406],
    desvio: [0.229, 0.224, 0.225],
    precisaSigmoide: true,
  },
  {
    id: 'birefnet-lite',
    nome: 'BiRefNet lite',
    descricao:
      'A versão leve do mesmo modelo: um quarto do tamanho e bem mais rápida, com borda um ' +
      'pouco menos fina. É a que serve quando a máquina não tem GPU sobrando.',
    arquivo: 'birefnet-lite-fp16.onnx',
    url: 'https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/resolve/main/onnx/model_fp16.onnx',
    bytes: 114_538_221,
    sha256: 'd39b897ceb16ae654c1731f3dba0cf9b368d9cae74b5a57459b455cc8bfec402',
    entrada: 1024,
    licenca: 'MIT',
    origem: 'onnx-community/BiRefNet_lite-ONNX',
    media: [0.485, 0.456, 0.406],
    desvio: [0.229, 0.224, 0.225],
    precisaSigmoide: true,
  },
];

export function definicao(id: string): Definicao | undefined {
  return CATALOGO.find((m) => m.id === id);
}

export const PADRAO = 'birefnet';

/** Ordem de preferência. O que de fato funciona é descoberto rodando; ver o cabeçalho. */
const ORDEM_PROVEDORES: readonly ProvedorExecucao[] = ['dml', 'cuda', 'cpu'];

/* ==================== disco ==================== */

const caminhoDe = (d: Definicao): string => join(DIR_MODELOS(), d.arquivo);

async function existeCompleto(d: Definicao): Promise<boolean> {
  try {
    const s = await stat(caminhoDe(d));
    // O tamanho exato é a checagem barata contra download interrompido. O SHA-256 é caro (meio
    // giga de leitura) e fica para depois do download, uma vez só.
    return s.size === d.bytes;
  } catch {
    return false;
  }
}

export interface RelatorDownload {
  (baixados: number, total: number): void;
}

/**
 * Baixa o peso, verifica e põe no lugar.
 *
 * Grava em `.parcial` e só renomeia no fim. Sem isso, um download interrompido — fechar o
 * terminal, cair a rede — deixaria meio arquivo com o nome do arquivo bom, e a próxima execução
 * carregaria um ONNX truncado e quebraria com uma mensagem que não ajuda ninguém.
 */
export async function baixa(id: string, relata?: RelatorDownload): Promise<void> {
  const d = definicao(id);
  if (!d) throw new Error(`Modelo desconhecido: ${id}`);
  if (await existeCompleto(d)) return;

  await mkdir(DIR_MODELOS(), { recursive: true });
  const destino = caminhoDe(d);
  const parcial = `${destino}.parcial`;

  const resposta = await fetch(d.url, { redirect: 'follow' });
  if (!resposta.ok || !resposta.body) {
    throw new Error(`Não deu para baixar ${d.nome}: HTTP ${resposta.status}. Verifique a conexão.`);
  }

  const total = Number(resposta.headers.get('content-length') ?? d.bytes);
  let baixados = 0;
  const hash = createHash('sha256');

  const contado = new ReadableStream<Uint8Array>({
    async start(controller) {
      const leitor = resposta.body!.getReader();
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        baixados += value.byteLength;
        hash.update(value);
        relata?.(baixados, total);
        controller.enqueue(value);
      }
      controller.close();
    },
  });

  await pipeline(Readable.fromWeb(contado as never), createWriteStream(parcial));

  const tamanho = (await stat(parcial)).size;
  if (tamanho !== d.bytes) {
    await rm(parcial, { force: true });
    throw new Error(
      `${d.nome} baixou ${tamanho} bytes, mas eram esperados ${d.bytes}. O download foi ` +
        'interrompido ou o arquivo mudou na origem.',
    );
  }
  const digest = hash.digest('hex');
  if (d.sha256 && digest !== d.sha256) {
    await rm(parcial, { force: true });
    throw new Error(
      `${d.nome} não confere: esperado SHA-256 ${d.sha256}, veio ${digest}. O arquivo pode ter ` +
        'sido adulterado na origem — nada foi instalado.',
    );
  }
  await rename(parcial, destino);
}

export async function apaga(id: string): Promise<void> {
  const d = definicao(id);
  if (!d) return;
  await rm(caminhoDe(d), { force: true });
  sessoes.delete(id);
  const lembrado = await leProvedores();
  delete lembrado[id];
  await gravaProvedores(lembrado);
}

/* ==================== provedor lembrado ==================== */

const arquivoProvedores = (): string => join(DIR_MODELOS(), 'provedores.json');

async function leProvedores(): Promise<Record<string, ProvedorExecucao>> {
  try {
    return JSON.parse(await readFile(arquivoProvedores(), 'utf8')) as Record<string, ProvedorExecucao>;
  } catch {
    return {};
  }
}

async function gravaProvedores(v: Record<string, ProvedorExecucao>): Promise<void> {
  try {
    await mkdir(DIR_MODELOS(), { recursive: true });
    await writeFile(arquivoProvedores(), JSON.stringify(v, null, 2), 'utf8');
  } catch {
    // Não poder lembrar só custa redescobrir na próxima. Não é motivo para falhar a conversão.
  }
}

/* ==================== sessão ==================== */

export interface SessaoPronta {
  readonly sessao: ort.InferenceSession;
  readonly provedor: ProvedorExecucao;
  readonly definicao: Definicao;
}

const sessoes = new Map<string, Promise<SessaoPronta>>();

/**
 * Devolve a sessão pronta, criando e escolhendo o provedor na primeira vez.
 *
 * A sessão é guardada porque criar custa muito: 9 s no DirectML e 14 s na CPU, medidos com o
 * modelo de 972 MB. Pagar isso por imagem tornaria a ferramenta inutilizável em lote.
 */
export function sessao(id: string): Promise<SessaoPronta> {
  const existente = sessoes.get(id);
  if (existente) return existente;
  const nova = criaSessao(id);
  sessoes.set(id, nova);
  // Uma criação que falha não pode ficar guardada, senão a falha vira permanente até reiniciar.
  void nova.catch(() => sessoes.delete(id));
  return nova;
}

async function criaSessao(id: string): Promise<SessaoPronta> {
  const d = definicao(id);
  if (!d) throw new Error(`Modelo desconhecido: ${id}`);
  if (!(await existeCompleto(d))) {
    throw new Error(`O peso de ${d.nome} ainda não foi baixado.`);
  }

  const caminho = caminhoDe(d);
  const lembrado = await leProvedores();
  const preferidos = lembrado[id] ? [lembrado[id]!] : ORDEM_PROVEDORES;
  const problemas: string[] = [];

  for (const provedor of preferidos) {
    try {
      const s = await ort.InferenceSession.create(caminho, {
        executionProviders: [provedor],
        graphOptimizationLevel: 'all',
      });
      // Criar não prova nada — ver o cabeçalho. Só uma inferência de verdade prova.
      await provaDeVida(s, d);
      if (lembrado[id] !== provedor) {
        lembrado[id] = provedor;
        await gravaProvedores(lembrado);
      }
      return { sessao: s, provedor, definicao: d };
    } catch (e) {
      problemas.push(`${provedor}: ${primeiraLinha((e as Error).message)}`);
    }
  }

  // O provedor lembrado parou de funcionar (trocou de GPU, atualizou driver): esquece e
  // redescobre, em vez de deixar a ferramenta morta.
  if (lembrado[id]) {
    delete lembrado[id];
    await gravaProvedores(lembrado);
    return criaSessao(id);
  }

  throw new Error(
    `Nenhum provedor de execução conseguiu rodar ${d.nome} nesta máquina.\n${problemas.join('\n')}`,
  );
}

/**
 * Roda uma imagem mínima só para ver se o provedor entrega resultado.
 *
 * É a prova de vida que o DirectML reprovou: ele cria a sessão e quebra ao executar. Como a
 * forma da entrada é fixa em 1024×1024, não dá para fazer barato — a prova custa uma inferência
 * inteira, e é o preço de não descobrir isso na cara do usuário.
 */
async function provaDeVida(s: ort.InferenceSession, d: Definicao): Promise<void> {
  const n = 3 * d.entrada * d.entrada;
  const nome = s.inputNames[0]!;
  const meta = s.inputMetadata?.[0];
  const tipo = meta && meta.isTensor ? meta.type : 'float32';
  const entrada =
    tipo === 'float16'
      ? new ort.Tensor('float16', new Uint16Array(n), [1, 3, d.entrada, d.entrada])
      : new ort.Tensor('float32', new Float32Array(n), [1, 3, d.entrada, d.entrada]);
  const saida = await s.run({ [nome]: entrada });
  const chave = s.outputNames[s.outputNames.length - 1]!;
  const t = saida[chave];
  if (!t || t.data.length === 0) throw new Error('o provedor devolveu saída vazia');
}

const primeiraLinha = (s: string): string => String(s).split('\n')[0]!.slice(0, 140);

/* ==================== estado, para a interface ==================== */

export async function estado(): Promise<EstadoDosModelos> {
  const lembrado = await leProvedores();
  const modelos: ModeloFundo[] = [];
  for (const d of CATALOGO) {
    const baixado = await existeCompleto(d);
    const provedor = lembrado[d.id];
    modelos.push({
      id: d.id,
      nome: d.nome,
      descricao: d.descricao,
      bytes: d.bytes,
      licenca: d.licenca,
      origem: d.origem,
      entrada: d.entrada,
      baixado,
      ...(provedor ? { medido: { provedor, ms: 0 } } : {}),
    });
  }
  return {
    modelos,
    padrao: PADRAO,
    provedores: [...new Set(Object.values(lembrado))],
  };
}
