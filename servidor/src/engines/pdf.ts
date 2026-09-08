import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { PDFiumLibrary, type PDFiumDocument } from '@hyzyla/pdfium';
import sharp from 'sharp';
import {
  formatoDe,
  montaZipPartes,
  nomesUnicos,
  type Aresta,
  type ArquivoDoZip,
  type Etapa,
  type Opcoes,
} from '@conversor/nucleo';
import { gravaPartes } from '../armazenamento.js';
import { montaPdf, mmParaPontos, type ImagemParaPdf, type TamanhoPagina } from '../pdf/escritor.js';
import {
  ErroDeEntrada,
  type Deteccao,
  type Engine,
  type Relator,
  type ResultadoEngine,
  type Tarefa,
} from './registro.js';

/**
 * O eixo do PDF: página para imagem, e imagem para página.
 *
 * Duas direções, dois mecanismos:
 *
 * - **PDF para imagem** — pdfium, o mecanismo de PDF do Chrome, compilado em WebAssembly. Ele
 *   rasteriza a página num bitmap RGBA e o sharp codifica no formato pedido, então esta engine
 *   herda de graça tudo o que a engine de imagem já sabe fazer.
 * - **Imagem para PDF** — escritor próprio, em `../pdf/escritor.ts`. O motivo de não usar
 *   biblioteca está no cabeçalho dele: um JPEG entra no PDF byte a byte, sem decodificar nem
 *   recomprimir.
 *
 * Por que pdfium em WebAssembly e não o Ghostscript nativo: WebAssembly vem pelo `npm install`,
 * sem instalação de sistema, o que mantém a promessa de que este projeto sobe com um comando. O
 * Ghostscript ainda fica no caminho, para o que ele faz e o pdfium não — comprimir PDF
 * preservando o texto, e converter PostScript.
 *
 * ---
 *
 * Sobre o progresso, que aqui é o melhor de todas as engines até agora.
 *
 * Um PDF tem páginas, e página é uma unidade natural de trabalho: a engine sabe quantas são
 * ANTES de começar e conta uma a uma. Então a barra não depende de peso medido nem de estimativa
 * — ela é literalmente "página 7 de 24". É o primeiro caso no projeto em que o progresso é exato,
 * e não uma aproximação bem calibrada.
 */

const ID = 'pdf';

/** Para onde uma página de PDF pode ir. `txt` sai da extração de texto, não da rasterização. */
const SAIDAS_DE_PDF = ['png', 'jpg', 'webp', 'avif', 'tiff', 'txt'] as const;

/**
 * O que pode virar uma página de PDF.
 *
 * É a lista de entrada da engine de imagem, porque é o sharp que decodifica antes de embutir —
 * inclusive SVG, que ele rasteriza. A detecção confere cada uma com o libvips desta instalação.
 */
const ENTRADAS_PARA_PDF = ['png', 'jpg', 'webp', 'avif', 'gif', 'tiff', 'heic', 'svg'] as const;

/** DPI padrão da rasterização. Ver `OpcoesPdf.dpi`. */
const DPI_PADRAO = 150;

/** Teto de DPI: 600. Acima disso uma A4 passa de 35 milhões de pixels e o ganho é imperceptível. */
const DPI_MAXIMO = 600;

/**
 * DPI assumida para uma imagem que não declara a sua, ao montar PDF.
 *
 * 96, que é a densidade de tela, e não 72. Com 72 uma captura de 1920 px viraria uma página de
 * 68 cm de largura; com 96 ela dá 50 cm, que ainda é grande mas é o tamanho que a imagem de fato
 * tem em tela. A densidade declarada no arquivo tem precedência sobre este padrão.
 */
const DPI_ASSUMIDA_DA_IMAGEM = 96;

