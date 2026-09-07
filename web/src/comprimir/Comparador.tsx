import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  /** A imagem de entrada, sem tocar. Fica à esquerda. */
  urlOriginal: string;
  /** O resultado da compressão. Fica à direita. `undefined` enquanto a primeira não sai. */
  urlComprimida: string | undefined;
  largura: number;
  altura: number;
  rotuloEsquerda: string;
  rotuloDireita: string;
  /** Acende o indicador de que uma codificação está em andamento. */
  ocupado: boolean;
}

/** Posição inicial do divisor, em porcentagem da largura. */
const INICIO = 50;

/**
 * A comparação lado a lado.
 *
 * ====================================================================================
 * POR QUE UM DIVISOR, E NÃO DUAS IMAGENS UMA AO LADO DA OUTRA
 * ====================================================================================
 *
 * Duas imagens lado a lado obrigam o olho a saltar entre elas, e cada salto custa a memória
 * exata do que se acabou de ver. Artefato de compressão é justamente o tipo de diferença que não
 * sobrevive a esse salto: um degradê que virou faixas, um contorno que ganhou serrilhado. Com o
 * divisor, o MESMO pedaço da imagem troca de versão no mesmo lugar da tela, e a diferença
 * aparece como movimento — que é o que o olho detecta bem.
 *
 * ====================================================================================
 * O QUE AQUI NÃO TEM TRANSIÇÃO, DE PROPÓSITO
 * ====================================================================================
 *
 * O resto da aplicação se move devagar, e isso é uma escolha. O divisor é a exceção: ele
 * acompanha o ponteiro em 1:1, sem transição nenhuma. Uma transição de 300 ms aqui faria a linha
 * chegar depois do dedo, e a sensação não seria de calma — seria de travamento.
 *
 * A calma deste componente está em outro lugar: na TROCA da imagem comprimida. Quando uma
 * codificação nova fica pronta, ela não substitui a anterior de imediato — ela é decodificada
 * primeiro, fora de tela, e só então aparece, em transição. Sem isso, cada passo do controle de
 * qualidade daria um piscar branco no meio da comparação.
 */
