import { useCallback, useEffect, useRef, useState } from 'react';
import { bytes, trocaExtensao } from '@conversor/nucleo';
import Worker from './codec.worker.ts?worker';
import {
  Compressor,
  NOME_FORMATO,
  QUALIDADE_INICIAL,
  type Ajuste,
  type Dimensao,
  type FormatoSaida,
  type Resultado,
} from './codec.js';
import { Cabecalho, usaTema } from '../componentes/Cabecalho.js';
import { Comparador } from './Comparador.js';
import { PainelDeCompressao } from './PainelDeCompressao.js';

/**
 * A ferramenta de compressão.
 *
 * ====================================================================================
 * POR QUE ELA É SEPARADA DO CONVERSOR
 * ====================================================================================
 *
 * O conversor e esta ferramenta parecem a mesma coisa — as duas transformam imagem — e são
 * duas tarefas diferentes, com dois ritmos diferentes.
 *
 * No conversor, o usuário SABE o que quer: solta trinta arquivos, escolhe o destino, aperta e
 * vai fazer outra coisa. O trabalho é em lote, a interface é uma fila, e o que ela precisa
 * provar é que está progredindo.
 *
 * Aqui ele NÃO sabe o que quer, e está descobrindo. Ele mexe na qualidade, olha, volta, compara,
 * decide. É um arquivo só, o ciclo é de segundos, e o que a interface precisa provar é que o
 * número na tela corresponde ao arquivo que vai sair. Uma fila atrapalharia; um lote não faria
 * sentido.
 *
 * ====================================================================================
 * NADA SAI DA MÁQUINA — NEM PARA O LOCALHOST
 * ====================================================================================
 *
 * Toda a compressão acontece na página, pelo codificador do próprio navegador. O servidor não é
 * consultado uma vez sequer. Isso não é só uma promessa de privacidade: é o que torna o preview
 * ao vivo possível, porque não há ida e volta pela rede entre mexer no controle e ver o
 * resultado.
 */
