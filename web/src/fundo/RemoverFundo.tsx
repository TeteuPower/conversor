import { useCallback, useEffect, useRef, useState } from 'react';
import { bytes as emBytes, duracao as emDuracao, percentual, trocaExtensao, type Etapa } from '@conversor/nucleo';
import { Cabecalho, usaTema } from '../componentes/Cabecalho.js';
import { ErroDeRemocao, buscaModelos, removeFundo, type Andamento } from './api.js';
import { Editor, type Fundo, type ModoPincel } from './editor.js';
import './fundo.css';

/**
 * A ferramenta de remover fundo.
 *
 * O desenho da tela segue o do remove.bg no que ele acertou — soltar a imagem, ver o recorte
 * sobre o xadrez, trocar o fundo, retocar com o pincel — e se afasta dele em duas coisas.
 *
 * A primeira é a **comparação**. Lá o antes e o depois ficam em abas; aqui ficam na mesma imagem,
 * com um divisor que se arrasta. Julgar recorte é julgar borda, e borda se julga com os dois
 * estados encostados, não alternando entre telas.
 *
 * A segunda é o **download do modelo**. São 490 MB na primeira vez, e escondê-los atrás de um
 * "processando..." seria a pior escolha possível: o usuário concluiria que travou. Ele ganha uma
 * tela própria, com os bytes contados de verdade.
 */

type Fase =
  | { nome: 'vazio' }
  | { nome: 'baixando-modelo'; fracao: number; detalhe: string; arquivo: File }
  | { nome: 'trabalhando'; andamento: Andamento; arquivo: File; previa: string }
  | { nome: 'pronto' }
  | { nome: 'erro'; erro: ErroDeRemocao };

const CORES_DE_FUNDO = [
  { rotulo: 'Branco', cor: '#ffffff' },
  { rotulo: 'Cinza claro', cor: '#f1f3f7' },
  { rotulo: 'Preto', cor: '#101216' },
  { rotulo: 'Azul', cor: '#2f66f5' },
  { rotulo: 'Verde', cor: '#12855b' },
  { rotulo: 'Magenta', cor: '#c0398f' },
] as const;

