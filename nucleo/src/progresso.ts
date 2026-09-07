import type { Etapa } from './tipos.js';

/**
 * O contador de progresso.
 *
 * A regra da casa é uma só: a barra não mente. Ela não anda sozinha num timer, não trava em 90%
 * esperando o processo acabar e não volta atrás. Toda engine declara as suas etapas com um peso
 * cada e, enquanto trabalha, diz apenas quanto andou DENTRO da etapa em que está. A fração
 * global sai daqui.
 *
 * De onde vêm os pesos: de medição, não de palpite. Estão anotados no arquivo de cada engine,
 * junto ao caso que os calibrou.
 *
 * Duas garantias que o tipo não dá e este objeto dá:
 *
 * 1. **Monotonia.** Se uma engine reportar uma etapa fora de ordem — acontece quando o trabalho
 *    é paralelo e o relato chega desencontrado — a fração devolvida é a maior já vista, não a
 *    recém-calculada. Barra que anda para trás parece defeito mesmo quando o número está certo.
 *
 * 2. **O último passo é do fim, não do progresso.** `fracao` nunca chega a 1 por conta das
 *    etapas: fecha em 0,999. O 1 só sai de `conclui()`. Assim a interface pode confiar que
 *    100% quer dizer "o arquivo está pronto para baixar", e não "a última etapa terminou e
 *    ainda falta escrever em disco".
 */
export class Progresso {
  private readonly etapas: readonly Etapa[];
  private readonly pesoTotal: number;
  /** Peso acumulado ANTES de cada etapa, por id. */
  private readonly antes = new Map<string, number>();
  private maiorJaVista = 0;
  private terminado = false;

  constructor(etapas: readonly Etapa[]) {
    if (etapas.length === 0) throw new Error('Progresso precisa de pelo menos uma etapa.');
    for (const e of etapas) {
      if (!(e.peso > 0)) throw new Error(`Etapa "${e.id}" tem peso ${e.peso}; precisa ser > 0.`);
    }
    const ids = new Set(etapas.map((e) => e.id));
    if (ids.size !== etapas.length) throw new Error('Há etapas com o mesmo id.');

    this.etapas = etapas;
    let acumulado = 0;
    for (const e of etapas) {
      this.antes.set(e.id, acumulado);
      acumulado += e.peso;
    }
    this.pesoTotal = acumulado;
  }

  /** As etapas declaradas, para mandar à interface no evento `etapas`. */
  get declaradas(): readonly Etapa[] {
    return this.etapas;
  }

  /**
   * Onde estamos: `dentro` é 0..1 da etapa `id`.
   *
   * Um `dentro` fora de faixa é aparado em vez de lançar erro: a engine tipicamente calcula isso
   * de uma divisão (`quadro / total`), e um total estimado errado não deve derrubar a conversão
   * inteira por causa da barra.
   */
  em(id: string, dentro = 0): number {
    const base = this.antes.get(id);
    if (base === undefined) throw new Error(`Etapa desconhecida: "${id}".`);
    const etapa = this.etapas.find((e) => e.id === id)!;
    const aparado = dentro < 0 ? 0 : dentro > 1 ? 1 : dentro;
    const bruta = (base + etapa.peso * aparado) / this.pesoTotal;

    // Teto em 0,999: o 1 é privilégio de conclui(). Ver o item 2 do cabeçalho.
    const comTeto = Math.min(bruta, 0.999);
    this.maiorJaVista = Math.max(this.maiorJaVista, comTeto);
    return this.maiorJaVista;
  }

  /** Fecha em 1. Só isto devolve 1. */
  conclui(): number {
    this.terminado = true;
    this.maiorJaVista = 1;
    return 1;
  }

  get fracao(): number {
    return this.maiorJaVista;
  }

  get concluido(): boolean {
    return this.terminado;
  }
}

/**
 * Estima quanto falta, em milissegundos, a partir do que já andou.
 *
 * Deliberadamente burro: extrapola linear do tempo decorrido. Um estimador esperto (média móvel,
 * regressão sobre as etapas) foi tentado e ficou PIOR de usar — ele corrigia o número para
 * baixo e para cima a cada relato, e o texto ficava pulando entre "8 s" e "23 s" duas vezes por
 * segundo. Com a extrapolação linear o número só cai, e ele cai suave.
 *
 * Devolve `undefined` enquanto não há base para chutar: antes de 2% de progresso qualquer
 * extrapolação erra por ordem de grandeza, e é melhor a interface não mostrar nada do que
 * mostrar "faltam 4 minutos" numa conversão de três segundos.
 */
export function estimaRestante(fracao: number, decorridoMs: number): number | undefined {
  if (fracao < 0.02 || fracao >= 1 || decorridoMs < 400) return undefined;
  return Math.round((decorridoMs / fracao) * (1 - fracao));
}
