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

  // As duas direções do eixo do PDF pedem controles diferentes: sair de um PDF é escolher quais
  // páginas e em que resolução; entrar num PDF é escolher o tamanho da folha e a compressão.
  const dePdf = de === 'pdf';
  const paraPdf = para === 'pdf';
  const paraTexto = para === 'txt';
  const emFolha = (o.pdfPagina ?? 'imagem') !== 'imagem';

  /*
   * Indo para PDF, a imagem entra como JPEG quando "sem perda" está desmarcado — e aí a
   * qualidade manda no resultado. Sem isto, o painel não mostrava controle nenhum de qualidade
   * para PDF, e a engine usava 82 sem que ninguém pudesse mexer. O usuário tinha uma opção
   * escondida.
   */
  const embuteSemPerda = o.pdfSemPerda ?? origem?.comPerda !== true;
  const qualidadeImporta = (temPerda || (paraPdf && !embuteSemPerda)) && !paraTexto;

  /*
   * A paleta indexada do PNG tem padrão DIFERENTE conforme a engine, e a interface tem de dizer
   * o mesmo que a engine faz.
   *
   * Na engine de imagem ela vem ligada: em arte chapada indexar é quase grátis e corta o arquivo
   * quase pela metade. Na engine de PDF ela vem DESLIGADA, e por um motivo bom — uma página de
   * PDF é texto e linha, e indexar cor mastiga a borda do antisserrilhado da fonte.
   *
   * A caixa aparecia marcada nos dois casos, então quem rasterizava um PDF via "ligado" na tela
   * e recebia desligado no arquivo. É exatamente o tipo de mentira de interface que este projeto
   * recusa em toda parte, e ela tinha entrado por descuido.
   */
  const paletaLigadaPorPadrao = !dePdf;

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
          {qualidadeImporta && (
            <Campo
              rotulo="Qualidade"
              dica={
                paraPdf
                  ? 'A imagem entra no PDF como JPEG, e esta é a qualidade dele. Entre 80 e 85 o artefato deixa de ser visível em tela.'
                  : `${destino!.nome} tem perda. Entre 80 e 85 o artefato deixa de ser visível em tela sem o arquivo crescer pelo detalhe que ninguém enxerga.`
              }
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

          {dePdf && (
            <Campo
              rotulo="Páginas"
              dica={
                paraTexto
                  ? 'Quais páginas ler. Deixe "todas" para o documento inteiro.'
                  : 'Quais páginas rasterizar. Mais de uma vira um .zip, com uma imagem por página.'
              }
            >
              <div className="par">
                <input
                  type="text"
                  placeholder="todas"
                  value={o.paginas ?? ''}
                  onChange={(e) => muda('paginas', e.target.value || undefined)}
                  aria-label="Páginas"
                />
              </div>
              <p className="campo-dica">
                Aceita <code>3</code>, <code>2-5</code> e <code>1,4,7-9</code>.
              </p>
            </Campo>
          )}

          {dePdf && !paraTexto && (
            <Campo
              rotulo="Resolução"
              dica="Em pontos por polegada. 150 serve para tela e impressão caseira; 300 é o de gráfica, e dobra o tempo e a memória."
            >
              <div className="deslizante">
                <input
                  type="range"
                  min={72}
                  max={600}
                  step={6}
                  value={o.dpi ?? 150}
                  onChange={(e) => muda('dpi', Number(e.target.value))}
                  aria-label="Resolução em DPI"
                />
                <output>{o.dpi ?? 150} dpi</output>
              </div>
            </Campo>
          )}

          {paraPdf && (
            <>
              <Campo
                rotulo="Tamanho da página"
                dica="Do tamanho da imagem não deixa margem branca que ninguém pediu. Em folha, a imagem entra inteira e centralizada."
              >
                <div className="par">
                  <select
                    value={o.pdfPagina ?? 'imagem'}
                    onChange={(e) => muda('pdfPagina', e.target.value as 'imagem' | 'a4' | 'carta')}
                    aria-label="Tamanho da página"
                  >
                    <option value="imagem">Do tamanho da imagem</option>
                    <option value="a4">A4</option>
                    <option value="carta">Carta</option>
                  </select>
                </div>
              </Campo>

              {emFolha && (
                <Campo rotulo="Margem" dica="Em milímetros, nas quatro bordas.">
                  <div className="deslizante">
                    <input
                      type="range"
                      min={0}
                      max={40}
                      step={1}
                      value={o.pdfMargem ?? 10}
                      onChange={(e) => muda('pdfMargem', Number(e.target.value))}
                      aria-label="Margem em milímetros"
                    />
                    <output>{o.pdfMargem ?? 10} mm</output>
                  </div>
                </Campo>
              )}

              <Campo rotulo="Como embutir a imagem">
                <label className="caixa">
                  <input
                    type="checkbox"
                    checked={o.pdfSemPerda ?? origem?.comPerda !== true}
                    onChange={(e) => muda('pdfSemPerda', e.target.checked)}
                  />
                  <span>
                    Embutir sem perda
                    <em>
                      Ligado por padrão para origem sem perda (PNG, TIFF, GIF, SVG) e desligado
                      para origem com perda (JPEG, WebP, AVIF, HEIC) — quem tem um PNG de captura
                      de tela se importa com o texto nítido, e quem tem um JPEG já aceitou a
                      perda. Em foto, sem perda deixa o PDF bem maior.
                      {origem?.ext === 'jpg' && (
                        <>
                          {' '}
                          Neste JPEG, desligado significa que os bytes originais entram no PDF sem
                          serem recomprimidos.
                        </>
                      )}
                    </em>
                  </span>
                </label>
              </Campo>
            </>
          )}

          {!ehVetor && !dePdf && (
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

          {perdeAlfa && !paraTexto && (
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
                  checked={o.paletaIndexada ?? paletaLigadaPorPadrao}
                  onChange={(e) => muda('paletaIndexada', e.target.checked)}
                />
                <span>
                  Reduzir a paleta indexada
                  <em>
                    {dePdf
                      ? 'Desligada por padrão para página de PDF: indexar cor mastiga a borda do antisserrilhado da fonte, e página de PDF é texto e linha. Ligue se a página for um desenho chapado.'
                      : 'Medido: em arte chapada custa 68 ms contra 15 ms e sai quase pela metade (6 kB contra 11 kB). Em foto o preço vira 829 ms — desligue ao converter muitas fotos de uma vez.'}
                  </em>
                </span>
              </label>
            </Campo>
          )}

          {!ehVetor && !dePdf && !paraPdf && (
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
