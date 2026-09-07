import { FORMATOS, formatosDaFamilia, type Aresta, type EngineDescrita, type Familia } from '@conversor/nucleo';

/**
 * As engines que ainda não existem.
 *
 * Este arquivo é o motivo de o seletor ter dez abas desde o primeiro dia. Ele declara as arestas
 * que a aplicação AINDA NÃO faz, todas com `disponivel: false` e o marco em que chegam.
 *
 * Por que declarar em vez de omitir: quem chega procurando MP4 → MP3 precisa de uma resposta.
 * "Chega no marco 3" é uma resposta. Uma aba de áudio vazia, ou pior, a ausência da aba, faz a
 * pessoa concluir que a aplicação não serve e fechar — sem saber que ela serve para outra coisa
 * hoje e serviria para esta amanhã.
 *
 * Quando uma engine de verdade entra, ela é removida daqui e o `todas.ts` passa a listá-la.
 * As arestas reais têm precedência: o `Grafo` do núcleo escolhe a aresta disponível quando há
 * mais de uma para o mesmo par.
 */

interface EnginePlanejada {
  readonly id: string;
  readonly nome: string;
  readonly descricao: string;
  readonly marco: string;
  /** Converte de qualquer formato destas famílias... */
  readonly de: readonly Familia[];
  /** ...para qualquer formato destas. */
  readonly para: readonly Familia[];
  /** Pares extras que fogem do produto das famílias. */
  readonly extras?: readonly (readonly [string, string])[];
}

const PLANEJADAS: readonly EnginePlanejada[] = [
  {
    id: 'documento',
    nome: 'LibreOffice',
    descricao:
      'Converte documento, planilha e apresentação. É o único conversor honesto de DOCX e ' +
      'XLSX porque é o único que implementa o formato inteiro, e não uma aproximação dele.',
    marco: 'marco 2',
    de: ['documento', 'apresentacao'],
    para: ['documento', 'apresentacao'],
    extras: [
      ['docx', 'pdf'],
      ['doc', 'pdf'],
      ['odt', 'pdf'],
      ['rtf', 'pdf'],
      ['txt', 'pdf'],
      ['md', 'pdf'],
      ['html', 'pdf'],
      ['xlsx', 'pdf'],
      ['xls', 'pdf'],
      ['ods', 'pdf'],
      ['csv', 'pdf'],
      ['pptx', 'pdf'],
      ['ppt', 'pdf'],
      ['odp', 'pdf'],
    ],
  },
  {
    id: 'pdf',
    nome: 'Ghostscript e pdfium',
    descricao:
      'Rasteriza página de PDF em imagem, e monta PDF a partir de imagem. Também é o que ' +
      'comprime PDF sem estragar o texto.',
    marco: 'marco 2',
    de: [],
    para: [],
    extras: [
      ['pdf', 'png'],
      ['pdf', 'jpg'],
      ['pdf', 'webp'],
      ['pdf', 'tiff'],
      ['pdf', 'svg'],
      ['png', 'pdf'],
      ['jpg', 'pdf'],
      ['tiff', 'pdf'],
      ['webp', 'pdf'],
      ['heic', 'pdf'],
      ['svg', 'pdf'],
      ['eps', 'pdf'],
      ['pdf', 'eps'],
      ['ai', 'pdf'],
      ['ai', 'svg'],
      ['eps', 'svg'],
      ['cdr', 'svg'],
      ['emf', 'svg'],
    ],
  },
  {
    id: 'midia',
    nome: 'ffmpeg',
    descricao:
      'Converte áudio e vídeo. Relata quadro por quadro enquanto trabalha, então aqui a barra ' +
      'de progresso fica fina de verdade — é a engine em que ela vai ficar mais bonita.',
    marco: 'marco 3',
    de: ['audio', 'video'],
    para: ['audio', 'video'],
    extras: [
      ['video', 'gif'],
      ['mp4', 'gif'],
      ['mov', 'gif'],
      ['webm', 'gif'],
      ['mkv', 'gif'],
      ['gif', 'mp4'],
      ['gif', 'webm'],
      ['mp4', 'png'],
      ['mov', 'png'],
    ],
  },
  {
    id: 'ebook',
    nome: 'Calibre',
    descricao: 'Converte e-book entre formatos, refluindo o texto e remontando o sumário.',
    marco: 'marco 4',
    de: ['ebook'],
    para: ['ebook'],
    extras: [
      ['epub', 'pdf'],
      ['mobi', 'pdf'],
      ['azw3', 'pdf'],
      ['pdf', 'epub'],
      ['docx', 'epub'],
      ['html', 'epub'],
      ['md', 'epub'],
      ['epub', 'txt'],
      ['epub', 'docx'],
    ],
  },
  {
    id: 'compactado',
    nome: '7-Zip',
    descricao: 'Recompacta pacote entre formatos, sem descompactar em disco no meio do caminho.',
    marco: 'marco 4',
    de: ['arquivo'],
    para: ['arquivo'],
  },
  {
    id: 'fonte',
    nome: 'fontTools',
    descricao: 'Converte fonte entre formatos e comprime para a web.',
    marco: 'marco 4',
    de: ['fonte'],
    para: ['fonte'],
    extras: [
      ['ttf', 'svg'],
      ['otf', 'svg'],
    ],
  },
  {
    id: 'cad',
    nome: 'Open Design e assimp',
    descricao: 'Converte desenho de CAD e malha 3D entre formatos.',
    marco: 'marco 5',
    de: ['cad'],
    para: ['cad'],
    extras: [
      ['dxf', 'svg'],
      ['dwg', 'svg'],
      ['dxf', 'pdf'],
      ['dwg', 'pdf'],
      ['stl', 'obj'],
      ['obj', 'stl'],
    ],
  },
  {
    id: 'ocr',
    nome: 'Tesseract',
    descricao:
      'Lê o texto de imagem e de PDF digitalizado. Não é conversão de formato: é conversão de ' +
      'pixel em texto, e por isso os destinos dele são documento.',
    marco: 'marco 5',
    de: [],
    para: [],
    extras: [
      ['png', 'txt'],
      ['jpg', 'txt'],
      ['tiff', 'txt'],
      ['pdf', 'txt'],
      ['png', 'docx'],
      ['jpg', 'docx'],
      ['pdf', 'docx'],
      ['png', 'pdf'],
      ['tiff', 'pdf'],
    ],
  },
];

