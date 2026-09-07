import { useEffect, useRef, useState } from 'react';
import { formatoDe, type Opcoes } from '@conversor/nucleo';

interface Props {
  de: string;
  para: string;
  engine: string;
  opcoes: Opcoes;
  aoAplicar: (o: Opcoes) => void;
  aoFechar: () => void;
}

/**
 * As opções de uma conversão.
 *
 * O painel mostra só o que muda ALGUMA COISA nesta conversão específica. Qualidade não aparece
 * indo para PNG, porque PNG não tem perda e o controle não teria efeito; paleta indexada só
 * aparece indo para PNG; as opções do vetorizador só aparecem quando a engine é o vetorizador.
 * Mostrar um controle inerte é pior que esconder: ele convida a mexer e não faz nada, e o usuário
 * conclui que a aplicação ignorou o que ele pediu.
 *
 * Cada opção com custo mensurado diz o custo. "~14x mais lento" ao lado da paleta indexada é a
 * informação de que a pessoa precisa para decidir, e ela não tem como descobrir sozinha.
 */
export function PainelDeOpcoes({ de, para, engine, opcoes, aoAplicar, aoFechar }: Props) {
  const [o, setO] = useState<Opcoes>(opcoes);
  const painel = useRef<HTMLDivElement>(null);
  const destino = formatoDe(para);
  const origem = formatoDe(de);

  const ehVetor = engine === 'vetorizador';
  const temPerda = destino?.comPerda === true;
  const paraPng = para === 'png';
  const perdeAlfa = destino?.temAlfa !== true && origem?.temAlfa === true;

  useEffect(() => {
    const noTeclado = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        aoFechar();
      }
    };
    document.addEventListener('keydown', noTeclado, true);
    return () => document.removeEventListener('keydown', noTeclado, true);
  }, [aoFechar]);

  const muda = <K extends keyof Opcoes>(chave: K, valor: Opcoes[K]) =>
    setO((atual) => ({ ...atual, [chave]: valor }));

  return (
    <>
      <div className="cortina" onClick={aoFechar} aria-hidden="true" />
      <div
        className="painel painel-entra painel-opcoes"
        role="dialog"
        aria-modal="true"
        aria-label="Opções da conversão"
        ref={painel}
      >
        <header className="painel-topo">
          <div>
            <h2 className="painel-titulo">Opções</h2>
            <p className="painel-sub">
              {origem?.nome ?? de.toUpperCase()} para {destino?.nome ?? para.toUpperCase()}
            </p>
          </div>
          <button className="botao-icone" onClick={aoFechar} aria-label="Fechar">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="opcoes-corpo">
          {temPerda && (
            <Campo
              rotulo="Qualidade"
              dica={`${destino!.nome} tem perda. Entre 80 e 85 o artefato deixa de ser visível em tela sem o arquivo crescer pelo detalhe que ninguém enxerga.`}
            >
              <div className="deslizante">
                <input
                  type="range"
                  min={30}
                  max={100}
                  step={1}
                  value={o.qualidade ?? 82}
                  onChange={(e) => muda('qualidade', Number(e.target.value))}
                  aria-label="Qualidade"
                />
                <output>{o.qualidade ?? 82}</output>
              </div>
            </Campo>
          )}

          {!ehVetor && (
            <Campo
              rotulo="Redimensionar"
              dica="Deixe em branco para manter o tamanho original. Preencher só um dos dois mantém a proporção."
            >
              <div className="par">
                <input
                  type="number"
                  min={1}
                  placeholder="largura"
                  value={o.largura ?? ''}
                  onChange={(e) => muda('largura', e.target.value ? Number(e.target.value) : undefined)}
                  aria-label="Largura em pixels"
                />
                <span className="par-x">×</span>
                <input
                  type="number"
                  min={1}
                  placeholder="altura"
                  value={o.altura ?? ''}
                  onChange={(e) => muda('altura', e.target.value ? Number(e.target.value) : undefined)}
                  aria-label="Altura em pixels"
                />
              </div>
              {(o.largura || o.altura) && (
                <label className="caixa">
                  <input
                    type="checkbox"
                    checked={o.semAmpliar !== false}
                    onChange={(e) => muda('semAmpliar', e.target.checked)}
                  />
                  <span>
                    Não ampliar além do original
                    <em>Ampliar não cria detalhe: só deixa o arquivo maior e a imagem mais mole.</em>
                  </span>
                </label>
              )}
            </Campo>
          )}

          {perdeAlfa && (
            <Campo
              rotulo="Cor de fundo"
              dica={`${destino!.nome} não guarda transparência. O que era transparente recebe esta cor.`}
            >
              <div className="cor">
                <input
                  type="color"
                  value={o.fundo ?? '#FFFFFF'}
                  onChange={(e) => muda('fundo', e.target.value.toUpperCase())}
                  aria-label="Cor de fundo"
                />
                <code>{o.fundo ?? '#FFFFFF'}</code>
              </div>
            </Campo>
          )}

          {paraPng && (
            <Campo rotulo="Compressão do PNG">
              <label className="caixa">
                <input
                  type="checkbox"
                  checked={o.paletaIndexada !== false}
                  onChange={(e) => muda('paletaIndexada', e.target.checked)}
                />
                <span>
                  Reduzir a paleta indexada
                  <em>
                    Medido: em arte chapada custa 68 ms contra 15 ms e sai quase pela metade
                    (6 kB contra 11 kB). Em foto o preço vira 829 ms — desligue ao converter
                    muitas fotos de uma vez.
                  </em>
                </span>
              </label>
            </Campo>
          )}

          {!ehVetor && (
            <Campo rotulo="Metadados">
              <label className="caixa">
                <input
                  type="checkbox"
                  checked={o.limparMetadados !== false}
                  onChange={(e) => muda('limparMetadados', e.target.checked)}
                />
                <span>
                  Remover EXIF, GPS e perfil de cor
                  <em>
                    Ligado por padrão. O EXIF de uma foto carrega modelo de câmera, data e às
                    vezes a coordenada de onde ela foi tirada.
                  </em>
                </span>
              </label>
              <label className="caixa">
                <input
                  type="checkbox"
                  checked={o.girarPeloExif !== false}
                  onChange={(e) => muda('girarPeloExif', e.target.checked)}
                />
                <span>
                  Corrigir a rotação pelo EXIF
                  <em>Sem isto, foto de retrato tirada na horizontal sai deitada.</em>
                </span>
              </label>
            </Campo>
          )}

          {ehVetor && (
            <>
              <Campo
                rotulo="Fidelidade do traçado"
                dica="Tolerância do ajuste de Bézier, em pixels. Menor deixa o contorno mais fiel e o arquivo com mais nós."
              >
                <div className="deslizante">
                  <input
                    type="range"
                    min={0.2}
                    max={2}
                    step={0.1}
                    value={o.tol ?? 0.6}
                    onChange={(e) => muda('tol', Number(e.target.value))}
                    aria-label="Tolerância do traçado"
                  />
                  <output>{(o.tol ?? 0.6).toFixed(1).replace('.', ',')} px</output>
                </div>
              </Campo>

              <Campo
                rotulo="Máximo de classes de cor"
                dica="É um TETO, não o número usado. O vetorizador escolhe quantas classes precisa pelo resíduo do modelo de pintura, e para na primeira que fecha."
              >
                <div className="deslizante">
                  <input
                    type="range"
                    min={2}
                    max={24}
                    step={1}
                    value={o.maxCores ?? 12}
                    onChange={(e) => muda('maxCores', Number(e.target.value))}
                    aria-label="Máximo de classes de cor"
                  />
                  <output>{o.maxCores ?? 12}</output>
                </div>
              </Campo>

              <Campo rotulo="Imagem fotográfica">
                <label className="caixa">
                  <input
                    type="checkbox"
                    checked={o.forcarFoto === true}
                    onChange={(e) => muda('forcarFoto', e.target.checked)}
                  />
                  <span>
                    Vetorizar mesmo assim
                    <em>
                      Por padrão o vetorizador recusa foto, e a recusa está certa: o SVG sairia
                      maior que o original e com menos detalhe. Marque se souber o que quer.
                    </em>
                  </span>
                </label>
              </Campo>
            </>
          )}
        </div>

        <footer className="painel-pe">
          <button className="botao-fantasma" onClick={() => setO({})}>
            Voltar ao padrão
          </button>
          <div className="painel-pe-direita">
            <button className="botao-fantasma" onClick={aoFechar}>
              Cancelar
            </button>
            <button
              className="botao-principal"
              onClick={() => {
                aoAplicar(o);
                aoFechar();
              }}
            >
              Aplicar
            </button>
          </div>
        </footer>
      </div>
    </>
  );
}

function Campo({
  rotulo,
  dica,
  children,
}: {
  rotulo: string;
  dica?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="campo">
      <h3 className="campo-rotulo">{rotulo}</h3>
      {dica && <p className="campo-dica">{dica}</p>}
      {children}
    </section>
  );
}
