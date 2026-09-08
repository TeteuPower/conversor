import { randomUUID } from 'node:crypto';
import { mkdir, open, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

/**
 * O disco de trabalho: onde a entrada é gravada e a saída fica esperando o download.
 *
 * Duas coisas mandam no desenho deste arquivo.
 *
 * A primeira é que o arquivo do usuário não é nosso. Ele fica o tempo do trabalho e vai embora,
 * por conta própria, sem depender de a interface pedir. A varredura periódica existe porque o
 * caminho mais comum de sobra em disco é o usuário fechar a aba: ninguém chama o `DELETE`, e sem
 * varredura o arquivo ficaria lá para sempre.
 *
 * A segunda é que todo caminho é montado aqui, nunca recebido de fora. O nome que o usuário
 * mandou é usado só para BATIZAR o download; em disco, o arquivo se chama pelo id do trabalho.
 * Assim `../../.ssh/id_rsa` não tem por onde virar caminho, porque o nome do usuário nunca
 * entra numa concatenação de caminho.
 */

export interface Pasta {
  readonly raiz: string;
  readonly entrada: string;
  readonly saida: string;
}

export class Armazenamento {
  private constructor(
    readonly raiz: string,
    private readonly validadeMs: number,
  ) {}

  /**
   * `.conversor` dentro do temporário do sistema, e não uma pasta no projeto: é o lugar que o
   * sistema operacional já sabe limpar, e não entra em backup nem em sincronização de nuvem —
   * que é onde um arquivo pessoal passageiro faria o maior estrago se vazasse.
   */
  static async abre(validadeSegundos: number, base = join(tmpdir(), 'conversor')): Promise<Armazenamento> {
    await mkdir(base, { recursive: true });
    return new Armazenamento(base, validadeSegundos * 1000);
  }

  /** Cria a pasta de um trabalho novo e devolve o id junto. */
  async novoTrabalho(): Promise<{ id: string; pasta: Pasta }> {
    const id = randomUUID();
    const raiz = join(this.raiz, id);
    await mkdir(raiz, { recursive: true });
    return { id, pasta: { raiz, entrada: join(raiz, 'entrada'), saida: join(raiz, 'saida') } };
  }

  /**
   * A pasta de um trabalho existente.
   *
   * O id vem da URL, então é entrada não confiável e é validado como UUID antes de encostar num
   * caminho. Sem esta checagem, `GET /api/trabalhos/..%2f..%2fetc/saida` seria uma leitura
   * arbitrária de arquivo. A validação de formato basta e é mais segura que confiar em
   * normalização de caminho, mas a checagem de contenção logo abaixo fica como segunda tranca.
   */
  pastaDe(id: string): Pasta | undefined {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return undefined;
    const raiz = resolve(join(this.raiz, id));
    if (!raiz.startsWith(resolve(this.raiz) + sep)) return undefined;
    return { raiz, entrada: join(raiz, 'entrada'), saida: join(raiz, 'saida') };
  }

  async apaga(id: string): Promise<void> {
    const pasta = this.pastaDe(id);
    if (!pasta) return;
    await rm(pasta.raiz, { recursive: true, force: true });
  }

  /**
   * Apaga o que passou da validade. Devolve quantas pastas foram embora, para o log.
   *
   * A idade sai do `mtime` da pasta, e não de um registro em memória, porque assim a varredura
   * também recolhe o que ficou de uma execução anterior do servidor — o caso do usuário que
   * fechou tudo no meio de uma conversão.
   */
  async varre(): Promise<number> {
    let apagadas = 0;
    let nomes: string[];
    try {
      nomes = await readdir(this.raiz);
    } catch {
      return 0;
    }
    const limite = Date.now() - this.validadeMs;
    for (const nome of nomes) {
      const pasta = this.pastaDe(nome);
      if (!pasta) continue;
      try {
        const s = await stat(pasta.raiz);
        if (s.mtimeMs < limite) {
          await rm(pasta.raiz, { recursive: true, force: true });
          apagadas++;
        }
      } catch {
        // Corrida com outra varredura, ou pasta apagada por fora. Nada a fazer.
      }
    }
    return apagadas;
  }

  /** Agenda a varredura. Devolve como cancelar, para o desligamento limpo. */
  varreDeVezEmQuando(intervaloMs: number, aoVarrer?: (n: number) => void): () => void {
    const t = setInterval(() => {
      void this.varre().then((n) => {
        if (n > 0) aoVarrer?.(n);
      });
    }, intervaloMs);
    // `unref` para a varredura não segurar o processo vivo no `npm start` de um script.
    t.unref?.();
    return () => clearInterval(t);
  }
}

/**
 * Grava uma sequência de partes num arquivo, sem juntá-las na memória.
 *
 * Existe porque `Buffer.concat(partes)` custa uma CÓPIA do total. O escritor de ZIP e o escritor
 * de PDF devolvem partes justamente para não haver essa cópia — está escrito no cabeçalho dos
 * dois —, e a engine de PDF concatenava de todo jeito, contradizendo a documentação do que ela
 * chamava. Num PDF de vinte páginas o pico de memória era o dobro do necessário sem razão
 * nenhuma.
 *
 * A escrita é sequencial e não paralela: a ordem das partes É o formato do arquivo, e um
 * `Promise.all` aqui gravaria a tabela de referências antes dos objetos.
 */
export async function gravaPartes(
  caminho: string,
  partes: readonly Uint8Array[],
): Promise<number> {
  const arquivo = await open(caminho, 'w');
  try {
    let escritos = 0;
    for (const parte of partes) {
      await arquivo.write(parte);
      escritos += parte.length;
    }
    return escritos;
  } finally {
    await arquivo.close();
  }
}

/**
 * Deixa um nome de arquivo seguro para ir num cabeçalho HTTP e para ser gravado em qualquer
 * sistema de arquivos.
 *
 * Isto NÃO é o que protege o disco — o disco está protegido porque o nome do usuário nunca entra
 * num caminho. Isto protege o download: um nome com `"` ou com quebra de linha quebraria o
 * `Content-Disposition`, e um nome com `:` ou `?` não grava no Windows.
 */
export function nomeSeguro(nome: string, padrao = 'arquivo'): string {
  const base = nome.split(/[/\\]/).pop() ?? '';
  const limpo = base
    // Controle e DEL, com escape explicito: caractere de controle literal no fonte e
    // invisivel no diff e some em copiar e colar.
    .replace(/[\u0000-\u001f\u007f]/g, '')
    // Reservados do Windows. No Linux passariam, mas o nome do download tem de servir nos dois.
    .replace(/["*:<>?|]/g, '-')
    .replace(/^\.+/, '')
    .trim();
  // Nome de dispositivo reservado do Windows: `CON.png` não grava, com ou sem extensão.
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(limpo)) return `_${limpo}`;
  return limpo.slice(0, 180) || padrao;
}