export function Comparador({
  urlOriginal,
  urlComprimida,
  largura,
  altura,
  rotuloEsquerda,
  rotuloDireita,
  ocupado,
}: Props) {
  const [divisor, setDivisor] = useState(INICIO);
  const [ampliado, setAmpliado] = useState(false);
  const [deslocamento, setDeslocamento] = useState({ x: 0, y: 0 });
  const palco = useRef<HTMLDivElement>(null);

  /**
   * A URL de fato exibida, que ATRASA em relação à recebida.
   *
   * Ela só troca depois de `decode()` resolver, ou seja, depois de o navegador já ter os pixels
   * prontos. Trocar o `src` direto faz o `<img>` esvaziar enquanto decodifica, e num arrasto do
   * controle de qualidade isso vira um estroboscópio no meio da comparação.
   */
  const [exibida, setExibida] = useState<string>();

  useEffect(() => {
    if (!urlComprimida) return;
    let vivo = true;
    const img = new Image();
    img.src = urlComprimida;
    img
      .decode()
      .then(() => {
        if (vivo) setExibida(urlComprimida);
      })
      .catch(() => {
        // `decode()` rejeita se a URL foi revogada no meio do caminho — o que acontece quando um
        // resultado mais novo chega antes deste terminar. Não é erro: é a corrida certa vencendo.
      });
    return () => {
      vivo = false;
    };
  }, [urlComprimida]);

  /* ==================== o arrasto ==================== */

  const moveDivisor = useCallback((clienteX: number) => {
    const caixa = palco.current?.getBoundingClientRect();
    if (!caixa) return;
    const fracao = (clienteX - caixa.left) / caixa.width;
    setDivisor(Math.min(100, Math.max(0, fracao * 100)));
  }, []);

  const arrastando = useRef<'divisor' | 'panorama' | undefined>(undefined);
  const ultimoPonto = useRef({ x: 0, y: 0 });

  const aoApertar = useCallback(
    (e: React.PointerEvent) => {
      // A regra: no encaixe, arrastar em qualquer lugar move o divisor — não há o que deslocar,
      // e a linha responder ao clique em qualquer ponto é o que dá agilidade à comparação.
      // Ampliado, arrastar desloca a imagem, e o divisor só se move pela alça.
      const naAlca = (e.target as HTMLElement).closest('.cmp-alca') !== null;
      arrastando.current = naAlca || !ampliado ? 'divisor' : 'panorama';
      ultimoPonto.current = { x: e.clientX, y: e.clientY };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      if (arrastando.current === 'divisor') moveDivisor(e.clientX);
    },
    [ampliado, moveDivisor],
  );

  const aoMover = useCallback(
    (e: React.PointerEvent) => {
      if (!arrastando.current) return;
      if (arrastando.current === 'divisor') {
        moveDivisor(e.clientX);
      } else {
        const dx = e.clientX - ultimoPonto.current.x;
        const dy = e.clientY - ultimoPonto.current.y;
        ultimoPonto.current = { x: e.clientX, y: e.clientY };
        setDeslocamento((d) => ({ x: d.x + dx, y: d.y + dy }));
      }
    },
    [moveDivisor],
  );

  const aoSoltar = useCallback((e: React.PointerEvent) => {
    arrastando.current = undefined;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  /**
   * O teclado move o divisor.
   *
   * Isto não é enfeite de acessibilidade: comparar em incrementos exatos é útil para quem
   * enxerga também, e a seta dá um controle que o ponteiro não dá. Shift move de 10 em 10 para
   * atravessar a imagem rápido.
   */
  const aoTeclar = useCallback((e: React.KeyboardEvent) => {
    const passo = e.shiftKey ? 10 : 2;
    if (e.key === 'ArrowLeft') setDivisor((d) => Math.max(0, d - passo));
    else if (e.key === 'ArrowRight') setDivisor((d) => Math.min(100, d + passo));
    else if (e.key === 'Home') setDivisor(0);
    else if (e.key === 'End') setDivisor(100);
    else return;
    e.preventDefault();
  }, []);

  const alternaAmpliacao = useCallback(() => {
    setAmpliado((a) => {
      if (a) setDeslocamento({ x: 0, y: 0 });
      return !a;
    });
  }, []);

  const estiloImagem = ampliado
    ? {
        width: `${largura}px`,
        height: `${altura}px`,
        transform: `translate(${deslocamento.x}px, ${deslocamento.y}px)`,
      }
    : undefined;

  return (
    <div className="cmp">
      <div
        ref={palco}
        className="cmp-palco"
        data-ampliado={ampliado ? 'sim' : 'nao'}
        data-arrastavel={ampliado ? 'panorama' : 'divisor'}
        onPointerDown={aoApertar}
        onPointerMove={aoMover}
        onPointerUp={aoSoltar}
        onPointerCancel={aoSoltar}
        style={{ '--divisor': `${divisor}%` } as React.CSSProperties}
      >
        <div className="cmp-camadas" style={estiloImagem}>
          <img className="cmp-img" src={urlOriginal} alt="" draggable={false} />
          {exibida && (
            <img
              key={exibida}
              className="cmp-img cmp-img-depois cmp-troca"
              src={exibida}
              alt=""
              draggable={false}
            />
          )}
        </div>

        {/*
          A alça é `separator` com valor, e não um `slider`: ela não escolhe um número que
          significa alguma coisa fora da tela — ela move uma divisa visual. O leitor de tela
          anuncia a posição, que é a informação que importa.
        */}
        <div
          className="cmp-alca"
          role="separator"
          aria-orientation="vertical"
          aria-label="Divisor da comparação"
          aria-valuenow={Math.round(divisor)}
          aria-valuemin={0}
          aria-valuemax={100}
          tabIndex={0}
          onKeyDown={aoTeclar}
        >
          <span className="cmp-alca-linha" aria-hidden="true" />
          <span className="cmp-alca-punho" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M7 5L4 9l3 4M11 5l3 4-3 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>

        <span className="cmp-rotulo cmp-rotulo-esq">{rotuloEsquerda}</span>
        <span className="cmp-rotulo cmp-rotulo-dir">{rotuloDireita}</span>

        {/*
          O indicador de trabalho não tem porcentagem, e isso é deliberado.

          Uma codificação é UM passo opaco: o navegador entra no codificador e volta com o
          resultado, sem relatar nada no meio. O resto desta aplicação mostra fração real porque
          as engines declaram etapas de verdade; aqui não há etapa nenhuma para declarar, e uma
          barra com número seria inventada. O que ela pode dizer com honestidade é "estou
          trabalhando" — e é só isso que ela diz.
        */}
        <div className="cmp-trabalhando" data-ativo={ocupado ? 'sim' : 'nao'} aria-hidden="true">
          <span className="cmp-trabalhando-fita" />
        </div>
      </div>

      <div className="cmp-ferramentas">
        <button
          className="botao-fantasma botao-mini"
          onClick={alternaAmpliacao}
          aria-pressed={ampliado}
        >
          {ampliado ? 'Encaixar na tela' : 'Ver em 100%'}
        </button>
        {ampliado && <span className="cmp-dica">Arraste a imagem para percorrer.</span>}
        <button className="botao-fantasma botao-mini cmp-centralizar" onClick={() => setDivisor(INICIO)}>
          Centralizar divisor
        </button>
      </div>
    </div>
  );
}
