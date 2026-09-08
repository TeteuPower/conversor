import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { formatoDe, type Aresta, type Etapa, type OpcoesImagem } from '@conversor/nucleo';
import { ErroDeEntrada, type Deteccao, type Engine, type Relator, type ResultadoEngine, type Tarefa } from './registro.js';

/**
 * A engine de imagem: libvips, pelo sharp.
 *
 * Por que libvips e não ImageMagick: libvips trabalha em faixas e mantém na memória só a faixa
 * corrente, então o consumo não acompanha o tamanho da imagem. Numa aplicação que roda na
 * máquina do usuário, junto do resto do que ele está fazendo, isso é o que decide se converter um
 * TIFF de digitalização é um detalhe ou é o computador travando.
 *
 * ---
 *
 * Sobre o progresso desta engine, que é o ponto delicado.
 *
 * libvips não avisa quanto andou. Não há callback de progresso, e não existe jeito honesto de
 * inventar um: fatiar a imagem para relatar de faixa em faixa quebraria os codificadores, que
 * precisam da imagem inteira. Então o progresso daqui é por ETAPA, e as etapas são de verdade —
 * cada avanço da barra corresponde a uma etapa que terminou mesmo.
 *
 * O que faz isso não parecer pobre não é mentira nenhuma na barra, é onde a animação mora: a
 * interface faz a barra DESLIZAR até o valor real em vez de saltar. A transição suaviza o
 * caminho até a verdade; ela nunca passa dela. Uma barra que andasse sozinha num timer chegaria
 * a 90% e travaria, e o usuário aprenderia a não acreditar nela.
 *
 * Os pesos das etapas saem de `medir-pesos.ts`, rodado nesta máquina. Eles importam porque a
 * codificação domina o tempo em proporção MUITO diferente conforme o destino: medido aqui,
 * AVIF gasta 1609 ms contra 28 ms do TIFF. Pesos iguais fariam a barra correr até 75% e ficar
 * parada 1,6 s no AVIF — tecnicamente correta e péssima de olhar.
 */

const ID = 'imagem';

/** O que esta engine aceita ler, se o libvips desta instalação confirmar. */
const ENTRADAS = ['png', 'jpg', 'webp', 'avif', 'gif', 'tiff', 'bmp', 'heic', 'svg', 'jp2', 'jxl'] as const;

/** O que esta engine aceita escrever, idem. */
const SAIDAS = ['png', 'jpg', 'webp', 'avif', 'gif', 'tiff', 'jp2', 'jxl'] as const;

/**
 * Como cada extensão do catálogo se chama dentro do libvips.
 *
 * Quase sempre é a própria extensão, mas não sempre — e um `undefined` escapando daqui para o
 * `sharp.format[...]` viraria "engine indisponível" sem nenhuma explicação.
 */
const NOME_VIPS: Readonly<Record<string, string>> = {
  png: 'png',
  jpg: 'jpeg',
  webp: 'webp',
  avif: 'heif', // AVIF e HEIC dividem o mesmo carregador no libvips
  heic: 'heif',
  gif: 'gif',
  tiff: 'tiff',
  bmp: 'bmp',
  svg: 'svg',
  jp2: 'jp2k',
  jxl: 'jxl',
  raw: 'raw',
};

/**
 * Peso relativo da codificação por formato de destino.
 *
 * Medido por `npm run medir-pesos --workspace=servidor` — sharp 0.33.5 / libvips 8.15.3, imagem
 * de prova 1600 × 1200 misturando degradê, bloco chapado e ruído. A unidade é o codificador mais
 * barato (TIFF/LZW, 28 ms).
 *
 * O que a medição mostrou, e que o palpite errava feio: AVIF gasta 57 vezes o TIFF (1609 ms), e
 * GIF e PNG vêm em segundo e terceiro (900 e 703 ms) por causa da QUANTIZAÇÃO de cor — não da
 * compressão. Eu tinha estimado 4 e 5 para eles. Com peso igual, a barra correria até 75% e
 * ficaria parada os 1,6 s do AVIF: tecnicamente correta, péssima de olhar.
 *
 * Um destino que não esteja aqui usa `PESO_CODIFICACAO_PADRAO`.
 */
const PESO_CODIFICACAO: Readonly<Record<string, number>> = {
  avif: 57, // 1609 ms
  gif: 32, //  900 ms — quantização para 256 cores
  png: 25, //  703 ms — idem, quando `palette` está ligado
  jpg: 5, //   140 ms
  webp: 5, //   129 ms
  tiff: 1, //    28 ms
  // Não medidos: este libvips não escreve jp2 nem jxl. Ficam na estimativa até aparecer uma
  // instalação que escreva, e a detecção os marca como indisponíveis de todo jeito.
  jp2: 8,
  jxl: 20,
};

