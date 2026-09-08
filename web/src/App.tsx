import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  ENTRADAS_VETORIZADOR,
  Grafo,
  ID_VETORIZADOR,
  bytes,
  formatoDoNome,
  nomesUnicos,
  percentual,
  type Aresta,
  type Capacidades,
  type Opcoes,
} from '@conversor/nucleo';
import {
  ErroDeConversao,
  buscaCapacidades,
  cancelaNoServidor,
  converteNoServidor,
  type RelatorioDeAndamento,
} from './api.js';
import { sondaDecodificacao, vetorizaNoNavegador } from './engines/vetorizador.js';
import {
  concluidos,
  contaPor,
  descarta,
  ehAtivo,
  filaVazia,
  progressoDoConjunto,
  prontosParaConverter,
  reduz,
  type ItemFila,
  type NovoArquivo,
} from './estado/fila.js';
import { BarraDeProgresso } from './componentes/BarraDeProgresso.js';
import { Cabecalho, usaTema } from './componentes/Cabecalho.js';
import { CartaoArquivo } from './componentes/CartaoArquivo.js';
import { OQueDaHoje } from './componentes/OQueDaHoje.js';
import { zipComoBlob } from './envelope.js';
import { PainelDeOpcoes } from './componentes/PainelDeOpcoes.js';
import { SeletorDeFormato } from './componentes/SeletorDeFormato.js';
import { ZonaDeSoltar } from './componentes/ZonaDeSoltar.js';

/**
 * Quantas vetorizações ao mesmo tempo: 2.
 *
 * Cada uma é um worker, e cada worker é uma thread ocupando um núcleo por 1 a 3 segundos sem
 * ceder. O limite é baixo de propósito: com quatro workers girando, a thread principal disputa
 * núcleo com eles e a animação da barra começa a pular — o que estragaria exatamente o que este
 * projeto está tentando fazer bem.
 *
 * As conversões de servidor NÃO passam por este limite: quem enfileira lá é o servidor, que
 * conhece os núcleos da máquina e já reserva um.
 */
const VETORIZACOES_EM_PARALELO = 2;

/** De quanto em quanto tempo o "faltam N s" é recalculado. */
const PULSO_ESTIMATIVA_MS = 500;