/**
 * Teto de bytes acumulados ao rasterizar várias páginas. Padrão: 384 MB.
 *
 * A rasterização guarda as páginas prontas na memória até fechar o pacote, porque o escritor de
 * ZIP precisa dos bytes de cada arquivo para calcular o CRC. Um PDF de duzentas páginas cheias de
 * imagem a 300 DPI passa fácil de um gigabyte assim, e o processo morreria sem dizer por quê.
 *
 * Este teto troca a morte por uma mensagem que diz o que fazer. Ele NÃO é a solução definitiva: a
 * solução é um escritor de ZIP que grave em fluxo e calcule o CRC pelo caminho, e aí o limite
 * deixa de existir. Até lá, recusar com explicação é melhor que travar a máquina do usuário.
 *
 * `CONVERSOR_TETO_PAGINAS_MB` levanta o teto em quem tem memória de sobra — e é também o que
 * permite o teste do caminho de recusa existir, com um teto de poucos kB e um PDF minúsculo. Sem
 * esse ajuste, testar a recusa exigiria alocar de fato centenas de megabytes, o que é um teste
 * lento e mal-educado com quem roda a CI.
 *
 * A leitura é feita A CADA CHAMADA, e não uma vez na carga do módulo: assim o valor pode mudar
 * entre trabalhos, e o teste não depende da ordem em que os módulos foram importados.
 */
const TETO_PADRAO_MB = 384;

function tetoAcumulado(): number {
  const bruto = Number(process.env.CONVERSOR_TETO_PAGINAS_MB);
  const mb = Number.isFinite(bruto) && bruto > 0 ? bruto : TETO_PADRAO_MB;
  return Math.round(mb * 1000 * 1000);
}

/**
 * A biblioteca do pdfium, carregada uma vez e reaproveitada.
 *
 * Inicializar o módulo WebAssembly custa dezenas de milissegundos e algum megabyte de memória.
 * Fazer isso por conversão apareceria no tempo de cada trabalho, e com quatro conversões em
 * paralelo seriam quatro cópias do mesmo módulo.
 */
let bibliotecaPromessa: Promise<PDFiumLibrary> | undefined;

function biblioteca(): Promise<PDFiumLibrary> {
  bibliotecaPromessa ??= PDFiumLibrary.init();
  return bibliotecaPromessa;
}

interface DetalhePdf extends Record<string, unknown> {
  paraPdf: string[];
  dePdf: string[];
}

export const enginePdf: Engine = {
  id: ID,
  nome: 'pdfium',
  descricao:
    'Rasteriza página de PDF em imagem, e monta PDF a partir de imagem. É o mecanismo de PDF ' +
    'do Chrome, compilado em WebAssembly — então lê o que o Chrome lê, e vem pelo npm install.',

  async detecta(): Promise<Deteccao> {
    try {
      // Carregar o módulo é a única detecção que faz sentido: ou o WebAssembly inicializa, ou
      // não há engine. Não há versão de sistema para conferir nem codec opcional para sondar.
      await biblioteca();

      // O que pode virar PDF depende do LIBVIPS, não do pdfium: é o sharp que decodifica a
      // imagem antes de ela ser embutida. Perguntar a ele evita oferecer `bmp → pdf` numa
      // instalação que não lê BMP — que é justamente o caso desta aqui.
      const fmt = sharp.format;
      const paraPdf = ENTRADAS_PARA_PDF.filter((e) => {
        const vips = NOME_VIPS[e];
        return !!vips && fmt[vips as keyof typeof fmt]?.input?.buffer === true;
      });

      const detalhe: DetalhePdf = { paraPdf: [...paraPdf], dePdf: [...SAIDAS_DE_PDF] };
      return { disponivel: true, versao: 'pdfium (wasm) via @hyzyla/pdfium', detalhe };
    } catch (e) {
      return {
        disponivel: false,
        ausencia: {
          tipo: 'nao-instalada',
          comoInstalar:
            'O módulo WebAssembly do pdfium não carregou. Rode `npm install` na raiz do ' +
            `projeto. (${(e as Error).message})`,
        },
      };
    }
  },

  arestas(deteccao: Deteccao): readonly Aresta[] {
    if (!deteccao.disponivel) {
      const todas: Aresta[] = [];
      for (const para of SAIDAS_DE_PDF) {
        todas.push({ de: 'pdf', para, engine: ID, disponivel: false, ausencia: deteccao.ausencia });
      }
      for (const de of ENTRADAS_PARA_PDF) {
        todas.push({ de, para: 'pdf', engine: ID, disponivel: false, ausencia: deteccao.ausencia });
      }
      return todas;
    }

    const { paraPdf } = deteccao.detalhe as unknown as DetalhePdf;
    const arestas: Aresta[] = [];
    for (const para of SAIDAS_DE_PDF) {
      arestas.push({ de: 'pdf', para, engine: ID, disponivel: true });
    }
    for (const de of ENTRADAS_PARA_PDF) {
      if (paraPdf.includes(de)) {
        arestas.push({ de, para: 'pdf', engine: ID, disponivel: true });
        continue;
      }
      arestas.push({
        de,
        para: 'pdf',
        engine: ID,
        disponivel: false,
        ausencia: {
          tipo: 'sem-suporte',
          detalhe:
            `Este libvips não lê ${de.toUpperCase()}, e é ele que decodifica a imagem antes de ` +
            'ela ser embutida no PDF.',
        },
      });
    }
    return arestas;
  },

  async converte(tarefa: Tarefa, relata: Relator): Promise<ResultadoEngine> {
    if (tarefa.de === 'pdf' && tarefa.para === 'txt') return extraiTexto(tarefa, relata);
    if (tarefa.de === 'pdf') return rasteriza(tarefa, relata);
    return montaDeImagem(tarefa, relata);
  },
};