/**
 * Formatos que a sonda diz que dá para escrever e que na prática não dá.
 *
 * Só o HEIC até agora, e ele custou uma investigação: AVIF e HEIC compartilham o carregador
 * `heif` no libvips, então `sharp.format.heif.output` responde `true` para os dois. Mas escrever
 * HEIC precisa do codificador HEVC, que não vem no pacote binário do sharp por causa de patente
 * — `heif({compression:'hevc'})` responde "heifsave: Unsupported compression", enquanto `'av1'`
 * (que é o AVIF) funciona.
 *
 * A lista é `readonly string[]`, e não das extensões: o valor dela é justamente valer para uma
 * extensão que alguém venha a acrescentar a `SAIDAS` amanhã.
 */
const SEM_ESCRITA: readonly string[] = ['heic'];

const PESO_CODIFICACAO_PADRAO = 5;

/**
 * Ler e ajustar praticamente não custam: 9 ms e 8 ms na mesma medição, contra 1609 ms do AVIF.
 * Recebem peso 1 para a barra sair do zero assim que o trabalho começa de verdade — ver zero por
 * um segundo faz duvidar de que apertar o botão funcionou.
 */
const PESO_DECODIFICACAO = 1;
const PESO_TRANSFORMACAO = 1;
const PESO_GRAVACAO = 1;

function etapasPara(para: string): readonly Etapa[] {
  return [
    { id: 'decodificar', rotulo: 'Lendo a imagem', peso: PESO_DECODIFICACAO },
    { id: 'transformar', rotulo: 'Ajustando', peso: PESO_TRANSFORMACAO },
    {
      id: 'codificar',
      rotulo: `Codificando ${formatoDe(para)?.nome ?? para.toUpperCase()}`,
      peso: PESO_CODIFICACAO[para] ?? PESO_CODIFICACAO_PADRAO,
    },
    { id: 'gravar', rotulo: 'Gravando', peso: PESO_GRAVACAO },
  ];
}

interface DetalheImagem extends Record<string, unknown> {
  entradas: string[];
  saidas: string[];
}

