import { FORMATOS, formatoDe } from './formatos.js';
import type { Aresta, Capacidades, Familia, Formato, MotivoAusencia } from './tipos.js';

/**
 * O grafo de conversões, do lado de quem consulta.
 *
 * O servidor monta as arestas e as manda em `/api/capacidades`; a interface embrulha nisto e
 * pergunta as três coisas de que precisa: quais destinos existem para esta origem, este destino
 * está disponível, e se não está, por quê.
 *
 * Não há busca de caminho com mais de um salto aqui, e é de propósito. Uma cadeia
 * `heic → png → svg` parece atraente no papel, mas cada salto perde alguma coisa, e o usuário
 * levaria a culpa por uma escolha que a aplicação fez escondida. Quando uma cadeia dessas
 * valer a pena, ela entra como aresta explícita, com nome e diagnóstico próprios.
 */
export class Grafo {
  private readonly porOrigem = new Map<string, Aresta[]>();

  constructor(private readonly arestas: readonly Aresta[]) {
    for (const a of arestas) {
      let lista = this.porOrigem.get(a.de);
      if (!lista) this.porOrigem.set(a.de, (lista = []));
      lista.push(a);
    }
  }

  static de(capacidades: Capacidades): Grafo {
    return new Grafo(capacidades.arestas);
  }

  /** Toda aresta que sai desta origem, disponível ou não. */
  saidasDe(de: string): readonly Aresta[] {
    const canonica = formatoDe(de)?.ext;
    return canonica ? (this.porOrigem.get(canonica) ?? []) : [];
  }

  /** A aresta escolhida para este par. Quando há mais de uma, a disponível ganha. */
  aresta(de: string, para: string): Aresta | undefined {
    const alvo = formatoDe(para)?.ext;
    if (!alvo) return undefined;
    const candidatas = this.saidasDe(de).filter((a) => a.para === alvo);
    return candidatas.find((a) => a.disponivel) ?? candidatas[0];
  }

  podeConverter(de: string, para: string): boolean {
    return this.aresta(de, para)?.disponivel === true;
  }

  porQueNao(de: string, para: string): MotivoAusencia | undefined {
    const a = this.aresta(de, para);
    if (!a) {
      return {
        tipo: 'nao-implementada',
        marco: `Nenhuma engine converte ${de.toUpperCase()} para ${para.toUpperCase()}.`,
      };
    }
    return a.disponivel ? undefined : a.ausencia;
  }

  /**
   * Os destinos possíveis a partir desta origem, agrupados por família e prontos para as abas
   * do seletor.
   *
   * A família de origem vem primeiro na ordem: converter PNG para outra imagem é o caso comum,
   * e a aba certa já precisa estar aberta quando o seletor abre. Dentro de cada família, os
   * destinos disponíveis vêm antes dos indisponíveis; fora isso, mantém-se a ordem do catálogo,
   * que é a ordem de uso na prática.
   */
  destinosPorFamilia(de: string): readonly { familia: Familia; destinos: readonly DestinoUI[] }[] {
    const origem = formatoDe(de);
    const saidas = this.saidasDe(de);
    const porAresta = new Map<string, Aresta>();
    for (const a of saidas) {
      const anterior = porAresta.get(a.para);
      if (!anterior || (a.disponivel && !anterior.disponivel)) porAresta.set(a.para, a);
    }

    const grupos = new Map<Familia, DestinoUI[]>();
    for (const f of FORMATOS) {
      const a = porAresta.get(f.ext);
      if (!a) continue;
      // Converter para o mesmo formato não é conversão; se a intenção é recomprimir ou
      // redimensionar, isso são as opções, não o destino.
      if (origem && f.ext === origem.ext) continue;
      let lista = grupos.get(f.familia);
      if (!lista) grupos.set(f.familia, (lista = []));
      lista.push({
        formato: f,
        engine: a.engine,
        disponivel: a.disponivel,
        ...(a.ausencia ? { ausencia: a.ausencia } : {}),
      });
    }

    const ordenadas = [...grupos.entries()].map(([familia, destinos]) => ({
      familia,
      destinos: [...destinos].sort((x, y) => Number(y.disponivel) - Number(x.disponivel)),
    }));

    // A família da origem primeiro; o resto na ordem do catálogo.
    const peso = (f: Familia) => (origem && f === origem.familia ? -1 : FAMILIA_ORDEM.indexOf(f));
    return ordenadas.sort((x, y) => peso(x.familia) - peso(y.familia));
  }

  /**
   * O destino que a interface deve pré-selecionar quando o arquivo entra na fila.
   *
   * Isto poupa o clique mais frequente. As preferências estão em `PREFERIDO` e cada uma tem
   * motivo anotado — a regra geral, quando não há preferência, é o primeiro destino disponível
   * na família da própria origem.
   */
  destinoSugerido(de: string): string | undefined {
    const origem = formatoDe(de);
    if (!origem) return undefined;

    const preferido = PREFERIDO[origem.ext];
    if (preferido && this.podeConverter(origem.ext, preferido)) return preferido;

    const grupos = this.destinosPorFamilia(origem.ext);
    const mesmaFamilia = grupos.find((g) => g.familia === origem.familia);
    const escolhe = (g: { destinos: readonly DestinoUI[] } | undefined) =>
      g?.destinos.find((d) => d.disponivel)?.formato.ext;
    return escolhe(mesmaFamilia) ?? grupos.map(escolhe).find(Boolean);
  }
}

export interface DestinoUI {
  readonly formato: Formato;
  readonly engine: string;
  readonly disponivel: boolean;
  readonly ausencia?: MotivoAusencia;
}

const FAMILIA_ORDEM: readonly Familia[] = FORMATOS.reduce<Familia[]>((acc, f) => {
  if (!acc.includes(f.familia)) acc.push(f.familia);
  return acc;
}, []);

/**
 * Destino pré-selecionado por origem, com o motivo de cada escolha.
 *
 * Só entra aqui o par em que a intenção do usuário é previsível o bastante para valer adivinhar.
 * Na dúvida, fica de fora e a regra geral resolve.
 */
const PREFERIDO: Readonly<Record<string, string>> = {
  // Quem sobe HEIC quase sempre quer um arquivo que abra fora da Apple.
  heic: 'jpg',
  // Captura de tela em PNG pesa demais para anexar; WebP é o corte óbvio sem perder o alfa.
  png: 'webp',
  // Foto em JPEG: o ganho está em recomprimir para um formato moderno.
  jpg: 'webp',
  // RAW pede revelação para algo visível.
  raw: 'jpg',
  // TIFF de digitalização costuma virar PDF, não outra imagem.
  tiff: 'pdf',
  // Documento e apresentação: o destino é quase sempre PDF, para enviar a alguém.
  docx: 'pdf',
  doc: 'pdf',
  odt: 'pdf',
  xlsx: 'pdf',
  pptx: 'pdf',
  odp: 'pdf',
  md: 'pdf',
  // E-book: EPUB é o padrão aberto e o que mais leitor abre.
  mobi: 'epub',
  azw3: 'epub',
  // Áudio e vídeo: o destino é o que toca em qualquer aparelho.
  flac: 'mp3',
  wav: 'mp3',
  wma: 'mp3',
  m4a: 'mp3',
  mkv: 'mp4',
  avi: 'mp4',
  mov: 'mp4',
  wmv: 'mp4',
  flv: 'mp4',
  // Fonte para web: WOFF2 é o menor e o único que ainda importa.
  ttf: 'woff2',
  otf: 'woff2',
};