const NOME_VIPS: Readonly<Record<string, string>> = {
  png: 'png',
  jpg: 'jpeg',
  webp: 'webp',
  avif: 'heif',
  heic: 'heif',
  gif: 'gif',
  tiff: 'tiff',
  svg: 'svg',
};

/* ==================== PDF para imagem ==================== */

/**
 * Rasteriza as páginas escolhidas.
 *
 * Uma página resultante sai como a imagem pedida. Mais de uma sai como `.zip`, com uma imagem por
 * página — não há como caber duas páginas num PNG, e pegar a primeira em silêncio seria perder o
 * resto sem avisar. O Convertio faz o mesmo, e é a única resposta sensata; a diferença é que aqui
 * a interface diz que vai acontecer.
 */
async function rasteriza(tarefa: Tarefa, relata: Relator): Promise<ResultadoEngine> {
  const opc = tarefa.opcoes as Opcoes;
  const destino = formatoDe(tarefa.para);
  if (!destino) throw new ErroDeEntrada('destino-desconhecido', `Destino desconhecido: ${tarefa.para}.`);

  const dpi = Math.min(DPI_MAXIMO, Math.max(1, Math.round(opc.dpi ?? DPI_PADRAO)));
  const doc = await abre(tarefa);

  try {
    const total = doc.getPageCount();
    const escolhidas = escolhePaginas(opc.paginas, total);
    if (escolhidas.length === 0) {
      throw new ErroDeEntrada(
        'pagina-fora-de-faixa',
        `Este PDF tem ${total} página(s), e a seleção "${opc.paginas}" não alcança nenhuma delas.`,
      );
    }

    const etapas: Etapa[] = [
      { id: 'abrir', rotulo: 'Abrindo o PDF', peso: 1 },
      {
        id: 'paginas',
        rotulo:
          escolhidas.length === 1
            ? 'Rasterizando a página'
            : `Rasterizando ${escolhidas.length} páginas`,
        // O peso é a contagem de páginas: aqui o progresso é exato, não estimado. Cada página
        // rasterizada é um passo de tamanho conhecido.
        peso: Math.max(1, escolhidas.length * 10),
      },
      { id: 'gravar', rotulo: 'Gravando', peso: 1 },
    ];
    relata.etapas(etapas);
    relata.andou('abrir', 1, `${total} página(s)`);

    const saidas: ArquivoDoZip[] = [];
    const base = semExtensao(tarefa.nomeSaida ?? tarefa.nomeOriginal);
    const casas = String(total).length;
    const teto = tetoAcumulado();
    let acumulado = 0;

    for (const [posicao, indice] of escolhidas.entries()) {
      tarefa.sinal.throwIfAborted();
      relata.andou('paginas', posicao / escolhidas.length, `página ${indice + 1} de ${total}`);

      // `doc.getPage(i)` de novo a cada uso, e isto não é descuido: o objeto de página do pdfium
      // é INVALIDADO depois de um `render()`. Reaproveitá-lo derruba o WebAssembly com "table
      // index is out of bounds", e o erro não menciona página nenhuma.
      const bitmap = await doc.getPage(indice).render({ scale: dpi / 72, render: 'bitmap' });

      let img = sharp(Buffer.from(bitmap.data), {
        raw: { width: bitmap.width, height: bitmap.height, channels: 4 },
      });

      // Achatar contra branco quando o destino não guarda alfa. Página de PDF costuma ter fundo
      // transparente onde não há nada desenhado, e compor contra preto — que é o padrão do
      // libvips — devolveria uma página preta com texto invisível.
      if (destino.temAlfa !== true) img = img.flatten({ background: opc.fundo ?? '#FFFFFF' });
      if (opc.largura || opc.altura) {
        img = img.resize({
          ...(opc.largura ? { width: Math.round(opc.largura) } : {}),
          ...(opc.altura ? { height: Math.round(opc.altura) } : {}),
          fit: 'inside',
        });
      }

      const bytes = await codifica(img, tarefa.para, opc);
      acumulado += bytes.length;
      if (acumulado > teto) {
        // Recusar com explicação, e não morrer de falta de memória. Ver `tetoAcumulado`.
        const feitas = posicao + 1;
        throw new ErroDeEntrada(
          'saida-grande-demais',
          `As páginas rasterizadas passaram de ${(teto / 1e6).toFixed(0)} MB em ${feitas} de ` +
            `${escolhidas.length} páginas. Baixe a resolução em Opções (está em ${dpi} DPI), ` +
            'escolha menos páginas, ou converta para JPEG, que ocupa bem menos.',
          `acumulado ${acumulado} bytes em ${feitas} páginas de ${bitmap.width}x${bitmap.height}`,
        );
      }
      saidas.push({
        nome: `${base}-p${String(indice + 1).padStart(casas, '0')}.${destino.ext}`,
        dados: vista(bytes),
        data: new Date(),
      });
    }
    relata.andou('paginas', 1);
    tarefa.sinal.throwIfAborted();

    relata.andou('gravar', 0);
    const uma = saidas.length === 1 ? saidas[0] : undefined;
    if (uma) {
      await writeFile(tarefa.saida, uma.dados);
    } else {
      const nomes = nomesUnicos(saidas.map((s) => s.nome));
      const partes = montaZipPartes(saidas.map((s, i) => ({ ...s, nome: nomes[i]! })));
      // `gravaPartes`, e não `Buffer.concat`: concatenar custa uma cópia do pacote inteiro, e o
      // escritor de ZIP devolve partes justamente para essa cópia não existir.
      await gravaPartes(tarefa.saida, partes);
      relata.avisa(
        `${saidas.length} páginas não cabem num ${destino.nome}, então a saída é um .zip com ` +
          'uma imagem por página. Em Opções dá para escolher uma página só.',
      );
    }
    relata.andou('gravar', 1);

    return {
      // Quando virou pacote, o nome e o tipo mudam junto — senão o download sairia batizado
      // `.png` com um ZIP dentro. Ver `ResultadoEngine.nomeSaida`.
      ...(uma ? {} : { nomeSaida: `${base}-paginas.zip`, mimeSaida: 'application/zip' }),
      diagnostico: {
        paginasNoArquivo: total,
        paginasConvertidas: saidas.length,
        dpi,
        empacotadoEmZip: saidas.length > 1,
        primeiraPagina: saidas[0]?.nome,
      },
    };
  } finally {
    doc.destroy();
  }
}