export const engineImagem: Engine = {
  id: ID,
  nome: 'libvips',
  descricao:
    'Converte imagem entre formatos de pixel. Trabalha em faixas e não carrega a imagem ' +
    'inteira na memória, então o tamanho do arquivo não decide o consumo da máquina.',

  /**
   * A detecção pergunta ao libvips o que ELE tem, em vez de assumir.
   *
   * Isto não é preciosismo. O pacote binário do sharp muda de suporte entre versões e entre
   * plataformas: AVIF vem sempre, JPEG XL quase nunca, e escrever HEIC não vem por causa de
   * patente. Assumir a lista daria ao usuário um destino que falha na hora de converter — o pior
   * dos dois mundos, porque ele já escolheu e já esperou.
   */
  async detecta(): Promise<Deteccao> {
    try {
      const fmt = sharp.format;
      const declara = (ext: string, lado: 'input' | 'output') => {
        const vips = NOME_VIPS[ext];
        if (!vips) return false;
        return fmt[vips as keyof typeof fmt]?.[lado]?.buffer === true;
      };

      const entradas = ENTRADAS.filter((e) => declara(e, 'input'));
      // `SEM_ESCRITA` é o que a sonda declara e a prática desmente. Confiar só na sonda daria
      // ao usuário um destino que falha DEPOIS de ele escolher e esperar.
      const saidas = SAIDAS.filter((e) => !SEM_ESCRITA.includes(e) && declara(e, 'output'));

      if (entradas.length === 0 || saidas.length === 0) {
        return {
          disponivel: false,
          ausencia: {
            tipo: 'sem-suporte',
            detalhe: 'O sharp carregou, mas o libvips por baixo não declarou nenhum formato.',
          },
        };
      }

      const detalhe: DetalheImagem = { entradas: [...entradas], saidas: [...saidas] };
      return { disponivel: true, versao: `sharp ${sharp.versions.sharp} / libvips ${sharp.versions.vips}`, detalhe };
    } catch (e) {
      return {
        disponivel: false,
        ausencia: {
          tipo: 'nao-instalada',
          comoInstalar:
            'O binário do sharp não carregou. Rode `npm install` de novo na raiz do projeto; ' +
            `se persistir, \`npm rebuild sharp\`. (${(e as Error).message})`,
        },
      };
    }
  },

  arestas(deteccao: Deteccao): readonly Aresta[] {
    if (!deteccao.disponivel) {
      // Engine ausente: as arestas continuam existindo, desabilitadas e com o motivo. É assim
      // que o seletor mostra o destino em cinza com a explicação em vez de sonegá-lo.
      return produto(ENTRADAS, SAIDAS).map(([de, para]) => ({
        de,
        para,
        engine: ID,
        disponivel: false,
        ausencia: deteccao.ausencia,
      }));
    }

    const { entradas, saidas } = deteccao.detalhe as unknown as DetalheImagem;
    const arestas: Aresta[] = [];
    for (const [de, para] of produto(ENTRADAS, SAIDAS)) {
      const podeLer = entradas.includes(de);
      const podeEscrever = saidas.includes(para);
      if (podeLer && podeEscrever) {
        arestas.push({ de, para, engine: ID, disponivel: true });
        continue;
      }
      arestas.push({
        de,
        para,
        engine: ID,
        disponivel: false,
        ausencia: {
          tipo: 'sem-suporte',
          detalhe: podeLer
            ? `Este libvips não escreve ${para.toUpperCase()}.` +
              (para === 'jxl' ? ' JPEG XL raramente vem compilado no pacote binário.' : '')
            : `Este libvips não lê ${de.toUpperCase()}.` +
              (de === 'heic' ? ' Decodificar HEIC depende de libheif com o codec HEVC.' : ''),
        },
      });
    }
    return arestas;
  },

  async converte(tarefa: Tarefa, relata: Relator): Promise<ResultadoEngine> {
    const { entrada, saida, para, sinal } = tarefa;
    const opc = tarefa.opcoes as OpcoesImagem;
    const destino = formatoDe(para);
    if (!destino) throw new ErroDeEntrada('destino-desconhecido', `Formato de destino desconhecido: ${para}.`);

    relata.etapas(etapasPara(para));
    relata.andou('decodificar', 0);

    const bytes = await readFile(entrada);
    sinal.throwIfAborted();

    // `limitInputPixels: false`: o teto de pixels do sharp existe para servidor exposto à
    // internet, contra bomba de descompressão. Aqui o arquivo é o usuário abrindo o próprio
    // arquivo na própria máquina; o limite útil é o de bytes, e ele é aplicado antes, no HTTP.
    let img = sharp(bytes, { limitInputPixels: false, animated: destino.animado === true });

    let meta: sharp.Metadata;
    try {
      meta = await img.metadata();
    } catch (e) {
      throw new ErroDeEntrada(
        'entrada-ilegivel',
        'Não deu para ler esta imagem. O arquivo pode estar truncado, ou a extensão pode não ' +
          'corresponder ao conteúdo.',
        (e as Error).message,
      );
    }
    if (!meta.width || !meta.height) {
      throw new ErroDeEntrada(
        'sem-dimensao',
        'Este arquivo não declara largura e altura. Se for um SVG sem tamanho, abra e defina ' +
          'width/height ou viewBox.',
      );
    }
    relata.andou('decodificar', 1, `${meta.width} × ${meta.height}`);
    sinal.throwIfAborted();

    /* ---------- transformação ---------- */
    relata.andou('transformar', 0);

    // Girar pelo EXIF ANTES de qualquer redimensionamento. Fora desta ordem, uma foto de retrato
    // tirada na horizontal recebe a largura pedida no eixo errado e sai deitada e esticada.
    if (opc.girarPeloExif !== false) img = img.rotate();

    if (opc.largura || opc.altura) {
      img = img.resize({
        ...(opc.largura ? { width: Math.round(opc.largura) } : {}),
        ...(opc.altura ? { height: Math.round(opc.altura) } : {}),
        fit: opc.modo === 'cobrir' ? 'cover' : opc.modo === 'esticar' ? 'fill' : 'inside',
        withoutEnlargement: opc.semAmpliar !== false,
        ...(opc.fundo ? { background: opc.fundo } : {}),
      });
    }

    // Achatar contra um fundo quando o destino não guarda transparência. Sem isto, o libvips
    // compõe contra preto, e um logo desenhado em preto sobre fundo vazado sai um retângulo
    // preto — tecnicamente correto, inútil na prática.
    const perdeAlfa = destino.temAlfa !== true && (await temTransparencia(bytes, meta));
    if (perdeAlfa) {
      const fundo = opc.fundo ?? '#FFFFFF';
      img = img.flatten({ background: fundo });
      relata.avisa(
        `${destino.nome} não guarda transparência. O que era transparente ficou ${fundo}; ` +
          'troque em Opções se quiser outra cor.',
      );
    }

    // Metadados fora por padrão: EXIF carrega modelo de câmera, data e às vezes coordenada de
    // GPS. Quem converte para publicar não espera publicar onde a foto foi tirada.
    if (opc.limparMetadados === false) img = img.withMetadata();

    relata.andou('transformar', 1);
    sinal.throwIfAborted();

    /* ---------- codificação ---------- */
    relata.andou('codificar', 0);
    img = aplicaCodificador(img, para, opc);

    let resultado: { data: Buffer; info: sharp.OutputInfo };
    try {
      resultado = await img.toBuffer({ resolveWithObject: true });
    } catch (e) {
      const msg = (e as Error).message;
      throw new ErroDeEntrada(
        'falha-na-codificacao',
        `O libvips não conseguiu escrever ${destino.nome}. ` +
          'Se a imagem for animada, tente um destino que aceite animação (WebP, GIF ou AVIF).',
        msg,
      );
    }
    relata.andou('codificar', 1);
    sinal.throwIfAborted();

    /* ---------- gravação ---------- */
    relata.andou('gravar', 0);
    await writeFile(saida, resultado.data);
    relata.andou('gravar', 1);

    if (opc.qualidade !== undefined && destino.comPerda !== true) {
      relata.avisa(
        `${destino.nome} não tem perda: a opção de qualidade foi ignorada porque não há o que ` +
          'ela possa ajustar.',
      );
    }

    return {
      diagnostico: {
        entrada: { largura: meta.width, altura: meta.height, formato: meta.format, temAlfa: meta.hasAlpha === true },
        saida: { largura: resultado.info.width, altura: resultado.info.height, canais: resultado.info.channels },
        achatouAlfa: perdeAlfa,
      },
    };
  },
};

