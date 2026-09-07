import type { Familia, Formato } from './tipos.js';

/**
 * O catálogo de formatos.
 *
 * Uma decisão que vale explicar: o catálogo lista as dez famílias INTEIRAS, inclusive formatos
 * que nenhuma engine converte ainda. Isso é de propósito. O grafo de conversões (as arestas)
 * é que diz o que dá para fazer agora; o catálogo diz o que o formato É. Assim o seletor mostra
 * o destino desabilitado com o motivo à mostra — "precisa do LibreOffice", "chega no marco 3" —
 * em vez de deixar o usuário procurando um destino que não aparece em lugar nenhum.
 *
 * `mime` segue a IANA onde existe registro, e o de uso corrente onde não existe.
 */
export const FORMATOS: readonly Formato[] = [
  /* ---------- imagem ---------- */
  {
    ext: 'png',
    nome: 'PNG',
    familia: 'imagem',
    mime: 'image/png',
    descricao: 'Sem perda, com transparência. O padrão para captura de tela e arte com fundo vazado.',
    temAlfa: true,
  },
  {
    ext: 'jpg',
    nome: 'JPEG',
    familia: 'imagem',
    mime: 'image/jpeg',
    descricao: 'Com perda, sem transparência. Onde toda foto acaba parando.',
    apelidos: ['jpeg', 'jpe', 'jfif'],
    comPerda: true,
  },
  {
    ext: 'webp',
    nome: 'WebP',
    familia: 'imagem',
    mime: 'image/webp',
    descricao: 'Com ou sem perda, com transparência e animação. Menor que PNG e que JPEG.',
    comPerda: true,
    temAlfa: true,
    animado: true,
  },
  {
    ext: 'avif',
    nome: 'AVIF',
    familia: 'imagem',
    mime: 'image/avif',
    descricao: 'O mais econômico dos formatos de hoje. Comprime melhor que WebP, codifica mais devagar.',
    comPerda: true,
    temAlfa: true,
    animado: true,
  },
  {
    ext: 'gif',
    nome: 'GIF',
    familia: 'imagem',
    mime: 'image/gif',
    descricao: '256 cores e animação. Sobrevive por inércia, mas sobrevive.',
    temAlfa: true,
    animado: true,
  },
  {
    ext: 'tiff',
    nome: 'TIFF',
    familia: 'imagem',
    mime: 'image/tiff',
    descricao: 'Sem perda, alta profundidade de bits. O formato da digitalização e da gráfica.',
    apelidos: ['tif'],
    temAlfa: true,
  },
  {
    ext: 'bmp',
    nome: 'BMP',
    familia: 'imagem',
    mime: 'image/bmp',
    descricao: 'Pixels crus, sem compressão. Grande, simples e universal no Windows.',
  },
  {
    ext: 'heic',
    nome: 'HEIC',
    familia: 'imagem',
    mime: 'image/heic',
    descricao: 'O que o iPhone produz. Comprime muito bem e quase nada fora da Apple abre.',
    apelidos: ['heif'],
    comPerda: true,
    temAlfa: true,
  },
  {
    ext: 'ico',
    nome: 'ICO',
    familia: 'imagem',
    mime: 'image/x-icon',
    descricao: 'Ícone do Windows e favicon. Guarda vários tamanhos no mesmo arquivo.',
    temAlfa: true,
  },
  {
    ext: 'jp2',
    nome: 'JPEG 2000',
    familia: 'imagem',
    mime: 'image/jp2',
    descricao: 'Com ou sem perda, por ondaletas. Vive em acervo digital e imagem médica.',
    comPerda: true,
    temAlfa: true,
  },
  {
    ext: 'jxl',
    nome: 'JPEG XL',
    familia: 'imagem',
    mime: 'image/jxl',
    descricao: 'O sucessor do JPEG: recomprime JPEG sem perder nada. Suporte ainda irregular.',
    comPerda: true,
    temAlfa: true,
    animado: true,
  },
  {
    ext: 'ppm',
    nome: 'PPM',
    familia: 'imagem',
    mime: 'image/x-portable-pixmap',
    descricao: 'Texto puro com os pixels em sequência. Formato de tubulação entre ferramentas.',
    apelidos: ['pgm', 'pbm', 'pnm'],
  },
  {
    ext: 'dds',
    nome: 'DDS',
    familia: 'imagem',
    mime: 'image/vnd-ms.dds',
    descricao: 'Textura comprimida para placa de vídeo. Formato de jogo.',
    temAlfa: true,
  },
  {
    ext: 'exr',
    nome: 'OpenEXR',
    familia: 'imagem',
    mime: 'image/x-exr',
    descricao: 'Alto alcance dinâmico em ponto flutuante. O padrão de efeitos visuais.',
    temAlfa: true,
  },
  {
    ext: 'raw',
    nome: 'RAW',
    familia: 'imagem',
    mime: 'image/x-dcraw',
    descricao: 'O sensor da câmera sem revelação. Cada fabricante tem o seu dialeto.',
    apelidos: ['cr2', 'cr3', 'nef', 'arw', 'dng', 'orf', 'raf', 'rw2'],
  },

  /* ---------- vetor ---------- */
  {
    ext: 'svg',
    nome: 'SVG',
    familia: 'vetor',
    mime: 'image/svg+xml',
    descricao: 'Vetor em XML, nativo do navegador. Escala sem perder nitidez e dá para editar no texto.',
    temAlfa: true,
    animado: true,
  },
  {
    ext: 'pdf',
    nome: 'PDF',
    familia: 'vetor',
    mime: 'application/pdf',
    descricao: 'Página com posição fixa. Vetor, raster e texto no mesmo arquivo.',
  },
  {
    ext: 'eps',
    nome: 'EPS',
    familia: 'vetor',
    mime: 'application/postscript',
    descricao: 'PostScript encapsulado. O jeito antigo de entregar vetor para a gráfica.',
  },
  {
    ext: 'ai',
    nome: 'Adobe Illustrator',
    familia: 'vetor',
    mime: 'application/illustrator',
    descricao: 'O nativo do Illustrator. Por dentro é PDF com dados privados da Adobe.',
  },
  {
    ext: 'emf',
    nome: 'EMF',
    familia: 'vetor',
    mime: 'image/x-emf',
    descricao: 'Metarquivo vetorial do Windows. Sai de Office e de Visio.',
    apelidos: ['wmf'],
  },
  {
    ext: 'cdr',
    nome: 'CorelDRAW',
    familia: 'vetor',
    mime: 'application/vnd.corel-draw',
    descricao: 'O nativo do CorelDRAW. Formato fechado, leitura por engenharia reversa.',
  },

  /* ---------- documento ---------- */
  {
    ext: 'docx',
    nome: 'DOCX',
    familia: 'documento',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    descricao: 'O Word de hoje. Um ZIP com XML dentro.',
  },
  {
    ext: 'doc',
    nome: 'DOC',
    familia: 'documento',
    mime: 'application/msword',
    descricao: 'O Word até 2003. Binário, e ainda aparece em arquivo antigo.',
  },
  {
    ext: 'odt',
    nome: 'ODT',
    familia: 'documento',
    mime: 'application/vnd.oasis.opendocument.text',
    descricao: 'Texto do OpenDocument. O nativo do LibreOffice Writer.',
  },
  {
    ext: 'rtf',
    nome: 'RTF',
    familia: 'documento',
    mime: 'application/rtf',
    descricao: 'Texto com formatação em marcação legível. Abre em qualquer editor.',
  },
  {
    ext: 'txt',
    nome: 'TXT',
    familia: 'documento',
    mime: 'text/plain',
    descricao: 'Texto puro, sem formatação. O menor denominador comum.',
  },
  {
    ext: 'md',
    nome: 'Markdown',
    familia: 'documento',
    mime: 'text/markdown',
    descricao: 'Texto com marcação leve. Legível antes e depois de renderizar.',
    apelidos: ['markdown'],
  },
  {
    ext: 'html',
    nome: 'HTML',
    familia: 'documento',
    mime: 'text/html',
    descricao: 'Página web. Estrutura e estilo, sem paginação.',
    apelidos: ['htm'],
  },
  {
    ext: 'xlsx',
    nome: 'XLSX',
    familia: 'documento',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    descricao: 'A planilha do Excel de hoje.',
  },
  {
    ext: 'xls',
    nome: 'XLS',
    familia: 'documento',
    mime: 'application/vnd.ms-excel',
    descricao: 'A planilha do Excel até 2003.',
  },
  {
    ext: 'ods',
    nome: 'ODS',
    familia: 'documento',
    mime: 'application/vnd.oasis.opendocument.spreadsheet',
    descricao: 'Planilha do OpenDocument. O nativo do LibreOffice Calc.',
  },
  {
    ext: 'csv',
    nome: 'CSV',
    familia: 'documento',
    mime: 'text/csv',
    descricao: 'Tabela em texto separado por vírgula. Sem tipo, sem fórmula, sem estilo.',
  },
  {
    ext: 'tex',
    nome: 'LaTeX',
    familia: 'documento',
    mime: 'application/x-tex',
    descricao: 'Marcação de composição tipográfica. O padrão do texto acadêmico.',
  },
  {
    ext: 'djvu',
    nome: 'DjVu',
    familia: 'documento',
    mime: 'image/vnd.djvu',
    descricao: 'Documento digitalizado bem comprimido. Alternativa ao PDF em acervo.',
  },

  /* ---------- apresentação ---------- */
  {
    ext: 'pptx',
    nome: 'PPTX',
    familia: 'apresentacao',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    descricao: 'O PowerPoint de hoje.',
  },
  {
    ext: 'ppt',
    nome: 'PPT',
    familia: 'apresentacao',
    mime: 'application/vnd.ms-powerpoint',
    descricao: 'O PowerPoint até 2003.',
  },
  {
    ext: 'odp',
    nome: 'ODP',
    familia: 'apresentacao',
    mime: 'application/vnd.oasis.opendocument.presentation',
    descricao: 'Apresentação do OpenDocument. O nativo do LibreOffice Impress.',
  },
  {
    ext: 'key',
    nome: 'Keynote',
    familia: 'apresentacao',
    mime: 'application/vnd.apple.keynote',
    descricao: 'O nativo do Keynote da Apple.',
  },

  /* ---------- ebook ---------- */
  {
    ext: 'epub',
    nome: 'EPUB',
    familia: 'ebook',
    mime: 'application/epub+zip',
    descricao: 'Livro digital com texto que reflui. O padrão aberto do setor.',
  },
  {
    ext: 'mobi',
    nome: 'MOBI',
    familia: 'ebook',
    mime: 'application/x-mobipocket-ebook',
    descricao: 'O Kindle antigo. Descontinuado, ainda muito presente em acervo.',
  },
  {
    ext: 'azw3',
    nome: 'AZW3',
    familia: 'ebook',
    mime: 'application/vnd.amazon.ebook',
    descricao: 'O Kindle de hoje, também chamado KF8.',
  },
  {
    ext: 'fb2',
    nome: 'FB2',
    familia: 'ebook',
    mime: 'application/x-fictionbook+xml',
    descricao: 'FictionBook, em XML. Comum no acervo de língua russa.',
  },
  {
    ext: 'lrf',
    nome: 'LRF',
    familia: 'ebook',
    mime: 'application/x-sony-bbeb',
    descricao: 'O leitor da Sony. Formato morto, mas conversível.',
  },
  {
    ext: 'pdb',
    nome: 'PDB',
    familia: 'ebook',
    mime: 'application/vnd.palm',
    descricao: 'Banco de dados do Palm. Levava livro em aparelho de bolso.',
  },

  /* ---------- áudio ---------- */
  {
    ext: 'mp3',
    nome: 'MP3',
    familia: 'audio',
    mime: 'audio/mpeg',
    descricao: 'Com perda. Toca em absolutamente qualquer coisa.',
    comPerda: true,
  },
  {
    ext: 'wav',
    nome: 'WAV',
    familia: 'audio',
    mime: 'audio/wav',
    descricao: 'PCM sem compressão. O formato de trabalho em edição de áudio.',
  },
  {
    ext: 'flac',
    nome: 'FLAC',
    familia: 'audio',
    mime: 'audio/flac',
    descricao: 'Sem perda e comprimido. Metade do WAV, bit a bit idêntico.',
  },
  {
    ext: 'aac',
    nome: 'AAC',
    familia: 'audio',
    mime: 'audio/aac',
    descricao: 'Com perda, sucessor do MP3. Melhor som na mesma taxa.',
    comPerda: true,
  },
  {
    ext: 'm4a',
    nome: 'M4A',
    familia: 'audio',
    mime: 'audio/mp4',
    descricao: 'AAC ou ALAC dentro de um contêiner MP4. O que a Apple usa.',
    comPerda: true,
  },
  {
    ext: 'ogg',
    nome: 'OGG',
    familia: 'audio',
    mime: 'audio/ogg',
    descricao: 'Contêiner livre, em geral com Vorbis dentro.',
    comPerda: true,
  },
  {
    ext: 'opus',
    nome: 'Opus',
    familia: 'audio',
    mime: 'audio/opus',
    descricao: 'Com perda, o melhor em taxa baixa. O padrão de voz na web.',
    comPerda: true,
  },
  {
    ext: 'wma',
    nome: 'WMA',
    familia: 'audio',
    mime: 'audio/x-ms-wma',
    descricao: 'O formato de áudio da Microsoft.',
    comPerda: true,
  },
  {
    ext: 'aiff',
    nome: 'AIFF',
    familia: 'audio',
    mime: 'audio/aiff',
    descricao: 'PCM sem compressão, o WAV do lado Apple.',
    apelidos: ['aif'],
  },
  {
    ext: 'amr',
    nome: 'AMR',
    familia: 'audio',
    mime: 'audio/amr',
    descricao: 'Voz em taxa baixíssima. Vem de gravador de celular.',
    comPerda: true,
  },

  /* ---------- vídeo ---------- */
  {
    ext: 'mp4',
    nome: 'MP4',
    familia: 'video',
    mime: 'video/mp4',
    descricao: 'O contêiner que toca em tudo. Em geral H.264 com AAC.',
    comPerda: true,
  },
  {
    ext: 'mkv',
    nome: 'MKV',
    familia: 'video',
    mime: 'video/x-matroska',
    descricao: 'Contêiner livre que aceita qualquer codec, faixa e legenda.',
    comPerda: true,
  },
  {
    ext: 'webm',
    nome: 'WebM',
    familia: 'video',
    mime: 'video/webm',
    descricao: 'Contêiner aberto para a web. VP9 ou AV1 com Opus.',
    comPerda: true,
  },
  {
    ext: 'mov',
    nome: 'MOV',
    familia: 'video',
    mime: 'video/quicktime',
    descricao: 'QuickTime. O que sai de iPhone e de câmera profissional.',
    comPerda: true,
  },
  {
    ext: 'avi',
    nome: 'AVI',
    familia: 'video',
    mime: 'video/x-msvideo',
    descricao: 'Contêiner antigo da Microsoft. Sem os recursos de hoje, mas todo mundo abre.',
    comPerda: true,
  },
  {
    ext: 'wmv',
    nome: 'WMV',
    familia: 'video',
    mime: 'video/x-ms-wmv',
    descricao: 'O formato de vídeo da Microsoft.',
    comPerda: true,
  },
  {
    ext: 'flv',
    nome: 'FLV',
    familia: 'video',
    mime: 'video/x-flv',
    descricao: 'Vídeo do Flash. Morto na web, vivo em arquivo antigo.',
    comPerda: true,
  },
  {
    ext: 'mpeg',
    nome: 'MPEG',
    familia: 'video',
    mime: 'video/mpeg',
    descricao: 'MPEG-1 e MPEG-2. Vem de DVD e de transmissão.',
    apelidos: ['mpg'],
    comPerda: true,
  },
  {
    ext: 'ts',
    nome: 'MPEG-TS',
    familia: 'video',
    mime: 'video/mp2t',
    descricao: 'Fluxo de transporte. Formato de transmissão e de HLS.',
    comPerda: true,
  },
  {
    ext: '3gp',
    nome: '3GP',
    familia: 'video',
    mime: 'video/3gpp',
    descricao: 'Vídeo de celular antigo, feito para rede lenta.',
    comPerda: true,
  },

  /* ---------- arquivo compactado ---------- */
  {
    ext: 'zip',
    nome: 'ZIP',
    familia: 'arquivo',
    mime: 'application/zip',
    descricao: 'O compactado universal. Todo sistema abre sem instalar nada.',
  },
  {
    ext: '7z',
    nome: '7z',
    familia: 'arquivo',
    mime: 'application/x-7z-compressed',
    descricao: 'Comprime bem melhor que ZIP. Precisa de programa próprio.',
  },
  {
    ext: 'tar',
    nome: 'TAR',
    familia: 'arquivo',
    mime: 'application/x-tar',
    descricao: 'Junta arquivos sem comprimir. Quase sempre vem com gzip ou xz.',
  },
  {
    ext: 'gz',
    nome: 'GZIP',
    familia: 'arquivo',
    mime: 'application/gzip',
    descricao: 'Comprime um fluxo só. O par natural do TAR.',
    apelidos: ['tgz'],
  },
  {
    ext: 'bz2',
    nome: 'BZIP2',
    familia: 'arquivo',
    mime: 'application/x-bzip2',
    descricao: 'Comprime mais que gzip e mais devagar.',
  },
  {
    ext: 'xz',
    nome: 'XZ',
    familia: 'arquivo',
    mime: 'application/x-xz',
    descricao: 'LZMA2. Comprime muito, descomprime rápido.',
  },
  {
    ext: 'rar',
    nome: 'RAR',
    familia: 'arquivo',
    mime: 'application/vnd.rar',
    descricao: 'Formato fechado. Descompactar é livre, compactar não.',
  },

  /* ---------- fonte ---------- */
  {
    ext: 'ttf',
    nome: 'TrueType',
    familia: 'fonte',
    mime: 'font/ttf',
    descricao: 'Contorno quadrático. A fonte de sistema mais comum.',
  },
  {
    ext: 'otf',
    nome: 'OpenType',
    familia: 'fonte',
    mime: 'font/otf',
    descricao: 'Contorno cúbico e tipografia avançada. Sucessor do TrueType.',
  },
  {
    ext: 'woff',
    nome: 'WOFF',
    familia: 'fonte',
    mime: 'font/woff',
    descricao: 'Fonte comprimida para a web, primeira geração.',
  },
  {
    ext: 'woff2',
    nome: 'WOFF2',
    familia: 'fonte',
    mime: 'font/woff2',
    descricao: 'Fonte web com Brotli. Cerca de 30% menor que WOFF.',
  },
  {
    ext: 'eot',
    nome: 'EOT',
    familia: 'fonte',
    mime: 'application/vnd.ms-fontobject',
    descricao: 'Fonte web só do Internet Explorer. Existe por compatibilidade.',
  },

  /* ---------- CAD ---------- */
  {
    ext: 'dxf',
    nome: 'DXF',
    familia: 'cad',
    mime: 'image/vnd.dxf',
    descricao: 'Intercâmbio de desenho da Autodesk. O formato aberto que todo CAD lê.',
  },
  {
    ext: 'dwg',
    nome: 'DWG',
    familia: 'cad',
    mime: 'image/vnd.dwg',
    descricao: 'O nativo do AutoCAD. Fechado, mas onipresente na engenharia.',
  },
  {
    ext: 'stl',
    nome: 'STL',
    familia: 'cad',
    mime: 'model/stl',
    descricao: 'Malha de triângulos. O formato da impressão 3D.',
  },
  {
    ext: 'obj',
    nome: 'OBJ',
    familia: 'cad',
    mime: 'model/obj',
    descricao: 'Malha em texto, com material à parte. Aceito em todo lugar em 3D.',
  },
  {
    ext: 'step',
    nome: 'STEP',
    familia: 'cad',
    mime: 'model/step',
    descricao: 'Sólido paramétrico, norma ISO. O intercâmbio sério de engenharia.',
    apelidos: ['stp'],
  },
];

