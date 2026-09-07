import { useEffect, useMemo, useRef, useState } from 'react';
import { ROTULO_FAMILIA, formatoDe, type DestinoUI, type Familia, type Grafo, type MotivoAusencia } from '@conversor/nucleo';

interface Props {
  de: string;
  paraAtual: string;
  grafo: Grafo;
  aoEscolher: (para: string, engine: string) => void;
  aoFechar: () => void;
}

/**
 * O seletor de formato de destino.
 *
 * A forma vem do Convertio — abas por família, grade de formatos — porque essa forma está certa:
 * são dez famílias e mais de cem formatos, e sem o agrupamento a lista é impossível de varrer.
 * Três coisas aqui são diferentes, e cada uma resolve algo que lá incomoda.
 *
 * **1. O destino indisponível aparece, desabilitado, com o motivo.** No Convertio o que não dá
 * simplesmente não está na lista, e quem procura MP3 numa imagem fica procurando. Aqui o botão
 * está lá, em cinza, dizendo "chega no marco 3" ou "precisa do LibreOffice". A informação de que
 * uma conversão NÃO existe é informação, e sonegá-la faz a pessoa duvidar da própria memória.
 *
 * **2. Cada formato traz uma linha do que ele é.** "AVIF" não diz nada a quem não acompanha
 * formato de imagem; "comprime melhor que WebP, codifica mais devagar" diz. É a diferença entre
 * escolher e adivinhar.
 *
 * **3. Tem busca.** Com mais de cem formatos, quem já sabe o que quer digita três letras em vez
 * de caçar a aba certa. O campo recebe o foco na abertura justamente por isso.
 */