/* ==================== PDF para texto ==================== */

/**
 * Extrai o texto das páginas.
 *
 * Vale dizer o que isto NÃO é: reconhecimento de caracteres. Ele lê o texto que o PDF já carrega
 * como texto. Num PDF que é digitalização — uma foto de papel — não há texto para ler, e a saída
 * sai vazia. É a resposta correta, e a mensagem diz isso em vez de deixar a pessoa achar que o
 * arquivo dela quebrou. Ler pixel é trabalho do Tesseract, que está declarado para depois.
 */
async function extraiTexto(tarefa: Tarefa, relata: Relator): Promise<ResultadoEngine> {
  const opc = tarefa.opcoes as Opcoes;
  const doc = await abre(tarefa);

  try {
    const total = doc.getPageCount();
    const escolhidas = escolhePaginas(opc.paginas, total);

    relata.etapas([
      { id: 'abrir', rotulo: 'Abrindo o PDF', peso: 1 },
      { id: 'paginas', rotulo: 'Lendo o texto', peso: Math.max(1, escolhidas.length * 10) },
      { id: 'gravar', rotulo: 'Gravando', peso: 1 },
    ]);
    relata.andou('abrir', 1, `${total} página(s)`);

    const pedacos: string[] = [];
    let comTexto = 0;
    for (const [posicao, indice] of escolhidas.entries()) {
      tarefa.sinal.throwIfAborted();
      relata.andou('paginas', posicao / escolhidas.length, `página ${indice + 1} de ${total}`);
      const texto = doc.getPage(indice).getText().trim();
      if (texto) comTexto++;
      // A separação por página fica explícita: um texto corrido de trinta páginas sem marca
      // nenhuma é pior de usar que o PDF original.
      pedacos.push(`--- página ${indice + 1} ---\n${texto || '(sem texto)'}`);
    }
    relata.andou('paginas', 1);

    relata.andou('gravar', 0);
    // BOM no começo: sem ele, o Bloco de Notas do Windows lê o arquivo na página de código do
    // sistema e todo acento sai trocado.
    await writeFile(tarefa.saida, `﻿${pedacos.join('\n\n')}\n`, 'utf-8');
    relata.andou('gravar', 1);

    if (comTexto === 0) {
      relata.avisa(
        'Nenhuma página deste PDF carrega texto — provavelmente é uma digitalização, ou seja, ' +
          'imagem de papel. Ler texto de imagem é reconhecimento de caracteres, e isso chega no ' +
          'marco 5 com o Tesseract.',
      );
    } else if (comTexto < escolhidas.length) {
      relata.avisa(
        `${escolhidas.length - comTexto} de ${escolhidas.length} páginas não carregam texto e ` +
          'saíram marcadas como "(sem texto)".',
      );
    }

    return {
      diagnostico: {
        paginasNoArquivo: total,
        paginasLidas: escolhidas.length,
        paginasComTexto: comTexto,
      },
    };
  } finally {
    doc.destroy();
  }
}

