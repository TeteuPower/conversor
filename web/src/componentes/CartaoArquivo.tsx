import { useState } from 'react';
import { bytes, diferencaTamanho, duracao, formatoDe } from '@conversor/nucleo';
import { ehAtivo, type ItemFila } from '../estado/fila.js';
import { BarraDeProgresso } from './BarraDeProgresso.js';

interface Props {
  item: ItemFila;
  agora: number;
  /** Posição na tela, para o escalonamento da entrada. Ver `atrasoDaEntrada`. */
  indiceNaTela: number;
  aoTrocarDestino: () => void;
  aoAbrirOpcoes: () => void;
  aoRemover: () => void;
  aoCancelar: () => void;
  aoTentarDeNovo: () => void;
}

/**
 * O escalonamento da entrada.
 *
 * 55 ms entre um cartão e o seguinte: soltar cinco arquivos de uma vez e ver cinco cartões
 * aparecerem no mesmo instante é um borrão, e o olho não consegue contar o que apareceu.
 *
 * O teto de 8 posições é o que impede a boa ideia de virar defeito. Sem ele, soltar quarenta
 * arquivos deixaria o último aparecendo 2,2 s depois do primeiro, e o usuário estaria esperando
 * a interface em vez do contrário. Do nono cartão em diante todos entram juntos — a essa altura
 * a chegada já foi comunicada, e o que falta é a lista existir.
 */
const PASSO_ENTRADA_MS = 55;
const MAX_POSICOES_ESCALONADAS = 8;

export function atrasoDaEntrada(indiceNaTela: number): number {
  return Math.min(indiceNaTela, MAX_POSICOES_ESCALONADAS) * PASSO_ENTRADA_MS;
}