export function SeletorDeFormato({ de, paraAtual, grafo, aoEscolher, aoFechar }: Props) {
  const grupos = useMemo(() => grafo.destinosPorFamilia(de), [grafo, de]);
  const origem = formatoDe(de);

  const [familiaAtiva, setFamiliaAtiva] = useState<Familia | undefined>(
    () => grupos.find((g) => g.destinos.some((d) => d.formato.ext === paraAtual))?.familia ?? grupos[0]?.familia,
  );
  const [busca, setBusca] = useState('');
  const campoBusca = useRef<HTMLInputElement>(null);
  const painel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    campoBusca.current?.focus();
  }, []);

  // Esc fecha, e o foco fica preso no painel enquanto ele está aberto — um diálogo de onde o
  // Tab escapa para a página atrás é uma armadilha para quem navega por teclado.
  useEffect(() => {
    const noTeclado = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        aoFechar();
        return;
      }
      if (e.key !== 'Tab' || !painel.current) return;
      const focaveis = painel.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input, [tabindex]:not([tabindex="-1"])',
      );
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (!primeiro || !ultimo) return;
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    };
    document.addEventListener('keydown', noTeclado, true);
    return () => document.removeEventListener('keydown', noTeclado, true);
  }, [aoFechar]);

  const termo = busca.trim().toLowerCase();
  const buscando = termo.length > 0;

  const visiveis: readonly DestinoUI[] = useMemo(() => {
    if (buscando) {
      return grupos
        .flatMap((g) => g.destinos)
        .filter(
          (d) =>
            d.formato.ext.includes(termo) ||
            d.formato.nome.toLowerCase().includes(termo) ||
            d.formato.descricao.toLowerCase().includes(termo),
        );
    }
    return grupos.find((g) => g.familia === familiaAtiva)?.destinos ?? [];
  }, [grupos, familiaAtiva, buscando, termo]);

  const disponiveisNaFamilia = (f: Familia) =>
    grupos.find((g) => g.familia === f)?.destinos.filter((d) => d.disponivel).length ?? 0;

  return (
    <>
      <div className="cortina" onClick={aoFechar} aria-hidden="true" />
      <div
        className="painel painel-entra painel-seletor"
        role="dialog"
        aria-modal="true"
        aria-label={`Escolher o formato de saída para ${origem?.nome ?? de}`}
        ref={painel}
      >
        <header className="painel-topo">
          <div>
            <h2 className="painel-titulo">Converter para</h2>
            <p className="painel-sub">
              De <strong>{origem?.nome ?? de.toUpperCase()}</strong> para qual formato?
            </p>
          </div>
          <button className="botao-icone" onClick={aoFechar} aria-label="Fechar">
            <IconeX />
          </button>
        </header>

        <div className="seletor-busca">
          <IconeLupa />
          <input
            ref={campoBusca}
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar formato — webp, avif, pdf…"
            aria-label="Buscar formato"
          />
        </div>

        {!buscando && (
          <div className="seletor-abas" role="tablist" aria-label="Famílias de formato">
            {grupos.map((g) => {
              const n = disponiveisNaFamilia(g.familia);
              return (
                <button
                  key={g.familia}
                  role="tab"
                  aria-selected={g.familia === familiaAtiva}
                  className="seletor-aba"
                  data-ativa={g.familia === familiaAtiva ? 'sim' : 'nao'}
                  data-vazia={n === 0 ? 'sim' : 'nao'}
                  onClick={() => setFamiliaAtiva(g.familia)}
                >
                  {ROTULO_FAMILIA[g.familia]}
                  {/* A contagem só aparece quando há algo disponível: um "0" ao lado do nome
                      leria como erro, quando a informação certa é "nada aqui ainda". */}
                  {n > 0 && <span className="seletor-conta">{n}</span>}
                </button>
              );
            })}
          </div>
        )}

        <div className="seletor-grade" role="tabpanel">
          {visiveis.length === 0 && (
            <p className="seletor-nada">
              {buscando ? `Nenhum formato combina com "${busca}".` : 'Nada nesta família ainda.'}
            </p>
          )}
          {visiveis.map((d) => (
            <button
              key={d.formato.ext}
              className="destino"
              data-escolhido={d.formato.ext === paraAtual ? 'sim' : 'nao'}
              disabled={!d.disponivel}
              onClick={() => {
                aoEscolher(d.formato.ext, d.engine);
                aoFechar();
              }}
              title={d.disponivel ? d.formato.descricao : textoDaAusencia(d.ausencia)}
            >
              <span className="destino-topo">
                <span className="destino-ext">{d.formato.nome}</span>
                {d.formato.ext === paraAtual && <IconeVisto />}
                {!d.disponivel && <span className="destino-selo">{seloDaAusencia(d.ausencia)}</span>}
              </span>
              <span className="destino-desc">
                {d.disponivel ? d.formato.descricao : textoDaAusencia(d.ausencia)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function seloDaAusencia(a: MotivoAusencia | undefined): string {
  switch (a?.tipo) {
    case 'nao-implementada':
      return a.marco;
    case 'nao-instalada':
      return 'falta instalar';
    case 'versao-antiga':
      return 'versão antiga';
    default:
      return 'indisponível';
  }
}

function textoDaAusencia(a: MotivoAusencia | undefined): string {
  switch (a?.tipo) {
    case 'nao-implementada':
      return `Ainda não: chega no ${a.marco}.`;
    case 'nao-instalada':
      return a.comoInstalar;
    case 'versao-antiga':
      return `Encontrei a versão ${a.encontrada}, e é preciso ${a.minima} ou mais nova.`;
    case 'sem-suporte':
      return a.detalhe;
    default:
      return 'Esta conversão não está disponível nesta máquina.';
  }
}

/* Ícones em SVG inline: sem biblioteca, sem requisição, e herdam a cor do texto. */

const IconeX = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

const IconeLupa = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="6.8" cy="6.8" r="4.6" stroke="currentColor" strokeWidth="1.5" />
    <path d="M10.4 10.4L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const IconeVisto = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M3 8.5l3.2 3.2L13 5"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
