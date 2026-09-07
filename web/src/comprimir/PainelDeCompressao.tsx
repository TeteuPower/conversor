import type { CSSProperties } from 'react';
import { bytes, diferencaTamanho } from '@conversor/nucleo';
import {
  NOME_FORMATO,
  SOBRE_FORMATO,
  temQualidade,
  type Ajuste,
  type FormatoSaida,
} from './codec.js';

interface Props {
  ajuste: Ajuste;
  aoAjustar: (a: Ajuste) => void;
  /** Formatos que este navegador confirmou codificar, pela sonda do worker. */
  suportados: readonly FormatoSaida[];
  larguraOriginal: number;
  alturaOriginal: number;
  tamanhoOriginal: number;
  /** Tamanho do resultado corrente. `undefined` até a primeira codificação sair. */
  tamanhoComprimido: number | undefined;
  ocupado: boolean;
  aoBaixar: () => void;
  aoTrocarImagem: () => void;
}

/** Os degraus de redimensionamento, como fração da largura original. */
const DEGRAUS = [1, 0.75, 0.5, 0.25] as const;

export function PainelDeCompressao({
  ajuste,
  aoAjustar,
  suportados,
  larguraOriginal,
  alturaOriginal,
  tamanhoOriginal,
  tamanhoComprimido,
  ocupado,
  aoBaixar,
  aoTrocarImagem,
}: Props) {
  const larguraAtual = ajuste.largura ?? larguraOriginal;
  const alturaAtual = Math.max(1, Math.round((larguraAtual * alturaOriginal) / larguraOriginal));

  return (
    <aside className="cpr-painel">
      <section className="cpr-secao">
        <h2 className="cpr-titulo">Formato</h2>
        <div className="cpr-formatos" role="radiogroup" aria-label="Formato de saída">
          {(Object.keys(NOME_FORMATO) as FormatoSaida[]).map((f) => {
            const disponivel = suportados.length === 0 || suportados.includes(f);
            return (
              <button
                key={f}
                role="radio"
                aria-checked={ajuste.formato === f}
                className="cpr-formato"
                data-escolhido={ajuste.formato === f ? 'sim' : 'nao'}
                disabled={!disponivel}
                title={disponivel ? SOBRE_FORMATO[f] : `Este navegador não codifica ${NOME_FORMATO[f]}.`}
                onClick={() => aoAjustar({ ...ajuste, formato: f })}
              >
                {NOME_FORMATO[f]}
              </button>
            );
          })}
        </div>
        <p className="cpr-sobre">{SOBRE_FORMATO[ajuste.formato]}</p>
      </section>

      {temQualidade(ajuste.formato) ? (
        <section className="cpr-secao">
          <div className="cpr-linha-titulo">
            <h2 className="cpr-titulo">Qualidade</h2>
            <output className="cpr-valor">{ajuste.qualidade}</output>
          </div>
          <input
            className="cpr-deslizante"
            type="range"
            min={1}
            max={100}
            value={ajuste.qualidade}
            aria-label="Qualidade"
            style={{ '--preenchido': `${ajuste.qualidade}%` } as CSSProperties}
            onChange={(e) => aoAjustar({ ...ajuste, qualidade: Number(e.target.value) })}
          />
          <p className="cpr-sobre">
            Abaixo de 60 o artefato começa a aparecer em degradê e em contorno fino. Arraste
            olhando a comparação: o número certo é o menor em que você não vê diferença.
          </p>
        </section>
      ) : (
        <section className="cpr-secao">
          <h2 className="cpr-titulo">Qualidade</h2>
          {/*
            O controle não fica desabilitado, fica AUSENTE. Um controle em cinza sugere que
            existe um jeito de habilitá-lo; aqui não existe — PNG não tem perda, e não há o que
            ajustar. A frase explica em vez de deixar o usuário procurando.
          */}
          <p className="cpr-sobre">
            PNG não tem perda: não há qualidade para ajustar. Ele só encolhe se a imagem tiver
            poucas cores — captura de tela e desenho encolhem, fotografia não.
          </p>
        </section>
      )}

      <section className="cpr-secao">
        <div className="cpr-linha-titulo">
          <h2 className="cpr-titulo">Tamanho</h2>
          <output className="cpr-valor cpr-valor-fraco">
            {larguraAtual} × {alturaAtual}
          </output>
        </div>
        <div className="cpr-degraus" role="radiogroup" aria-label="Redimensionar">
          {DEGRAUS.map((d) => {
            const largura = Math.max(1, Math.round(larguraOriginal * d));
            const escolhido = larguraAtual === largura;
            return (
              <button
                key={d}
                role="radio"
                aria-checked={escolhido}
                className="cpr-degrau"
                data-escolhido={escolhido ? 'sim' : 'nao'}
                onClick={() =>
                  aoAjustar(
                    d === 1
                      ? { formato: ajuste.formato, qualidade: ajuste.qualidade }
                      : { ...ajuste, largura },
                  )
                }
              >
                {d === 1 ? 'Original' : `${d * 100}%`}
              </button>
            );
          })}
        </div>
      </section>

      <section className="cpr-secao cpr-resultado">
        <div className="cpr-balanca">
          <div className="cpr-balanca-lado">
            <span className="cpr-balanca-rotulo">Original</span>
            <strong className="cpr-balanca-valor">{bytes(tamanhoOriginal)}</strong>
          </div>
          <svg className="cpr-seta" width="20" height="14" viewBox="0 0 20 14" fill="none" aria-hidden="true">
            <path d="M1 7h17m0 0l-5-5m5 5l-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="cpr-balanca-lado">
            <span className="cpr-balanca-rotulo">{NOME_FORMATO[ajuste.formato]}</span>
            <strong className="cpr-balanca-valor cpr-balanca-saida" data-medindo={tamanhoComprimido === undefined ? 'sim' : 'nao'}>
              {tamanhoComprimido === undefined ? 'medindo…' : bytes(tamanhoComprimido)}
            </strong>
          </div>
        </div>

        {/*
          O veredito é o número que decide a escolha, e ele não é aproximado: sai do Blob de
          verdade, do mesmo arquivo que o botão vai baixar. Não há preview em resolução menor
          servindo de estimativa — a comparação e a conta olham para o mesmo objeto.
        */}
        {tamanhoComprimido !== undefined && (
          <p className="cpr-veredito" data-piorou={tamanhoComprimido > tamanhoOriginal ? 'sim' : 'nao'}>
            {tamanhoComprimido > tamanhoOriginal
              ? `Ficou ${diferencaTamanho(tamanhoOriginal, tamanhoComprimido)}. Neste caso o original já estava melhor.`
              : diferencaTamanho(tamanhoOriginal, tamanhoComprimido)}
          </p>
        )}

        <button
          className="botao-principal botao-grande cpr-baixar"
          onClick={aoBaixar}
          disabled={tamanhoComprimido === undefined}
        >
          {ocupado && tamanhoComprimido === undefined ? 'Comprimindo…' : 'Baixar'}
        </button>
        <button className="botao-fantasma cpr-trocar" onClick={aoTrocarImagem}>
          Usar outra imagem
        </button>
      </section>
    </aside>
  );
}