export function RemoverFundo() {
  const [tema, setTema] = usaTema();
  const [fase, setFase] = useState<Fase>({ nome: 'vazio' });
  const [editor, setEditor] = useState<Editor>();
  const [fundo, setFundo] = useState<Fundo>({ tipo: 'transparente' });
  const [avisos, setAvisos] = useState<readonly string[]>([]);
  const [info, setInfo] = useState<{ modelo: string; provedor: string; ms: number; nome: string }>();

  // pincel
  const [pincelLigado, setPincelLigado] = useState(false);
  const [modo, setModo] = useState<ModoPincel>('restaurar');
  const [raio, setRaio] = useState(28);
  const [versao, setVersao] = useState(0); // força redesenho após pincelada

  // comparação
  const [comparando, setComparando] = useState(false);
  const [divisor, setDivisor] = useState(0.5);

  const cancelar = useRef<AbortController>();

  /* ---------- receber o arquivo ---------- */

  const recebe = useCallback(async (arquivo: File) => {
    cancelar.current?.abort();
    const ctrl = new AbortController();
    cancelar.current = ctrl;

    setAvisos([]);
    setEditor(undefined);
    setInfo(undefined);
    setPincelLigado(false);
    setComparando(false);
    setFundo({ tipo: 'transparente' });

    const previa = URL.createObjectURL(arquivo);
    setFase({
      nome: 'trabalhando',
      arquivo,
      previa,
      andamento: { fracao: 0, rotulo: 'Preparando' },
    });

    try {
      const recorte = await removeFundo({
        arquivo,
        opcoes: { descontaminar: true },
        sinal: ctrl.signal,
        aoAndar: (andamento) =>
          setFase((f) => (f.nome === 'trabalhando' ? { ...f, andamento } : f)),
        aoAvisar: (texto) => setAvisos((a) => (a.includes(texto) ? a : [...a, texto])),
        aoBaixarModelo: (fracao, detalhe) =>
          setFase((f) =>
            f.nome === 'trabalhando' || f.nome === 'baixando-modelo'
              ? { nome: 'baixando-modelo', fracao, detalhe, arquivo }
              : f,
          ),
      });

      const mascara = await createImageBitmap(
        await (await fetch(recorte.resultado.mascaraUrl, { signal: ctrl.signal })).blob(),
      );
      const ed = await Editor.de(recorte.imagem, mascara);

      URL.revokeObjectURL(previa);
      setEditor(ed);
      setInfo({
        modelo: recorte.resultado.modelo,
        provedor: recorte.resultado.provedor,
        ms: recorte.resultado.msModelo,
        nome: recorte.nome,
      });
      setFase({ nome: 'pronto' });

      // Recorte quase sem borda macia costuma ser modelo que não pegou fio de cabelo. Vale
      // apontar o pincel antes de a pessoa concluir que a ferramenta não serve.
      if (recorte.resultado.fracaoDeBorda < 0.004) {
        setAvisos((a) => [
          ...a,
          'A borda saiu bem dura. Se a imagem tem cabelo ou pelo solto, o pincel de restaurar ' +
            'recupera o que o modelo comeu.',
        ]);
      }
    } catch (e) {
      URL.revokeObjectURL(previa);
      if ((e as Error)?.name === 'AbortError') {
        setFase({ nome: 'vazio' });
        return;
      }
      setFase({
        nome: 'erro',
        erro: e instanceof ErroDeRemocao ? e : new ErroDeRemocao('desconhecido', String(e)),
      });
    }
  }, []);

  useEffect(() => () => cancelar.current?.abort(), []);

  /* ---------- render ---------- */

  return (
    <>
      <Cabecalho
        capacidades={undefined}
        tema={tema}
        aoTrocarTema={setTema}
        subtitulo="o modelo roda na sua máquina"
      />
      <main className="envelope principal">
        <section className="fundo" aria-label="Remover fundo">
          {fase.nome === 'vazio' && <Entrada aoReceber={recebe} />}

          {fase.nome === 'baixando-modelo' && <BaixandoModelo fracao={fase.fracao} detalhe={fase.detalhe} />}

          {fase.nome === 'trabalhando' && <Trabalhando previa={fase.previa} andamento={fase.andamento} />}

          {fase.nome === 'erro' && (
            <Erro
              erro={fase.erro}
              aoTentarDeNovo={() => setFase({ nome: 'vazio' })}
            />
          )}

          {fase.nome === 'pronto' && editor && (
            <div className="fundo-resultado" key={info?.nome}>
              <Tela
                editor={editor}
                fundo={fundo}
                pincelLigado={pincelLigado}
                modo={modo}
                raio={raio}
                comparando={comparando}
                divisor={divisor}
                aoMudarDivisor={setDivisor}
                aoPintar={() => setVersao((v) => v + 1)}
                versao={versao}
              />

              <Controles
                editor={editor}
                fundo={fundo}
                aoTrocarFundo={setFundo}
                pincelLigado={pincelLigado}
                aoLigarPincel={setPincelLigado}
                modo={modo}
                aoTrocarModo={setModo}
                raio={raio}
                aoTrocarRaio={setRaio}
                comparando={comparando}
                aoComparar={setComparando}
                versao={versao}
                aoMudar={() => setVersao((v) => v + 1)}
                info={info}
                aoNovaImagem={() => setFase({ nome: 'vazio' })}
              />

              {avisos.length > 0 && (
                <ul className="fundo-avisos" aria-live="polite">
                  {avisos.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </main>
    </>
  );
}

/* ==================== entrada ==================== */

function Entrada({ aoReceber }: { aoReceber: (a: File) => void }) {
  const [sobre, setSobre] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);
  const [modelos, setModelos] = useState<{ baixado: boolean; bytes: number; nome: string }>();

  useEffect(() => {
    void buscaModelos()
      .then((e) => {
        const m = e.modelos.find((x) => x.id === e.padrao);
        if (m) setModelos({ baixado: m.baixado, bytes: m.bytes, nome: m.nome });
      })
      .catch(() => {});
  }, []);

  // Colar do teclado: é como se traz uma captura de tela, e é o caminho mais curto que existe.
  useEffect(() => {
    const aoColar = (ev: ClipboardEvent) => {
      const arquivo = [...(ev.clipboardData?.items ?? [])]
        .filter((i) => i.type.startsWith('image/'))
        .map((i) => i.getAsFile())
        .find(Boolean);
      if (arquivo) aoReceber(arquivo);
    };
    window.addEventListener('paste', aoColar);
    return () => window.removeEventListener('paste', aoColar);
  }, [aoReceber]);

  const solta = (ev: React.DragEvent) => {
    ev.preventDefault();
    setSobre(false);
    const arquivo = [...ev.dataTransfer.files].find((f) => f.type.startsWith('image/'));
    if (arquivo) aoReceber(arquivo);
  };

  return (
    <div
      className="fundo-zona"
      data-sobre={sobre ? 'sim' : 'nao'}
      onDragOver={(e) => {
        e.preventDefault();
        setSobre(true);
      }}
      onDragLeave={() => setSobre(false)}
      onDrop={solta}
    >
      <input
        ref={entrada}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const a = e.target.files?.[0];
          if (a) aoReceber(a);
          e.target.value = '';
        }}
      />

      <div className="fundo-zona-miolo">
        <Tesoura />
        <h2>Remover o fundo</h2>
        <p className="fundo-zona-linha">
          Solte uma imagem aqui, cole com <kbd>Ctrl</kbd> + <kbd>V</kbd>, ou
        </p>
        <button type="button" className="botao-principal" onClick={() => entrada.current?.click()}>
          Escolher imagem
        </button>
        <p className="fundo-zona-nota">
          A imagem não sai desta máquina: quem separa o assunto do fundo é um modelo rodando no
          seu computador.
        </p>
        {modelos && !modelos.baixado && (
          <p className="fundo-zona-nota fundo-zona-atencao">
            Na primeira vez, {modelos.nome} precisa ser baixado — {emBytes(modelos.bytes)}, uma vez só.
          </p>
        )}
      </div>
    </div>
  );
}

/* ==================== enquanto trabalha ==================== */

function BaixandoModelo({ fracao, detalhe }: { fracao: number; detalhe: string }) {
  return (
    <div className="fundo-espera fundo-espera-modelo">
      <div className="fundo-espera-miolo">
        <h2>Trazendo o modelo</h2>
        <p>
          São cerca de meio giga, e acontece uma vez só. Da próxima vez a remoção começa na hora.
        </p>
        <div className="barra" data-ativa="sim" style={{ ['--fracao' as string]: fracao }}>
          <div className="barra-trilho" />
          <div className="barra-preenchimento" />
          <div className="barra-brilho" />
        </div>
        <p className="fundo-espera-numero">
          <strong>{percentual(fracao)}</strong>
          <span>{detalhe}</span>
        </p>
      </div>
    </div>
  );
}

function Trabalhando({ previa, andamento }: { previa: string; andamento: Andamento }) {
  return (
    <div className="fundo-espera">
      <img className="fundo-espera-previa" src={previa} alt="" />
      <div className="fundo-espera-veu" />
      <div className="fundo-espera-miolo">
        <div className="barra" data-ativa="sim" style={{ ['--fracao' as string]: andamento.fracao }}>
          <div className="barra-trilho" />
          <div className="barra-preenchimento" />
          <div className="barra-brilho" />
        </div>
        <p className="fundo-espera-numero">
          <strong>{percentual(andamento.fracao)}</strong>
          <span>
            {andamento.rotulo}
            {andamento.detalhe ? ` — ${andamento.detalhe}` : ''}
          </span>
        </p>
        {andamento.etapas && (
          <ol className="fundo-etapas">
            {andamento.etapas.map((e: Etapa) => (
              <li key={e.id} data-estado={estadoDaEtapa(e.id, andamento)}>
                {e.rotulo}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function estadoDaEtapa(id: string, a: Andamento): 'feita' | 'agora' | 'esperando' {
  if (!a.etapas || !a.etapaAtual) return 'esperando';
  const i = a.etapas.findIndex((e) => e.id === id);
  const atual = a.etapas.findIndex((e) => e.id === a.etapaAtual);
  if (atual < 0) return 'esperando';
  return i < atual ? 'feita' : i === atual ? 'agora' : 'esperando';
}

function Erro({ erro, aoTentarDeNovo }: { erro: ErroDeRemocao; aoTentarDeNovo: () => void }) {
  return (
    <div className="fundo-erro" role="alert">
      <h2>Não deu certo</h2>
      <p>{erro.message}</p>
      {erro.detalhe && <pre className="fundo-erro-detalhe">{erro.detalhe}</pre>}
      <button type="button" className="botao-principal" onClick={aoTentarDeNovo}>
        Tentar com outra imagem
      </button>
    </div>
  );
}

/* ==================== a tela do resultado ==================== */

interface PropsTela {
  editor: Editor;
  fundo: Fundo;
  pincelLigado: boolean;
  modo: ModoPincel;
  raio: number;
  comparando: boolean;
  divisor: number;
  aoMudarDivisor: (v: number) => void;
  aoPintar: () => void;
  versao: number;
}

function Tela(props: PropsTela) {
  const { editor, fundo, pincelLigado, modo, raio, comparando, divisor, aoMudarDivisor, aoPintar, versao } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const pintando = useRef(false);
  const ultimo = useRef<{ x: number; y: number }>();
  const [cursor, setCursor] = useState<{ x: number; y: number } | undefined>();

  /* redesenha quando muda qualquer coisa */
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    if (c.width !== editor.largura || c.height !== editor.altura) {
      c.width = editor.largura;
      c.height = editor.altura;
    }
    editor.desenha(ctx, fundo);
  }, [editor, fundo, versao]);

  /** Converte coordenada de tela em coordenada de imagem. */
  const paraImagem = (ev: React.PointerEvent): { x: number; y: number } | undefined => {
    const c = canvas.current;
    if (!c) return undefined;
    const r = c.getBoundingClientRect();
    return {
      x: ((ev.clientX - r.left) / r.width) * editor.largura,
      y: ((ev.clientY - r.top) / r.height) * editor.altura,
    };
  };

  /** Raio do pincel em pixels de imagem — o controle é em pixels de tela. */
  const raioNaImagem = (): number => {
    const c = canvas.current;
    if (!c) return raio;
    const r = c.getBoundingClientRect();
    return (raio / r.width) * editor.largura;
  };

  const desce = (ev: React.PointerEvent) => {
    if (!pincelLigado) return;
    const p = paraImagem(ev);
    if (!p) return;
    (ev.target as Element).setPointerCapture(ev.pointerId);
    pintando.current = true;
    editor.comecaTraco();
    editor.pinta(p.x, p.y, raioNaImagem(), modo);
    ultimo.current = p;
    aoPintar();
  };

  const move = (ev: React.PointerEvent) => {
    const p = paraImagem(ev);
    if (p && pincelLigado) setCursor(p);
    if (!pintando.current || !p) return;
    // Interpola entre o ponto anterior e o atual: sem isso, mover rápido deixa a pincelada
    // pontilhada, porque o navegador só entrega alguns eventos por quadro.
    const a = ultimo.current ?? p;
    const r = raioNaImagem();
    const dist = Math.hypot(p.x - a.x, p.y - a.y);
    const passos = Math.max(1, Math.ceil(dist / (r * 0.25)));
    for (let i = 1; i <= passos; i++) {
      editor.pinta(a.x + ((p.x - a.x) * i) / passos, a.y + ((p.y - a.y) * i) / passos, r, modo);
    }
    ultimo.current = p;
    aoPintar();
  };

  const sobe = () => {
    if (!pintando.current) return;
    pintando.current = false;
    ultimo.current = undefined;
    editor.terminaTraco();
    aoPintar();
  };

  /* o divisor da comparação */
  const arrastaDivisor = (ev: React.PointerEvent) => {
    const c = caixa.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    aoMudarDivisor(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)));
  };

  const proporcao = editor.largura / editor.altura;

  return (
    <div className="fundo-tela" ref={caixa} style={{ aspectRatio: String(proporcao) }}>
      <div className="fundo-xadrez" aria-hidden="true" />

      <canvas
        ref={canvas}
        className="fundo-canvas"
        data-pincel={pincelLigado ? 'sim' : 'nao'}
        onPointerDown={desce}
        onPointerMove={move}
        onPointerUp={sobe}
        onPointerCancel={sobe}
        onPointerLeave={() => setCursor(undefined)}
      />

      {comparando && (
        <>
          <div className="fundo-antes" style={{ clipPath: `inset(0 ${(1 - divisor) * 100}% 0 0)` }}>
            <OriginalDoEditor editor={editor} />
          </div>
          <div
            className="fundo-divisor"
            style={{ left: `${divisor * 100}%` }}
            onPointerDown={(e) => {
              (e.target as Element).setPointerCapture(e.pointerId);
              arrastaDivisor(e);
            }}
            onPointerMove={(e) => {
              if (e.buttons > 0) arrastaDivisor(e);
            }}
            role="separator"
            aria-label="Divisor entre antes e depois"
            aria-valuenow={Math.round(divisor * 100)}
          >
            <span className="fundo-divisor-alca" />
          </div>
          <span className="fundo-rotulo fundo-rotulo-esq">antes</span>
          <span className="fundo-rotulo fundo-rotulo-dir">depois</span>
        </>
      )}

      {pincelLigado && cursor && (
        <span
          className="fundo-cursor"
          data-modo={modo}
          style={{
            left: `${(cursor.x / editor.largura) * 100}%`,
            top: `${(cursor.y / editor.altura) * 100}%`,
            width: raio * 2,
            height: raio * 2,
          }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

/**
 * O "antes": o primeiro plano opaco, que é a foto original.
 *
 * Sai do próprio editor, e não de um `objectURL` do arquivo que o usuário soltou: o editor já
 * tem esses pixels decodificados, e desenhar dali dispensa segurar o arquivo original na
 * memória junto.
 */
function OriginalDoEditor({ editor }: { editor: Editor }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    c.width = editor.largura;
    c.height = editor.altura;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    editor.desenha(ctx, { tipo: 'cor', cor: '#00000000' });
    // Desenha o primeiro plano inteiro, ignorando o alfa: é o estado ANTES do recorte.
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(editor.primeiroPlano, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }, [editor]);
  return <canvas ref={canvas} className="fundo-canvas" />;
}

/* ==================== controles ==================== */

interface PropsControles {
  editor: Editor;
  fundo: Fundo;
  aoTrocarFundo: (f: Fundo) => void;
  pincelLigado: boolean;
  aoLigarPincel: (v: boolean) => void;
  modo: ModoPincel;
  aoTrocarModo: (m: ModoPincel) => void;
  raio: number;
  aoTrocarRaio: (r: number) => void;
  comparando: boolean;
  aoComparar: (v: boolean) => void;
  versao: number;
  aoMudar: () => void;
  info: { modelo: string; provedor: string; ms: number; nome: string } | undefined;
  aoNovaImagem: () => void;
}

function Controles(p: PropsControles) {
  const { editor, fundo, aoTrocarFundo, info } = p;
  const [recortar, setRecortar] = useState(false);
  const entradaImagem = useRef<HTMLInputElement>(null);

  const podeJpeg = fundo.tipo !== 'transparente';

  const baixa = async (tipo: 'image/png' | 'image/jpeg') => {
    const blob = await editor.exporta(fundo, tipo, recortar);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = trocaExtensao(info?.nome ?? 'recorte', tipo === 'image/png' ? 'png' : 'jpg');
    a.click();
    // O revoke espera um quadro: revogar na mesma volta cancela o download em alguns navegadores.
    requestAnimationFrame(() => URL.revokeObjectURL(url));
  };

  return (
    <div className="fundo-controles">
      <div className="fundo-grupo">
        <span className="fundo-grupo-nome">Fundo</span>
        <div className="fundo-cores">
          <button
            type="button"
            className="fundo-cor fundo-cor-vazia"
            data-ativo={fundo.tipo === 'transparente' ? 'sim' : 'nao'}
            onClick={() => aoTrocarFundo({ tipo: 'transparente' })}
            title="Transparente"
            aria-label="Fundo transparente"
          />
          {CORES_DE_FUNDO.map((c) => (
            <button
              key={c.cor}
              type="button"
              className="fundo-cor"
              style={{ background: c.cor }}
              data-ativo={fundo.tipo === 'cor' && fundo.cor === c.cor ? 'sim' : 'nao'}
              onClick={() => aoTrocarFundo({ tipo: 'cor', cor: c.cor })}
              title={c.rotulo}
              aria-label={`Fundo ${c.rotulo.toLowerCase()}`}
            />
          ))}
          <label className="fundo-cor fundo-cor-livre" title="Escolher cor">
            <input
              type="color"
              onChange={(e) => aoTrocarFundo({ tipo: 'cor', cor: e.target.value })}
              aria-label="Escolher cor do fundo"
            />
          </label>
          <button
            type="button"
            className="fundo-cor fundo-cor-imagem"
            data-ativo={fundo.tipo === 'imagem' ? 'sim' : 'nao'}
            onClick={() => entradaImagem.current?.click()}
            title="Usar uma imagem de fundo"
            aria-label="Usar uma imagem de fundo"
          />
          <input
            ref={entradaImagem}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const a = e.target.files?.[0];
              if (a) aoTrocarFundo({ tipo: 'imagem', imagem: await createImageBitmap(a) });
              e.target.value = '';
            }}
          />
        </div>
      </div>

      <div className="fundo-grupo">
        <span className="fundo-grupo-nome">Retoque</span>
        <div className="fundo-linha">
          <button
            type="button"
            className="botao-secundario"
            data-ativo={p.pincelLigado ? 'sim' : 'nao'}
            onClick={() => p.aoLigarPincel(!p.pincelLigado)}
            aria-pressed={p.pincelLigado}
          >
            Pincel
          </button>

          {p.pincelLigado && (
            <>
              <div className="fundo-segmentado" role="group" aria-label="O que o pincel faz">
                <button
                  type="button"
                  data-ativo={p.modo === 'restaurar' ? 'sim' : 'nao'}
                  onClick={() => p.aoTrocarModo('restaurar')}
                >
                  Restaurar
                </button>
                <button
                  type="button"
                  data-ativo={p.modo === 'apagar' ? 'sim' : 'nao'}
                  onClick={() => p.aoTrocarModo('apagar')}
                >
                  Apagar
                </button>
              </div>

              <label className="fundo-deslizante">
                <span>Tamanho</span>
                <input
                  type="range"
                  min={6}
                  max={140}
                  value={p.raio}
                  onChange={(e) => p.aoTrocarRaio(Number(e.target.value))}
                />
              </label>

              <button
                type="button"
                className="botao-secundario"
                disabled={!editor.podeDesfazer}
                onClick={() => {
                  editor.desfaz();
                  p.aoMudar();
                }}
              >
                Desfazer
              </button>

              {editor.foiRetocado && (
                <button
                  type="button"
                  className="botao-fantasma"
                  onClick={() => {
                    editor.recomeca();
                    p.aoMudar();
                  }}
                >
                  Recomeçar
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="fundo-grupo">
        <span className="fundo-grupo-nome">Saída</span>
        <div className="fundo-linha">
          <label className="fundo-caixa">
            <input type="checkbox" checked={recortar} onChange={(e) => setRecortar(e.target.checked)} />
            Recortar no assunto
          </label>
          <label className="fundo-caixa">
            <input
              type="checkbox"
              checked={p.comparando}
              onChange={(e) => p.aoComparar(e.target.checked)}
            />
            Comparar com o original
          </label>
          <button type="button" className="botao-principal" onClick={() => void baixa('image/png')}>
            Baixar PNG
          </button>
          {podeJpeg && (
            <button type="button" className="botao-secundario" onClick={() => void baixa('image/jpeg')}>
              Baixar JPEG
            </button>
          )}
          <button type="button" className="botao-fantasma" onClick={p.aoNovaImagem}>
            Outra imagem
          </button>
        </div>
      </div>

      {info && (
        <p className="fundo-ficha">
          {editor.largura} × {editor.altura} · {info.modelo} em {rotuloProvedor(info.provedor)} ·{' '}
          {emDuracao(info.ms)}
        </p>
      )}
    </div>
  );
}

const rotuloProvedor = (p: string): string =>
  p === 'dml' ? 'GPU (DirectML)' : p === 'cuda' ? 'GPU (CUDA)' : p === 'webgpu' ? 'GPU (WebGPU)' : 'CPU';

function Tesoura() {
  return (
    <svg className="fundo-icone" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="12" cy="36" r="6" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="36" cy="36" r="6" stroke="currentColor" strokeWidth="2.5" />
      <path d="M16 32 34 8M32 32 14 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