export function Comprimir() {
  const [tema, setTema] = usaTema();
  const [arquivo, setArquivo] = useState<File>();
  const [urlOriginal, setUrlOriginal] = useState<string>();
  const [dimensao, setDimensao] = useState<Dimensao>();
  const [ajuste, setAjuste] = useState<Ajuste>({ formato: 'webp', qualidade: QUALIDADE_INICIAL.webp });
  const [resultado, setResultado] = useState<Resultado>();
  const [suportados, setSuportados] = useState<FormatoSaida[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string>();
  const [arrastando, setArrastando] = useState(false);

  const compressor = useRef<Compressor>();

  /* ==================== o compressor ==================== */

  useEffect(() => {
    const c = new Compressor(new Worker(), {
      aoResultado: (r) => {
        setResultado(r);
        setErro(undefined);
      },
      aoErro: setErro,
      aoOcupado: setOcupado,
    });
    compressor.current = c;
    c.sonda();
    // A sonda responde de forma assíncrona e o `Compressor` guarda o resultado num campo. Ler o
    // campo num intervalo curto é feio; escutar direto é o certo, mas exigiria um segundo canal
    // de eventos só para isto. O compromisso: uma leitura no próximo quadro, quando a sonda de
    // três formatos minúsculos (8 × 8 px) já respondeu com folga.
    const t = setTimeout(() => setSuportados([...c.suportados]), 120);
    return () => {
      clearTimeout(t);
      c.encerra();
      compressor.current = undefined;
    };
  }, []);

  /* ==================== entrada da imagem ==================== */

  const recebe = useCallback(async (f: File) => {
    if (!f.type.startsWith('image/')) {
      setErro(`${f.name} não parece uma imagem.`);
      return;
    }
    setErro(undefined);
    setResultado(undefined);
    setArquivo(f);
    setUrlOriginal((anterior) => {
      if (anterior) URL.revokeObjectURL(anterior);
      return URL.createObjectURL(f);
    });
    const d = await compressor.current?.carrega(f);
    if (d) setDimensao(d);
  }, []);

  /* Colar do clipboard: o Squoosh aceita, e é o caminho mais curto para uma captura de tela. */
  useEffect(() => {
    const aoColar = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.files ?? [])][0];
      if (item) void recebe(item);
    };
    window.addEventListener('paste', aoColar);
    return () => window.removeEventListener('paste', aoColar);
  }, [recebe]);

  /* Toda mudança de ajuste pede uma codificação. A política de fila cuida do resto. */
  useEffect(() => {
    if (!dimensao) return;
    compressor.current?.pede(ajuste);
  }, [ajuste, dimensao]);

  /* A troca de formato leva junto a qualidade inicial daquele formato. */
  const ajustaCom = useCallback((novo: Ajuste) => {
    setAjuste((anterior) =>
      novo.formato !== anterior.formato
        ? { ...novo, qualidade: QUALIDADE_INICIAL[novo.formato] }
        : novo,
    );
  }, []);

  useEffect(() => {
    return () => {
      if (urlOriginal) URL.revokeObjectURL(urlOriginal);
    };
  }, [urlOriginal]);

  const baixa = useCallback(() => {
    if (!resultado || !arquivo) return;
    const a = document.createElement('a');
    a.href = resultado.url;
    a.download = trocaExtensao(arquivo.name, resultado.ajuste.formato === 'jpeg' ? 'jpg' : resultado.ajuste.formato);
    a.click();
  }, [resultado, arquivo]);

  const trocaImagem = useCallback(() => {
    setArquivo(undefined);
    setDimensao(undefined);
    setResultado(undefined);
    setErro(undefined);
    setUrlOriginal((anterior) => {
      if (anterior) URL.revokeObjectURL(anterior);
      return undefined;
    });
  }, []);

  /* ==================== render ==================== */

  const cabecalho = (
    <Cabecalho
      capacidades={undefined}
      tema={tema}
      aoTrocarTema={setTema}
      subtitulo="compressão nesta página, sem servidor"
    />
  );

  if (!arquivo || !urlOriginal || !dimensao) {
    return (
      <>
        {cabecalho}
        <main className="envelope cpr-vazio">
        <div
          className={`cpr-solta${arrastando ? ' respira' : ''}`}
          data-arrastando={arrastando ? 'sim' : 'nao'}
          onDragOver={(e) => {
            e.preventDefault();
            setArrastando(true);
          }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => {
            e.preventDefault();
            setArrastando(false);
            const f = e.dataTransfer.files[0];
            if (f) void recebe(f);
          }}
        >
          <svg width="46" height="46" viewBox="0 0 46 46" fill="none" aria-hidden="true" className="cpr-solta-icone">
            <rect x="5" y="9" width="36" height="28" rx="4" stroke="currentColor" strokeWidth="1.8" opacity="0.35" />
            <circle cx="16" cy="19" r="3.2" stroke="currentColor" strokeWidth="1.8" />
            <path d="M7 31l9.5-9 7 6.5L30 22l9 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h2 className="cpr-solta-titulo">Solte uma imagem aqui</h2>
          <p className="cpr-solta-sub">
            Ou cole com <kbd>Ctrl</kbd>+<kbd>V</kbd>. Ela não sai desta máquina — a compressão
            acontece nesta página, e o servidor não é consultado.
          </p>
          <label className="botao-principal botao-grande cpr-escolher">
            Escolher imagem
            <input
              type="file"
              accept="image/*"
              className="cpr-arquivo-oculto"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void recebe(f);
              }}
            />
          </label>
          {erro && <p className="cpr-erro">{erro}</p>}
        </div>
        </main>
      </>
    );
  }

  return (
    <>
      {cabecalho}
      <main className="cpr">
      <div className="cpr-grade">
        <Comparador
          urlOriginal={urlOriginal}
          urlComprimida={resultado?.url}
          largura={resultado?.largura ?? dimensao.largura}
          altura={resultado?.altura ?? dimensao.altura}
          rotuloEsquerda={`Original · ${bytes(arquivo.size)}`}
          rotuloDireita={
            resultado
              ? `${NOME_FORMATO[resultado.ajuste.formato]} · ${bytes(resultado.tamanho)}`
              : 'Comprimindo…'
          }
          ocupado={ocupado}
        />

        <PainelDeCompressao
          ajuste={ajuste}
          aoAjustar={ajustaCom}
          suportados={suportados}
          larguraOriginal={dimensao.largura}
          alturaOriginal={dimensao.altura}
          tamanhoOriginal={arquivo.size}
          tamanhoComprimido={resultado?.tamanho}
          ocupado={ocupado}
          aoBaixar={baixa}
          aoTrocarImagem={trocaImagem}
        />
      </div>

        {erro && (
          <div className="nota nota-ruim cpr-nota">
            <div>
              <strong>Não deu para comprimir.</strong>
              <p>{erro}</p>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
