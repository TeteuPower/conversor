import { ROTULO_FAMILIA, formatoDe, type Capacidades, type Familia, type Formato } from '@conversor/nucleo';
import { FAMILIAS } from '@conversor/nucleo';

interface Props {
  capacidades: Capacidades;
}

/**
 * O que dá para converter hoje.
 *
 * Isto ocupa o espaço embaixo da zona de soltar na tela vazia, e não é enfeite: sem ele, a
 * primeira tela é uma caixa de arrastar sozinha num fundo, e não responde a pergunta que a
 * pessoa traz — "isto serve para o meu arquivo?". O Convertio responde essa pergunta com um
 * "mais de 300 formatos" e uma parede de logotipos de cliente; a resposta honesta é dizer
 * exatamente quais famílias funcionam agora, com os formatos à vista, e admitir o resto.
 *
 * A ordem também é uma escolha: o que funciona vem primeiro, em destaque, e o que está por vir
 * fica numa linha discreta no fim. Uma lista misturada faria a pessoa ter de conferir cada item
 * para saber onde está pisando.
 */
export function OQueDaHoje({ capacidades }: Props) {
  const disponiveis = capacidades.arestas.filter((a) => a.disponivel);

  // Agrupa pela família do DESTINO: a pergunta do usuário é "para onde eu consigo ir".
  const porFamilia = new Map<Familia, Set<string>>();
  for (const a of disponiveis) {
    const destino = formatoDe(a.para);
    if (!destino) continue;
    let jogo = porFamilia.get(destino.familia);
    if (!jogo) porFamilia.set(destino.familia, (jogo = new Set()));
    jogo.add(destino.ext);
  }

  const prontas = FAMILIAS.filter((f) => porFamilia.has(f));

  /*
   * Cada família aparece UMA vez, no marco mais próximo em que ela chega.
   *
   * A primeira versão agrupava por marco e listava as famílias de cada um — e "Documento" saía
   * três vezes na mesma frase, em três marcos diferentes, porque DOCX vem no marco 2 pelo
   * LibreOffice, EPUB para DOCX no marco 4 e o OCR no marco 5. A informação estava certa e a
   * frase, ilegível. O que o usuário quer saber é quando a família começa a servir, e isso é o
   * marco mais próximo.
   */
  const marcoDaFamilia = new Map<Familia, string>();
  for (const a of capacidades.arestas) {
    if (a.disponivel || a.ausencia?.tipo !== 'nao-implementada') continue;
    const destino = formatoDe(a.para);
    if (!destino || porFamilia.has(destino.familia)) continue;
    const atual = marcoDaFamilia.get(destino.familia);
    if (!atual || a.ausencia.marco.localeCompare(atual) < 0) {
      marcoDaFamilia.set(destino.familia, a.ausencia.marco);
    }
  }

  const marcos = new Map<string, Familia[]>();
  for (const familia of FAMILIAS) {
    const marco = marcoDaFamilia.get(familia);
    if (!marco) continue;
    const lista = marcos.get(marco);
    if (lista) lista.push(familia);
    else marcos.set(marco, [familia]);
  }

  return (
    <section className="oque">
      <h2 className="oque-titulo">
        {disponiveis.length} conversões prontas nesta máquina
      </h2>

      <ul className="oque-familias">
        {prontas.map((familia) => (
          <li key={familia} className="oque-familia">
            <span className="oque-rotulo">{ROTULO_FAMILIA[familia]}</span>
            <span className="oque-formatos">
              {[...porFamilia.get(familia)!]
                .map((ext) => formatoDe(ext))
                .filter((f): f is Formato => !!f)
                .map((f) => f.nome)
                .join(' · ')}
            </span>
          </li>
        ))}
      </ul>

      {marcos.size > 0 && (
        <p className="oque-porvir">
          Ainda não:{' '}
          {[...marcos.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([marco, familias]) => `${familias.map((f) => ROTULO_FAMILIA[f]).join(', ')} (${marco})`)
            .join('; ')}
          . O seletor mostra esses destinos em cinza, com o motivo — em vez de esconder.
        </p>
      )}
    </section>
  );
}