export function App() {
  const [tema, setTema] = usaTema();
  const [capacidades, setCapacidades] = useState<Capacidades>();
  const [erroDeConexao, setErroDeConexao] = useState<string>();
  const [recusados, setRecusados] = useState<string[]>([]);
  const [fila, despacha] = useReducer(reduz, filaVazia);
  const [seletorDe, setSeletorDe] = useState<string>();
  const [opcoesDe, setOpcoesDe] = useState<string>();
  const [zipando, setZipando] = useState(false);

  /**
   * Os controladores de cancelamento, num ref e não no estado.
   *
   * Um `AbortController` não é dado de tela: mudá-lo não deve repintar nada, e ele não sobrevive
   * a serialização. Guardá-lo no estado do redutor tornaria o estado impuro.
   */
  const controladores = useRef(new Map<string, AbortController>());

  /* ==================== capacidades ==================== */

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const c = await buscaCapacidades();
        if (!vivo) return;

        // A sonda confirma, decodificando de verdade, o que ESTE navegador lê. O servidor manda
        // a lista do vetorizador com otimismo — ele não sabe em que navegador a página abriu.
        const { recusados: naoLidos } = await sondaDecodificacao(ENTRADAS_VETORIZADOR);
        if (!vivo) return;

        setCapacidades(naoLidos.length === 0 ? c : semAsEntradasRecusadas(c, naoLidos));
      } catch (e) {
        if (!vivo) return;
        setErroDeConexao(
          e instanceof Error
            ? `${e.message} O servidor de conversão precisa estar rodando: \`npm start\` na raiz do projeto.`
            : String(e),
        );
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const grafo = useMemo(() => (capacidades ? Grafo.de(capacidades) : undefined), [capacidades]);

  const extensoesAceitas = useMemo(() => {
    if (!capacidades) return [];
    return [...new Set(capacidades.arestas.filter((a) => a.disponivel).map((a) => a.de))].sort();
  }, [capacidades]);

  /* ==================== o pulso da estimativa ==================== */

  const [agora, setAgora] = useState(() => Date.now());
  const temAtivo = fila.itens.some((i) => ehAtivo(i.estado));

  useEffect(() => {
    // O relógio só corre quando há algo em voo. Um intervalo permanente manteria a página
    // acordada e repintando sem nada para mostrar.
    if (!temAtivo) return;
    const t = setInterval(() => setAgora(Date.now()), PULSO_ESTIMATIVA_MS);
    return () => clearInterval(t);
  }, [temAtivo]);

  /* ==================== entrada de arquivos ==================== */

  const recebe = useCallback(
    (arquivos: File[]) => {
      if (!grafo || !capacidades) return;
      const novos: NovoArquivo[] = [];
      const fora: string[] = [];

      for (const arquivo of arquivos) {
        const origem = formatoDoNome(arquivo.name);
        if (!origem) {
          fora.push(`${arquivo.name} — não reconheci a extensão.`);
          continue;
        }
        if (arquivo.size > capacidades.limites.tamanhoMaximo) {
          fora.push(
            `${arquivo.name} — ${bytes(arquivo.size)}, e o teto é ${bytes(capacidades.limites.tamanhoMaximo)}.`,
          );
          continue;
        }
        const para = grafo.destinoSugerido(origem.ext);
        if (!para) {
          fora.push(`${arquivo.name} — nenhuma conversão disponível para ${origem.nome} agora.`);
          continue;
        }
        const aresta = grafo.aresta(origem.ext, para);
        novos.push({
          arquivo,
          de: origem.ext,
          para,
          engine: aresta?.engine ?? '',
          ...(miniaturaDe(arquivo) ? { miniatura: miniaturaDe(arquivo)! } : {}),
        });
      }

      if (novos.length) despacha({ tipo: 'acrescenta', arquivos: novos });
      setRecusados(fora);
    },
    [grafo, capacidades],
  );

  /* ==================== conversão ==================== */

  const converte = useCallback(
    async (item: ItemFila) => {
      const controlador = new AbortController();
      controladores.current.set(item.id, controlador);
      despacha({ tipo: 'comeca', id: item.id });

      const aoAndar = (r: RelatorioDeAndamento) =>
        despacha({
          tipo: 'anda',
          id: item.id,
          fracao: r.fracao,
          rotulo: r.rotulo,
          ...(r.detalhe ? { detalhe: r.detalhe } : {}),
          ...(r.etapas ? { etapas: r.etapas } : {}),
          ...(r.etapaAtual ? { etapaAtual: r.etapaAtual } : {}),
        });
      const aoAvisar = (texto: string) => despacha({ tipo: 'avisa', id: item.id, texto });

      try {
        const saida =
          item.engine === ID_VETORIZADOR
            ? await vetorizaNoNavegador({
                arquivo: item.arquivo,
                opcoes: item.opcoes,
                aoAndar,
                aoAvisar,
                sinal: controlador.signal,
              })
            : await converteNoServidor({
                arquivo: item.arquivo,
                de: item.de,
                para: item.para,
                opcoes: item.opcoes,
                aoAndar,
                aoAvisar,
                sinal: controlador.signal,
              });
        despacha({ tipo: 'conclui', id: item.id, saida });
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') {
          despacha({ tipo: 'cancela', id: item.id });
        } else if (e instanceof ErroDeConversao) {
          despacha({ tipo: 'falha', id: item.id, erro: e.erro });
        } else {
          despacha({
            tipo: 'falha',
            id: item.id,
            erro: {
              codigo: 'erro-inesperado',
              mensagem: 'Algo deu errado aqui na interface. O detalhe está no console do navegador.',
              detalhe: (e as Error)?.stack ?? String(e),
            },
          });
          console.error('conversão falhou', e);
        }
      } finally {
        controladores.current.delete(item.id);
      }
    },
    [],
  );

  /**
   * Dispara tudo o que está esperando.
   *
   * As de servidor vão todas de uma vez: o servidor tem a própria fila, com o limite calculado
   * a partir dos núcleos da máquina, e segurá-las aqui seria duplicar a decisão em dois lugares
   * que iriam divergir. As vetorizações vão em lotes de dois, pelo motivo em
   * `VETORIZACOES_EM_PARALELO`.
   */
  const converteTudo = useCallback(async () => {
    const pendentes = prontosParaConverter(fila.itens);
    const noServidor = pendentes.filter((i) => i.engine !== ID_VETORIZADOR);
    const noNavegador = pendentes.filter((i) => i.engine === ID_VETORIZADOR);

    const doServidor = noServidor.map((i) => converte(i));

    const doNavegador = (async () => {
      for (let i = 0; i < noNavegador.length; i += VETORIZACOES_EM_PARALELO) {
        const lote = noNavegador.slice(i, i + VETORIZACOES_EM_PARALELO);
        await Promise.all(lote.map((item) => converte(item)));
      }
    })();

    await Promise.all([...doServidor, doNavegador]);
  }, [fila.itens, converte]);

  const cancela = useCallback((item: ItemFila) => {
    controladores.current.get(item.id)?.abort();
    // O servidor também precisa saber, ou ele segue convertendo um arquivo cuja saída ninguém
    // vai buscar — e o `AbortController` só corta o lado do navegador.
    if (item.engine !== ID_VETORIZADOR) void cancelaNoServidor(item.id).catch(() => {});
    despacha({ tipo: 'cancela', id: item.id });
  }, []);

  const remove = useCallback(
    (item: ItemFila) => {
      if (ehAtivo(item.estado)) cancela(item);
      descarta(item);
      despacha({ tipo: 'remove', id: item.id });
    },
    [cancela],
  );

  /* ==================== baixar tudo ==================== */

  const baixaTudo = useCallback(async () => {
    const prontos = concluidos(fila.itens);
    if (prontos.length === 0) return;
    setZipando(true);
    try {
      const nomes = nomesUnicos(prontos.map((i) => i.saida!.nome));
      const arquivos = await Promise.all(
        prontos.map(async (item, indice) => ({
          nome: nomes[indice]!,
          dados: new Uint8Array(await (await fetch(item.saida!.url)).arrayBuffer()),
          data: new Date(),
        })),
      );
      const zip = zipComoBlob(arquivos);
      const url = URL.createObjectURL(zip);
      const a = document.createElement('a');
      a.href = url;
      a.download = `convertidos-${selo()}.zip`;
      a.click();
      // Revogar na hora cortaria o download em alguns navegadores, que só leem o Blob depois de
      // o clique voltar. Um segundo é folga suficiente e não deixa o Blob preso.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setZipando(false);
    }
  }, [fila.itens]);

  /* ==================== limpeza ==================== */

  useEffect(() => {
    // Ao fechar a aba, revoga as URLs de objeto e avisa o servidor do que ficou em voo. Sem isto,
    // uma conversão abandonada segue ocupando núcleo até terminar sozinha.
    const aoSair = () => {
      for (const item of fila.itens) {
        descarta(item);
        if (ehAtivo(item.estado) && item.engine !== ID_VETORIZADOR) void cancelaNoServidor(item.id);
      }
    };
    window.addEventListener('pagehide', aoSair);
    return () => window.removeEventListener('pagehide', aoSair);
  }, [fila.itens]);

  /* ==================== render ==================== */

  const conjunto = progressoDoConjunto(fila.itens);
  const pendentes = prontosParaConverter(fila.itens);
  const prontos = concluidos(fila.itens);
  const itemDoSeletor = fila.itens.find((i) => i.id === seletorDe);
  const itemDasOpcoes = fila.itens.find((i) => i.id === opcoesDe);
  const vazia = fila.itens.length === 0;

  return (
    <>
      <Cabecalho capacidades={capacidades} tema={tema} aoTrocarTema={setTema} />

      <main className="envelope principal">
        {erroDeConexao && (
          <div className="nota nota-ruim nota-grande painel-entra">
            <div>
              <strong>Não consegui falar com o servidor de conversão.</strong>
              <p>{erroDeConexao}</p>
            </div>
          </div>
        )}

        {!capacidades && !erroDeConexao && <Esqueleto />}

        {capacidades && grafo && (
          <>
            <ZonaDeSoltar
              aoReceber={recebe}
              aceita={extensoesAceitas}
              tamanhoMaximo={capacidades.limites.tamanhoMaximo}
              enxuta={!vazia}
            />

            {vazia && <OQueDaHoje capacidades={capacidades} />}

            {recusados.length > 0 && (
              <div className="nota nota-atencao nota-grande painel-entra">
                <div>
                  <strong>
                    {recusados.length === 1
                      ? 'Um arquivo ficou de fora:'
                      : `${recusados.length} arquivos ficaram de fora:`}
                  </strong>
                  <ul className="lista-recusados">
                    {recusados.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
                <button
                  className="botao-icone"
                  onClick={() => setRecusados([])}
                  aria-label="Fechar o aviso"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            )}

            {!vazia && (
              <>
                {conjunto.ativos > 0 && (
                  <section className="conjunto painel-entra" aria-live="polite">
                    <div className="conjunto-texto">
                      <strong>
                        {conjunto.ativos === 1
                          ? 'Convertendo 1 arquivo'
                          : `Convertendo ${conjunto.ativos} arquivos`}
                      </strong>
                      <span>{percentual(conjunto.fracao)} do conjunto</span>
                    </div>
                    <BarraDeProgresso
                      fracao={conjunto.fracao}
                      estado="convertendo"
                      enxuta
                      rotuloAcessivel="Progresso do conjunto"
                    />
                  </section>
                )}

                <ul className="lista">
                  {fila.itens.map((item, indice) => (
                    <CartaoArquivo
                      key={item.id}
                      item={item}
                      agora={agora}
                      indiceNaTela={indice}
                      aoTrocarDestino={() => setSeletorDe(item.id)}
                      aoAbrirOpcoes={() => setOpcoesDe(item.id)}
                      aoRemover={() => remove(item)}
                      aoCancelar={() => cancela(item)}
                      aoTentarDeNovo={() => void converte(item)}
                    />
                  ))}
                </ul>

                <div className="acoes">
                  {/*
                    Com a fila toda convertida o botão SAI DE CENA, em vez de ficar desabilitado
                    dizendo "Converter 0 arquivos" — que era o rótulo que a contagem produzia, e
                    não é um rótulo. A ação principal naquele momento é baixar, e é ela que fica.
                  */}
                  {(pendentes.length > 0 || conjunto.ativos > 0) && (
                    <button
                      className="botao-principal botao-grande"
                      onClick={() => void converteTudo()}
                      disabled={pendentes.length === 0 || conjunto.ativos > 0}
                    >
                      {conjunto.ativos > 0
                        ? 'Convertendo…'
                        : pendentes.length === 1
                          ? 'Converter'
                          : `Converter ${pendentes.length} arquivos`}
                    </button>
                  )}

                  {prontos.length > 1 && (
                    <button
                      className="botao-secundario botao-grande"
                      onClick={() => void baixaTudo()}
                      disabled={zipando}
                    >
                      {zipando ? 'Empacotando…' : `Baixar os ${prontos.length} num .zip`}
                    </button>
                  )}

                  <div className="acoes-fim">
                    {contaPor(fila.itens, 'concluido') > 0 && (
                      <button
                        className="botao-fantasma"
                        onClick={() => {
                          for (const i of fila.itens) if (i.estado === 'concluido') descarta(i);
                          despacha({ tipo: 'limpa-concluidos' });
                        }}
                      >
                        Tirar os prontos da lista
                      </button>
                    )}
                    <button
                      className="botao-fantasma"
                      onClick={() => {
                        for (const i of fila.itens) if (!ehAtivo(i.estado)) descarta(i);
                        despacha({ tipo: 'limpa-tudo' });
                      }}
                    >
                      Limpar
                    </button>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </main>

      <footer className="rodape">
        <div className="envelope">
          <p>
            Roda inteiro na sua máquina. As conversões marcadas <em>no navegador</em> nem chegam ao
            localhost.
          </p>
        </div>
      </footer>

      {itemDoSeletor && grafo && (
        <SeletorDeFormato
          de={itemDoSeletor.de}
          paraAtual={itemDoSeletor.para}
          grafo={grafo}
          aoEscolher={(para, engine) => {
            // Revoga a saída anterior ANTES do despacho: o redutor descarta o campo `saida`, e
            // depois disso a URL de objeto não é mais alcançável para ser revogada — ficaria
            // segurando o Blob na memória da aba até o F5.
            descarta(itemDoSeletor);
            despacha({ tipo: 'escolhe-destino', id: itemDoSeletor.id, para, engine });
          }}
          aoFechar={() => setSeletorDe(undefined)}
        />
      )}

      {itemDasOpcoes && (
        <PainelDeOpcoes
          de={itemDasOpcoes.de}
          para={itemDasOpcoes.para}
          engine={itemDasOpcoes.engine}
          opcoes={itemDasOpcoes.opcoes}
          aoAplicar={(opcoes: Opcoes) => {
            descarta(itemDasOpcoes);
            despacha({ tipo: 'ajusta-opcoes', id: itemDasOpcoes.id, opcoes });
          }}
          aoFechar={() => setOpcoesDe(undefined)}
        />
      )}
    </>
  );
}

/**
 * Derruba as arestas do vetorizador cujo formato de entrada este navegador não decodifica.
 *
 * Só as do vetorizador: as arestas do servidor não dependem do navegador, e o mesmo formato pode
 * chegar por duas engines diferentes.
 */
function semAsEntradasRecusadas(c: Capacidades, recusadas: readonly string[]): Capacidades {
  const arestas: Aresta[] = c.arestas.map((a) =>
    a.engine === ID_VETORIZADOR && recusadas.includes(a.de)
      ? {
          ...a,
          disponivel: false,
          ausencia: {
            tipo: 'sem-suporte',
            detalhe: `Este navegador não decodifica ${a.de.toUpperCase()}, e o vetorizador precisa dos pixels.`,
          },
        }
      : a,
  );
  return { ...c, arestas };
}

/**
 * A miniatura da entrada.
 *
 * Só para o que o navegador exibe em `<img>`. TIFF e HEIC ficam sem, e é por isso que o
 * `Miniatura` do cartão também trata o `onError`: a lista de formatos que um navegador exibe
 * muda por versão, e a checagem por tipo MIME é um palpite bom, não uma garantia.
 */
const EXIBIVEIS = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/avif', 'image/svg+xml']);

function miniaturaDe(arquivo: File): string | undefined {
  return EXIBIVEIS.has(arquivo.type) ? URL.createObjectURL(arquivo) : undefined;
}

function selo(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/**
 * O esqueleto da primeira carga.
 *
 * Ele aparece por poucos milissegundos — o servidor é local. Existe porque o alternativo é a
 * tela em branco, e uma tela em branco por 200 ms num F5 lê como "quebrou" mesmo quando não
 * quebrou.
 */
function Esqueleto() {
  return (
    <div className="esqueleto" aria-busy="true" aria-label="Carregando">
      <div className="esqueleto-zona" />
      <div className="esqueleto-linha" />
      <div className="esqueleto-linha esqueleto-curta" />
    </div>
  );
}