/* ==================== imagem para PDF ==================== */

/**
 * Monta um PDF de uma página a partir de uma imagem.
 *
 * A decisão que importa está em `pdfSemPerda`: origem sem perda entra sem perda, origem com perda
 * entra como JPEG. E quando a origem JÁ É um JPEG que não precisa de transformação nenhuma, os
 * bytes dele passam DIRETO para dentro do PDF, sem decodificar — a foto dentro do PDF é
 * exatamente a que entrou, e o trabalho é copiar bytes.
 */
async function montaDeImagem(tarefa: Tarefa, relata: Relator): Promise<ResultadoEngine> {
  const opc = tarefa.opcoes as Opcoes;
  const origem = formatoDe(tarefa.de);

  relata.etapas([
    { id: 'ler', rotulo: 'Lendo a imagem', peso: 1 },
    { id: 'preparar', rotulo: 'Preparando para o PDF', peso: 6 },
    { id: 'montar', rotulo: 'Montando o PDF', peso: 2 },
    { id: 'gravar', rotulo: 'Gravando', peso: 1 },
  ]);
  relata.andou('ler', 0);

  const bytes = await readFile(tarefa.entrada);
  let img = sharp(bytes, { limitInputPixels: false });
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
  relata.andou('ler', 1, `${meta.width} × ${meta.height}`);
  tarefa.sinal.throwIfAborted();

  relata.andou('preparar', 0);
  const semPerda = opc.pdfSemPerda ?? origem?.comPerda !== true;

  /*
   * Girar só é necessário quando o arquivo DECLARA orientação diferente de 1.
   *
   * A primeira versão disto testava `opc.girarPeloExif !== false`, e essa comparação é verdadeira
   * quando a opção vem `undefined` — que é o padrão. Resultado: `precisaTransformar` era sempre
   * verdadeiro, todo JPEG era recodificado, e a passagem direta de bytes logo abaixo — a razão de
   * este escritor existir em vez de uma biblioteca — era código morto. O teste que afirma "byte a
   * byte" é o que pegou.
   *
   * Sem EXIF de orientação, `.rotate()` seria uma operação nula, então não custa nada saltá-la.
   */
  const precisaGirar = opc.girarPeloExif !== false && (meta.orientation ?? 1) > 1;
  // O canal alfa derruba o caminho rápido mesmo quando nada é transparente: o PDF não guarda
  // alfa, então o canal tem de sair de qualquer jeito, e isso exige recodificar.
  const precisaTransformar =
    precisaGirar || !!opc.largura || !!opc.altura || meta.hasAlpha === true;
  const vazado = await temTransparencia(bytes, meta);

  /*
   * O caminho rápido: JPEG que entra e sai igual.
   *
   * Um JPEG sem transformação pedida e sem alfa vai direto para o PDF com `/DCTDecode`. Nada é
   * decodificado, nada é recomprimido, e o tempo é o de copiar bytes. Uma foto de 12 MP pelo
   * caminho comum viraria 36 MB de pixel cru na memória e sairia recomprimida — mais lenta,
   * maior e com uma geração de perda a mais.
   */
  let paraPdf: ImagemParaPdf;
  let passouDireto = false;

  if (meta.format === 'jpeg' && !precisaTransformar) {
    paraPdf = {
      dados: new Uint8Array(bytes),
      largura: meta.width,
      altura: meta.height,
      tipo: 'jpeg',
      dpi: densidade(meta),
    };
    passouDireto = true;
  } else {
    if (precisaGirar) img = img.rotate();
    if (opc.largura || opc.altura) {
      img = img.resize({
        ...(opc.largura ? { width: Math.round(opc.largura) } : {}),
        ...(opc.altura ? { height: Math.round(opc.altura) } : {}),
        fit: 'inside',
        withoutEnlargement: opc.semAmpliar !== false,
      });
    }
    // PDF não tem transparência de página: o que era vazado é composto contra uma cor. Sem
    // achatar explicitamente, o libvips compõe contra preto e um logo preto vira um retângulo.
    const fundo = opc.fundo ?? '#FFFFFF';
    if (meta.hasAlpha === true) {
      img = img.flatten({ background: fundo });
      // O aviso sai só quando há pixel transparente DE VERDADE. Ver `temTransparencia`.
      if (vazado) {
        relata.avisa(
          `PDF não guarda transparência. O que era transparente ficou ${fundo}; troque em ` +
            'Opções se quiser outra cor.',
        );
      }
    }

    if (semPerda) {
      const cru = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
      paraPdf = {
        dados: new Uint8Array(cru.data),
        largura: cru.info.width,
        altura: cru.info.height,
        tipo: 'rgb',
        dpi: densidade(meta),
      };
    } else {
      const jpeg = await img
        .jpeg({ quality: opc.qualidade ?? 82, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
      paraPdf = {
        dados: new Uint8Array(jpeg.data),
        largura: jpeg.info.width,
        altura: jpeg.info.height,
        tipo: 'jpeg',
        dpi: densidade(meta),
      };
    }
  }
  relata.andou('preparar', 1);
  tarefa.sinal.throwIfAborted();

  relata.andou('montar', 0);
  const pagina: TamanhoPagina = opc.pdfPagina ?? 'imagem';
  const partes = montaPdf([paraPdf], {
    pagina,
    margem: mmParaPontos(opc.pdfMargem ?? 10),
    produtor: 'Conversor (local)',
  });
  relata.andou('montar', 1);

  relata.andou('gravar', 0);
  await gravaPartes(tarefa.saida, partes);
  relata.andou('gravar', 1);

  if (semPerda && !passouDireto && paraPdf.dados.length > 20_000_000) {
    relata.avisa(
      'A imagem foi embutida sem perda, e por isso o PDF ficou grande. Em Opções, desmarcar ' +
        '"embutir sem perda" usa JPEG e reduz muito o arquivo.',
    );
  }

  return {
    diagnostico: {
      entrada: { largura: meta.width, altura: meta.height, formato: meta.format },
      embutidoComo:
        paraPdf.tipo === 'jpeg'
          ? passouDireto
            ? 'JPEG original, byte a byte'
            : 'JPEG recodificado'
          : 'RGB sem perda (Flate)',
      pagina,
      dpiDaImagem: paraPdf.dpi,
      bytesDaImagemNoPdf: paraPdf.dados.length,
    },
  };
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

/**
 * A densidade da imagem, para o tamanho da página.
 *
 * O sharp devolve 72 quando o arquivo não declara nada — é o padrão do formato, não uma medição.
 * Aceitar esse 72 faria uma captura de tela de 1920 px virar uma página de 68 cm de largura.
 * Então 72 é tratado como "não sei", e o padrão de tela entra no lugar.
 */
function densidade(meta: sharp.Metadata): number {
  const d = meta.density;
  if (!d || d <= 72) return DPI_ASSUMIDA_DA_IMAGEM;
  return Math.min(1200, Math.round(d));
}

/* ==================== apoio ==================== */

async function abre(tarefa: Tarefa): Promise<PDFiumDocument> {
  const lib = await biblioteca();
  const bytes = await readFile(tarefa.entrada);
  try {
    return await lib.loadDocument(bytes);
  } catch (e) {
    const msg = (e as Error).message ?? '';
    throw new ErroDeEntrada(
      'pdf-ilegivel',
      /password|senha/i.test(msg)
        ? 'Este PDF está protegido por senha. Remova a proteção e tente de novo.'
        : 'Não deu para abrir este PDF. O arquivo pode estar truncado ou não ser um PDF.',
      msg,
    );
  }
}

/**
 * Resolve a seleção de páginas para índices que começam em zero.
 *
 * Aceita `todas` (o padrão), `3`, `2-5`, e listas como `1,4,7-9`. Fora de faixa é DESCARTADO em
 * silêncio, e não é erro: quem escreve `1-999` num PDF de dez páginas está pedindo "até o fim",
 * e recusar seria pedantismo. Uma seleção que não alcança nenhuma página é outra história, e
 * quem chama trata.
 */
export function escolhePaginas(selecao: string | undefined, total: number): number[] {
  const texto = (selecao ?? 'todas').trim().toLowerCase();
  if (!texto || texto === 'todas' || texto === 'tudo' || texto === '*') {
    return Array.from({ length: total }, (_, i) => i);
  }

  const escolhidas = new Set<number>();
  for (const parte of texto.split(',')) {
    const faixa = /^\s*(\d+)\s*(?:[-–]\s*(\d+)\s*)?$/.exec(parte);
    if (!faixa) continue;
    const de = Number(faixa[1]);
    const ate = faixa[2] === undefined ? de : Number(faixa[2]);
    // Uma faixa invertida (`5-2`) é lida como o intervalo que a pessoa quis dizer, e não
    // descartada: é erro de digitação com intenção óbvia.
    for (let n = Math.min(de, ate); n <= Math.max(de, ate); n++) {
      if (n >= 1 && n <= total) escolhidas.add(n - 1);
    }
  }
  return [...escolhidas].sort((a, b) => a - b);
}

/** Codifica o bitmap da página no formato pedido, com os mesmos padrões da engine de imagem. */
function codifica(img: sharp.Sharp, para: string, opc: Opcoes): Promise<Buffer> {
  const q = opc.qualidade ?? 82;
  switch (para) {
    case 'jpg':
      return img.jpeg({ quality: q, mozjpeg: true }).toBuffer();
    case 'webp':
      return img.webp({ quality: q, effort: 4 }).toBuffer();
    case 'avif':
      return img.avif({ quality: q, effort: 4 }).toBuffer();
    case 'tiff':
      return img.tiff({ compression: 'lzw' }).toBuffer();
    case 'png':
    default:
      /*
       * `palette` DESLIGADA por padrão aqui, ao contrário da engine de imagem.
       *
       * Uma página de PDF é texto e linha, e indexar cor mastiga a borda do antisserrilhado da
       * fonte. O custo medido da paleta também é alto justamente em imagem com muito detalhe
       * fino, que é o caso de uma página de texto.
       *
       * Esta divergência é proposital, e o painel de opções da interface tem de refletir ela —
       * ver `paletaLigadaPorPadrao` em `PainelDeOpcoes.tsx`. A caixa aparecia marcada nos dois
       * casos, então quem rasterizava um PDF lia "ligado" na tela e recebia desligado no arquivo.
       */
      return img.png({ compressionLevel: 9, palette: opc.paletaIndexada === true }).toBuffer();
  }
}

/**
 * Vista de bytes sobre um Buffer, sem copiar.
 *
 * O `Buffer` do Node se digita como `Buffer<ArrayBufferLike>`, e `ArrayBufferLike` inclui
 * `SharedArrayBuffer` — que o escritor de ZIP não aceita, de propósito. Esta vista fixa o tipo
 * sem mover byte nenhum; uma página A4 a 150 DPI em PNG passa de 1 MB, e copiar cada uma para
 * satisfazer o compilador seria desperdício por nada.
 */
const vista = (b: Uint8Array): Uint8Array<ArrayBuffer> =>
  new Uint8Array(b.buffer as ArrayBuffer, b.byteOffset, b.byteLength);

const semExtensao = (nome: string): string => {
  const base = basename(nome);
  const ext = extname(base);
  return ext ? base.slice(0, -ext.length) : base;
};
