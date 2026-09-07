import { percentual, percentualInteiro, restante, estimaRestante } from '@conversor/nucleo';
import type { EstadoItem } from '../estado/fila.js';

interface Props {
  /** 0..1. Sempre o valor real; ver o cabeçalho de `movimento.css`. */
  fracao: number;
  estado: EstadoItem;
  /** Quando dado, mostra a estimativa de tempo restante. */
  iniciadoEm?: number;
  agora?: number;
  rotulo?: string;
  detalhe?: string | undefined;
  /** Compacta: só a barra, sem a linha de texto. Para a barra do conjunto. */
  enxuta?: boolean;
  rotuloAcessivel?: string;
}

/**
 * A barra de progresso.
 *
 * O valor que entra aqui é real e monotônico — garantido pelo `Progresso` do núcleo antes de
 * chegar. Este componente não interpola, não estima e não anda sozinho: ele escreve a fração num
 * custom property e deixa o CSS deslizar até lá. Toda a suavização é a transição de 760 ms
 * declarada em `movimento.css`, e ela atrasa a barra em relação à verdade, nunca a adianta.
 *
 * `role="progressbar"` com os três `aria-value*` porque a barra também tem de existir para quem
 * não a vê. O `aria-valuetext` leva o rótulo da etapa junto: "43%" sozinho informa muito menos
 * que "43%, codificando AVIF".
 */
export function BarraDeProgresso({
  fracao,
  estado,
  iniciadoEm,
  agora,
  rotulo,
  detalhe,
  enxuta,
  rotuloAcessivel,
}: Props) {
  const ativa = estado === 'enviando' || estado === 'na-fila' || estado === 'convertendo';
  const pct = percentual(fracao);

  const falta =
    ativa && iniciadoEm && agora ? restante(estimaRestante(fracao, agora - iniciadoEm)) : undefined;

  return (
    <div className={enxuta ? 'progresso progresso-enxuta' : 'progresso'}>
      {!enxuta && (
        <div className="progresso-linha">
          <span className="rotulo-etapa">
            {/* A `key` é o que faz o crossfade: React troca o nó, e a animação de entrada roda
                de novo. Sem ela, o texto mudaria de conteúdo sem transição nenhuma. */}
            <span key={rotulo}>{rotulo}</span>
          </span>
          <span className="progresso-direita">
            {detalhe && <span className="progresso-detalhe">{detalhe}</span>}
            {falta && <span className="progresso-falta">{falta}</span>}
            {/* Sem porcentagem quando parou no meio: "Falhou · 3%" nao informa nada, e o numero
                em negrito puxa o olho para o dado menos util da linha. A barra continua
                mostrando ONDE parou, que e a parte que serve. */}
            {estado !== 'falhou' && estado !== 'cancelado' && (
              <strong key={pct} className="progresso-pct sobe-numero">
                {pct}
              </strong>
            )}
          </span>
        </div>
      )}

      {/*
        `aria-valuenow` sai de `percentualInteiro`, e não de `Math.round(fracao * 100)`.
        Arredondar levava 0,999 a 100 — e 0,999 é exatamente o que o `Progresso` devolve quando
        as etapas acabaram e o arquivo ainda não está pronto. O texto na tela dizia 99% e o leitor
        de tela anunciava 100%, sem botão de baixar. Ver o comentário de `percentualInteiro`.
      */}
      <div
        className="barra"
        data-ativa={ativa ? 'sim' : 'nao'}
        data-estado={estado}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percentualInteiro(fracao)}
        aria-valuetext={`${pct}${rotulo ? `, ${rotulo}` : ''}`}
        aria-label={rotuloAcessivel}
      >
        <div className="barra-trilho" />
        <div className="barra-preenchimento" style={{ '--fracao': fracao } as React.CSSProperties} />
        <div className="barra-brilho" />
      </div>
    </div>
  );
}
