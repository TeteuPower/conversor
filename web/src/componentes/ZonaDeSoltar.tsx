import { useCallback, useEffect, useRef, useState } from 'react';
import { bytes } from '@conversor/nucleo';

interface Props {
  aoReceber: (arquivos: File[]) => void;
  /** Extensões aceitas, para o filtro do seletor de arquivo do sistema. */
  aceita: readonly string[];
  tamanhoMaximo: number;
  /** Compacta, para quando a fila já tem itens. */
  enxuta?: boolean;
}

/**
 * A zona de soltar.
 *
 * Duas coisas aqui são menos óbvias do que parecem.
 *
 * **1. O contador de entradas e saídas de arrasto.** `dragleave` dispara ao passar o ponteiro
 * sobre qualquer elemento FILHO da zona, não só ao sair dela. A implementação ingênua — ligar
 * no `dragenter` e desligar no `dragleave` — faz o realce piscar enquanto o usuário move o
 * arquivo por cima. Contar entradas e saídas e só desligar no zero resolve, e é o motivo de
 * `profundidade` ser um `useRef` em vez de estado: ele muda várias vezes por segundo durante o
 * arrasto e não deve provocar repintura.
 *
 * **2. A janela inteira é alvo.** O `document` também escuta, então soltar em qualquer lugar da
 * página funciona. Sem isso, soltar dois pixels fora da caixa faz o NAVEGADOR abrir o arquivo,
 * trocando a página do usuário pela imagem dele — perdendo a fila inteira. É a pior falha
 * possível aqui, e ela acontece por omissão.
 */
export function ZonaDeSoltar({ aoReceber, aceita, tamanhoMaximo, enxuta }: Props) {
  const [arrastando, setArrastando] = useState(false);
  const profundidade = useRef(0);
  const entrada = useRef<HTMLInputElement>(null);

  const recebe = useCallback(
    (lista: FileList | null) => {
      if (!lista || lista.length === 0) return;
      aoReceber(Array.from(lista));
    },
    [aoReceber],
  );

  useEffect(() => {
    const entra = (e: DragEvent) => {
      if (!temArquivo(e)) return;
      e.preventDefault();
      profundidade.current++;
      setArrastando(true);
    };
    const sai = (e: DragEvent) => {
      if (!temArquivo(e)) return;
      e.preventDefault();
      profundidade.current = Math.max(0, profundidade.current - 1);
      if (profundidade.current === 0) setArrastando(false);
    };
    const sobre = (e: DragEvent) => {
      if (!temArquivo(e)) return;
      // `preventDefault` no `dragover` é o que autoriza o `drop`. Sem ele o navegador segue com
      // o comportamento próprio e abre o arquivo, trocando a página.
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const solta = (e: DragEvent) => {
      if (!temArquivo(e)) return;
      e.preventDefault();
      profundidade.current = 0;
      setArrastando(false);
      recebe(e.dataTransfer?.files ?? null);
    };

    document.addEventListener('dragenter', entra);
    document.addEventListener('dragleave', sai);
    document.addEventListener('dragover', sobre);
    document.addEventListener('drop', solta);
    return () => {
      document.removeEventListener('dragenter', entra);
      document.removeEventListener('dragleave', sai);
      document.removeEventListener('dragover', sobre);
      document.removeEventListener('drop', solta);
    };
  }, [recebe]);

  const abre = () => entrada.current?.click();

  return (
    <div
      className={enxuta ? 'zona zona-enxuta' : 'zona'}
      data-arrastando={arrastando ? 'sim' : 'nao'}
    >
      <input
        ref={entrada}
        type="file"
        multiple
        className="so-leitor"
        accept={aceita.map((e) => `.${e}`).join(',')}
        onChange={(e) => {
          recebe(e.target.files);
          // Limpar o valor deixa o usuário escolher o MESMO arquivo de novo: sem isto, o
          // `change` não dispara na segunda vez e parece que a aplicação ignorou o clique.
          e.target.value = '';
        }}
      />

      {enxuta ? (
        <button className="zona-enxuta-botao" onClick={abre}>
          <IconeMais />
          {arrastando ? 'Solte para acrescentar' : 'Acrescentar arquivos'}
        </button>
      ) : (
        <>
          <div className={arrastando ? 'zona-alvo respira' : 'zona-alvo'} onClick={abre} role="presentation">
            <IconeSoltar arrastando={arrastando} />
            <h2 className="zona-titulo">
              {arrastando ? 'Solte aqui' : 'Solte os arquivos aqui'}
            </h2>
            <p className="zona-sub">
              ou <button className="link" onClick={(e) => { e.stopPropagation(); abre(); }}>escolha do computador</button>
            </p>
            <p className="zona-limite">
              Até {bytes(tamanhoMaximo)} por arquivo, quantos você quiser de uma vez
            </p>
          </div>

          <p className="zona-promessa">
            <IconeCadeado />
            <span>
              Tudo acontece nesta máquina. Nenhum arquivo é enviado para a internet — dá para
              conferir desligando a rede.
            </span>
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Arrastar TEXTO ou um link também dispara os eventos de arrasto, e reagir a isso faria a zona
 * acender ao selecionar texto na página. Só interessa quando há arquivo de verdade.
 */
function temArquivo(e: DragEvent): boolean {
  const t = e.dataTransfer;
  if (!t) return false;
  if (t.types.includes('Files')) return true;
  return Array.from(t.items ?? []).some((i) => i.kind === 'file');
}

const IconeSoltar = ({ arrastando }: { arrastando: boolean }) => (
  <svg
    width="46"
    height="46"
    viewBox="0 0 48 48"
    fill="none"
    aria-hidden="true"
    className="zona-icone"
    data-arrastando={arrastando ? 'sim' : 'nao'}
  >
    <path
      d="M24 32V10m0 0l-7.5 7.5M24 10l7.5 7.5"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M8 30v5.5A2.5 2.5 0 0010.5 38h27a2.5 2.5 0 002.5-2.5V30"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    />
  </svg>
);

const IconeMais = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 3.2v9.6M3.2 8h9.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);

const IconeCadeado = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="3.2" y="7" width="9.6" height="6.6" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
    <path d="M5.6 7V5.2a2.4 2.4 0 014.8 0V7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);