/**
 * Escolhe e configura o codificador.
 *
 * Os padrões daqui são escolha de projeto, e cada um tem motivo:
 *
 * - **qualidade 82** para todo formato com perda. A faixa 80-85 é onde o artefato deixa de ser
 *   visível em tela sem que o arquivo cresça pelo detalhe que ninguém enxerga.
 * - **`effort` no meio da escala** para AVIF e WebP. O máximo dobra o tempo e devolve poucos por
 *   cento de tamanho; numa aplicação interativa, esperar não vale o troco.
 * - **`mozjpeg`** no JPEG: mesmo arquivo, menos peso, e já vem no pacote do sharp.
 */
function aplicaCodificador(img: sharp.Sharp, para: string, opc: OpcoesImagem): sharp.Sharp {
  const q = opc.qualidade ?? 82;
  switch (para) {
    case 'jpg':
      return img.jpeg({ quality: q, mozjpeg: true });
    case 'webp':
      return img.webp({ quality: q, effort: 4 });
    case 'avif':
      return img.avif({ quality: q, effort: 4 });
    case 'jxl':
      return img.jxl({ quality: q });
    case 'jp2':
      return img.jp2({ quality: q });
    case 'png':
      // PNG não tem perda de compressão; `compressionLevel` troca tempo por tamanho sem tocar no
      // pixel, e vale ficar no 9: medido sem paleta, o nível 9 dá 616 kB em 43 ms e o nível 6 dá
      // 996 kB em 28 ms — 15 ms para tirar 380 kB é barato.
      //
      // `palette` é outra história e está explicado em OpcoesImagem.paletaIndexada: ele indexa
      // as cores, o que reduz de verdade e é o que domina o tempo desta etapa.
      return img.png({ compressionLevel: 9, palette: opc.paletaIndexada !== false });
    case 'gif':
      return img.gif();
    case 'tiff':
      return img.tiff({ compression: 'lzw' });
    default:
      return img.toFormat(para as keyof sharp.FormatEnum);
  }
}

/**
 * Existe pixel transparente de verdade nesta imagem?
 *
 * `metadata().hasAlpha` responde outra pergunta: se existe um CANAL alfa. Um PNG rasterizado a
 * partir de SVG tem o canal e é inteiramente opaco, e confiar no `hasAlpha` fazia a aplicação
 * avisar "o que era transparente ficou branco" sobre uma imagem em que nada era transparente.
 * Aviso que não corresponde ao arquivo gasta a credibilidade dos avisos que correspondem.
 *
 * `stats().isOpaque` varre os pixels, então custa uma passada. Só vale a pena chamar quando o
 * canal existe E o destino não guarda alfa — fora disso a resposta não muda nada.
 */
async function temTransparencia(bytes: Buffer, meta: sharp.Metadata): Promise<boolean> {
  if (meta.hasAlpha !== true) return false;
  try {
    return !(await sharp(bytes, { limitInputPixels: false }).stats()).isOpaque;
  } catch {
    // Se a estatística falhar, o palpite conservador é assumir que há transparência: achatar uma
    // imagem opaca não muda nada, e o aviso a mais é melhor que uma composição contra preto.
    return true;
  }
}

function produto<A extends string, B extends string>(as: readonly A[], bs: readonly B[]): [A, B][] {
  const saida: [A, B][] = [];
  for (const a of as) for (const b of bs) if ((a as string) !== (b as string)) saida.push([a, b]);
  return saida;
}