export function CartaoArquivo({
  item,
  agora,
  indiceNaTela,
  aoTrocarDestino,
  aoAbrirOpcoes,
  aoRemover,
  aoCancelar,
  aoTentarDeNovo,
}: Props) {
  const [diagAberto, setDiagAberto] = useState(false);
  const origem = formatoDe(item.de);
  const destino = formatoDe(item.para);
  const ativo = ehAtivo(item.estado);
  const pronto = item.estado === 'concluido' && item.saida;

  return (
    // A animacao de entrada mora no proprio <li>. Ela ja esteve num <div> envolvendo o cartao, e
    // aquilo era HTML invalido: <ul> so aceita <li> como filho, e um <div> ali faz o leitor de
    // tela deixar de anunciar a lista como lista.
    <li
      className="cartao entra"
      data-estado={item.estado}
      style={{ '--atraso': `${atrasoDaEntrada(indiceNaTela)}ms` } as React.CSSProperties}
    >
      <div className="cartao-corpo">
        <Miniatura item={item} />

        <div className="cartao-meio">
          <div className="cartao-nome-linha">
            <span className="cartao-nome" title={item.arquivo.name}>
              {item.arquivo.name}
            </span>
            <span className="cartao-tamanho">{bytes(item.arquivo.size)}</span>
          </div>

          <div className="cartao-rota">
            <span className="selo-formato">{origem?.nome ?? item.de.toUpperCase()}</span>
            <SetaRota />
            <button
              className="selo-destino"
              onClick={aoTrocarDestino}
              disabled={ativo}
              aria-label={`Trocar o formato de saída, hoje ${destino?.nome ?? item.para}`}
            >
              {destino?.nome ?? item.para.toUpperCase()}
              <IconeSeta />
            </button>

            {item.engine === 'vetorizador' && (
              <span className="selo-local" title="Esta conversão roda no próprio navegador: o arquivo não passa nem pelo localhost.">
                no navegador
              </span>
            )}
          </div>

          {(ativo || pronto || item.estado === 'falhou') && (
            <BarraDeProgresso
              fracao={item.fracao}
              estado={item.estado}
              rotulo={item.rotulo}
              detalhe={item.detalhe}
              {...(item.iniciadoEm ? { iniciadoEm: item.iniciadoEm, agora } : {})}
              rotuloAcessivel={`Progresso de ${item.arquivo.name}`}
            />
          )}

          {pronto && (
            <p className="cartao-resultado">
              <span className="visto-bolha pulsa-bom" aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path
                    className="visto-traco"
                    d="M3 8.5l3.2 3.2L13 5"
                    stroke="currentColor"
                    strokeWidth="2.1"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <strong>{bytes(item.saida!.tamanho)}</strong>
              {(() => {
                const dif = diferencaTamanho(item.arquivo.size, item.saida!.tamanho);
                return dif ? <span className="cartao-delta">{dif}</span> : null;
              })()}
              {item.duracaoMs !== undefined && (
                <span className="cartao-duracao">em {duracao(item.duracaoMs)}</span>
              )}
            </p>
          )}

          {item.avisos.map((a) => (
            <p className="nota nota-atencao" key={a}>
              <IconeAtencao />
              <span>{a}</span>
            </p>
          ))}

          {item.erro && (
            <div className="nota nota-ruim">
              <IconeRuim />
              <div>
                <span>{item.erro.mensagem}</span>
                {item.erro.detalhe && (
                  <details className="detalhe-tecnico">
                    <summary>Detalhe técnico</summary>
                    <pre>{item.erro.detalhe}</pre>
                  </details>
                )}
              </div>
            </div>
          )}

          {pronto && item.saida!.diagnostico && (
            <>
              <button
                className="botao-fantasma botao-mini"
                onClick={() => setDiagAberto((v) => !v)}
                aria-expanded={diagAberto}
              >
                {diagAberto ? 'Esconder' : 'O que a engine fez'}
              </button>
              {diagAberto && <Diagnostico dados={item.saida!.diagnostico} />}
            </>
          )}
        </div>

        <div className="cartao-acoes">
          {pronto && (
            <a
              className="botao-principal botao-baixar"
              href={item.saida!.url}
              download={item.saida!.nome}
            >
              <IconeBaixar />
              Baixar
            </a>
          )}

          {ativo && (
            <button className="botao-fantasma" onClick={aoCancelar}>
              Cancelar
            </button>
          )}

          {(item.estado === 'falhou' || item.estado === 'cancelado') && (
            <button className="botao-secundario" onClick={aoTentarDeNovo}>
              Tentar de novo
            </button>
          )}

          {!ativo && (
            <>
              <button
                className="botao-icone"
                onClick={aoAbrirOpcoes}
                aria-label={`Opções de ${item.arquivo.name}`}
                title="Opções"
              >
                <IconeEngrenagem />
              </button>
              <button
                className="botao-icone"
                onClick={aoRemover}
                aria-label={`Remover ${item.arquivo.name} da fila`}
                title="Remover"
              >
                <IconeLixo />
              </button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * A miniatura da entrada.
 *
 * Ela existe porque a fila costuma ter vários arquivos com nome parecido — `captura-1.png`,
 * `captura-2.png` — e o nome não basta para saber qual é qual. A imagem resolve isso na hora.
 *
 * Quando não há miniatura (o navegador não lê o formato, ou não é imagem), o lugar dela recebe a
 * extensão em caixa alta. O importante é o espaço não colapsar: os cartões precisam alinhar, ou
 * a lista fica serrilhada.
 */
function Miniatura({ item }: { item: ItemFila }) {
  const [quebrou, setQuebrou] = useState(false);
  const mostra = item.miniatura && !quebrou;
  return (
    <div className="miniatura" data-vazia={mostra ? 'nao' : 'sim'}>
      {mostra ? (
        <img src={item.miniatura} alt="" loading="lazy" onError={() => setQuebrou(true)} />
      ) : (
        <span>{item.de.toUpperCase()}</span>
      )}
    </div>
  );
}

/**
 * Os campos do diagnóstico que valem ser lidos, com nome de gente.
 *
 * Esta curadoria existe porque o dump cru não servia. O vetorizador devolve mais de quarenta
 * campos — cada tentativa de K, cada camada, cada percentil de resíduo — e mostrados todos de
 * uma vez eles ocupavam mais tela que o cartão inteiro, o que na prática esconde a informação
 * em vez de mostrá-la. Estes oito respondem as perguntas que alguém de fato faz ao olhar o
 * resultado, e o resto continua ali, atrás de um clique.
 */
const DESTAQUES: readonly (readonly [string, string])[] = [
  ['K', 'classes de cor'],
  ['nos', 'nós de curva'],
  ['residuoPior', 'pior resíduo (0-255)'],
  ['cobertura', 'cobertura da amostra'],
  ['modo', 'tipo de imagem'],
  ['chapeza', 'chapeza'],
  ['paleta', 'paleta'],
  ['entrada.formato', 'formato lido'],
  ['achatouAlfa', 'achatou a transparência'],
];

/**
 * O diagnóstico da engine.
 *
 * Aparece fechado, e é o usuário que abre — quem só quer o arquivo não deveria ter de passar por
 * isto. Mas para quem quer entender por que o SVG saiu como saiu, é ouro: o resíduo do modelo de
 * pintura diz o quanto a cor foi aproximada, e a contagem de nós diz o quanto o contorno foi
 * simplificado.
 */
function Diagnostico({ dados }: { dados: Record<string, unknown> }) {
  const todas = achata(dados);
  const mapa = new Map(todas);

  const destaques = DESTAQUES.map(([chave, rotulo]) => [rotulo, mapa.get(chave)] as const).filter(
    (par): par is readonly [string, string] => par[1] !== undefined,
  );
  const chavesDestacadas = new Set(DESTAQUES.map(([c]) => c));
  const resto = todas.filter(([c]) => !chavesDestacadas.has(c));

  return (
    <div className="painel-entra">
      <dl className="diagnostico">
        {destaques.map(([rotulo, valor]) => (
          <div key={rotulo}>
            <dt>{rotulo}</dt>
            <dd>{valor}</dd>
          </div>
        ))}
      </dl>
      {resto.length > 0 && (
        <details className="diagnostico-resto">
          <summary>Tudo o que a engine reportou ({resto.length} campos)</summary>
          <dl className="diagnostico">
            {resto.map(([chave, valor]) => (
              <div key={chave}>
                <dt>{chave}</dt>
                <dd>{valor}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
}

function achata(o: unknown, prefixo = '', profundidade = 0): [string, string][] {
  if (profundidade > 3 || o === null || o === undefined) return [];
  if (Array.isArray(o)) {
    // Array de objeto (as tentativas de K, as camadas) vira uma linha por item; array de valor
    // simples vira uma linha só, com os valores juntos.
    if (o.length === 0) return [];
    if (typeof o[0] === 'object') {
      return o.flatMap((v, i) => achata(v, `${prefixo}[${i}]`, profundidade + 1));
    }
    return [[prefixo, o.map(String).join(', ')]];
  }
  if (typeof o === 'object') {
    return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
      achata(v, prefixo ? `${prefixo}.${k}` : k, profundidade + 1),
    );
  }
  return [[prefixo, typeof o === 'number' ? formataNumero(o) : String(o)]];
}

const formataNumero = (n: number): string =>
  Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '').replace('.', ',');

/* ==================== ícones ==================== */

const SetaRota = () => (
  <svg width="16" height="10" viewBox="0 0 16 10" fill="none" aria-hidden="true" className="seta-rota">
    <path d="M1 5h12M9.5 1.5L13 5l-3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconeSeta = () => (
  <svg width="9" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true">
    <path d="M1 1.5L5 5l4-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconeBaixar = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 2v8m0 0L4.8 6.8M8 10l3.2-3.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M2.5 12.5h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

const IconeEngrenagem = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.4" />
    <path
      d="M8 1.6v1.6M8 12.8v1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M1.6 8h1.6M12.8 8h1.6M3.5 12.5l1.1-1.1M11.4 4.6l1.1-1.1"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </svg>
);

const IconeLixo = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2.8 4.5h10.4M6 4.5V3.2h4v1.3M4.2 4.5l.6 8.3h6.4l.6-8.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconeAtencao = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 2.4l6 11.2H2z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    <path d="M8 6.6v3.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="8" cy="11.6" r="0.75" fill="currentColor" />
  </svg>
);

const IconeRuim = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.4" />
    <path d="M8 4.8v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="8" cy="11" r="0.75" fill="currentColor" />
  </svg>
);