/** Rótulo de cada família, para as abas do seletor. */
export const ROTULO_FAMILIA: Readonly<Record<Familia, string>> = {
  imagem: 'Imagem',
  vetor: 'Vetor',
  documento: 'Documento',
  apresentacao: 'Apresentação',
  ebook: 'E-book',
  audio: 'Áudio',
  video: 'Vídeo',
  arquivo: 'Compactado',
  fonte: 'Fonte',
  cad: 'CAD e 3D',
};

/* ==================== índices ==================== */

const PORCHAVE = new Map<string, Formato>();
for (const f of FORMATOS) {
  PORCHAVE.set(f.ext, f);
  for (const apelido of f.apelidos ?? []) PORCHAVE.set(apelido, f);
}

/**
 * Encontra o formato por extensão ou apelido. Aceita ponto na frente, maiúscula e espaço em
 * volta, porque tudo isso chega de nome de arquivo real.
 */
export function formatoDe(ext: string): Formato | undefined {
  return PORCHAVE.get(ext.trim().toLowerCase().replace(/^\./, ''));
}

/** A extensão canônica de um apelido: `formatoDe('JPEG')` canônico é `jpg`. */
export function extCanonica(ext: string): string | undefined {
  return formatoDe(ext)?.ext;
}

/**
 * Deduz o formato a partir do nome do arquivo. Cuida do caso `.tar.gz`, em que a extensão
 * simples mentiria (`gz` sozinho é um fluxo só, `tar.gz` é um pacote).
 */
export function formatoDoNome(nome: string): Formato | undefined {
  const limpo = nome.trim().toLowerCase();
  if (limpo.endsWith('.tar.gz') || limpo.endsWith('.tgz')) return formatoDe('gz');
  if (limpo.endsWith('.tar.bz2')) return formatoDe('bz2');
  if (limpo.endsWith('.tar.xz')) return formatoDe('xz');
  const ponto = limpo.lastIndexOf('.');
  return ponto < 0 ? undefined : formatoDe(limpo.slice(ponto + 1));
}

export function formatosDaFamilia(familia: Familia): readonly Formato[] {
  return FORMATOS.filter((f) => f.familia === familia);
}