export function enginesPorVir(): readonly EngineDescrita[] {
  return PLANEJADAS.map((p) => ({
    id: p.id,
    nome: p.nome,
    onde: 'servidor' as const,
    descricao: p.descricao,
    disponivel: false,
    ausencia: { tipo: 'nao-implementada' as const, marco: p.marco },
  }));
}

export function arestasPorVir(): readonly Aresta[] {
  const conhecidos = new Set(FORMATOS.map((f) => f.ext));
  const arestas: Aresta[] = [];
  const vistas = new Set<string>();

  const junta = (de: string, para: string, engine: string, marco: string) => {
    if (de === para || !conhecidos.has(de) || !conhecidos.has(para)) return;
    const chave = `${de}>${para}>${engine}`;
    if (vistas.has(chave)) return;
    vistas.add(chave);
    arestas.push({
      de,
      para,
      engine,
      disponivel: false,
      ausencia: { tipo: 'nao-implementada', marco },
    });
  };

  for (const p of PLANEJADAS) {
    for (const fDe of p.de) {
      for (const fPara of p.para) {
        for (const de of formatosDaFamilia(fDe)) {
          for (const para of formatosDaFamilia(fPara)) junta(de.ext, para.ext, p.id, p.marco);
        }
      }
    }
    for (const [de, para] of p.extras ?? []) {
      // Um "extra" pode nomear uma família em vez de um formato (`['video','gif']`), o que
      // encurta muito a lista: expande para cada formato da família.
      const origens = formatosDaFamilia(de as Familia).length
        ? formatosDaFamilia(de as Familia).map((f) => f.ext)
        : [de];
      const destinos = formatosDaFamilia(para as Familia).length
        ? formatosDaFamilia(para as Familia).map((f) => f.ext)
        : [para];
      for (const o of origens) for (const d of destinos) junta(o, d, p.id, p.marco);
    }
  }
  return arestas;
}
