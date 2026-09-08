/**
 * Um escritor de ZIP, curto e sem dependência.
 *
 * Serve para o "baixar tudo": com dez arquivos convertidos, clicar dez vezes e responder dez
 * caixas de diálogo do navegador é um trabalho que a aplicação deveria estar fazendo.
 *
 * ---
 *
 * Duas decisões explicam por que este arquivo é pequeno.
 *
 * **Não comprime — só empacota** (método 0, `store`). A saída deste conversor é quase sempre
 * dado JÁ comprimido: WebP, AVIF, JPEG, PNG. Passar Deflate por cima disso gasta tempo e
 * costuma AUMENTAR alguns bytes, porque dado comprimido é indistinguível de ruído para o
 * compressor. O SVG do vetorizador é a exceção — é texto e comprimiria bem —, mas ele é da
 * ordem de poucos kB, e complicar o empacotador inteiro por isso não se paga. Sem Deflate, este
 * arquivo não precisa de biblioteca nenhuma.
 *
 * **É ZIP64 quando precisa.** O formato original guarda tamanho e deslocamento em 32 bits, e
 * para em 4 GB. Vinte vídeos convertidos passam disso, e o modo de falhar do ZIP clássico é
 * cruel: ele grava um arquivo que ABRE e vem com o conteúdo errado, porque o deslocamento
 * estourou e voltou ao começo. Como o teto por arquivo aqui é 2 GB, dois arquivos grandes já
 * chegam perto. Os campos de 32 bits ficam saturados em 0xFFFFFFFF e a informação de verdade vai
 * nos campos extras de 64 bits, que é o que a norma manda.
 *
 * O CRC-32 é calculado de verdade. Um ZIP com CRC zerado abre em algumas ferramentas e é
 * recusado por outras, entre elas o Explorer do Windows — que é justamente onde este arquivo vai
 * cair.
 *
 * ---
 *
 * Este arquivo devolve BYTES, e nunca um `Blob`. Ele mora no núcleo, que é compartilhado com o
 * servidor, e `Blob`/`BlobPart` são tipos de DOM: importá-los aqui daria ao código de servidor
 * acesso a `document` e companhia, que é justamente o tipo de erro que o compilador deveria
 * pegar. Cada lado embrulha as partes como precisa — a web num `Blob` (ver `envelope.ts` lá), o
 * servidor gravando parte por parte no disco.
 */

/**
 * `Uint8Array<ArrayBuffer>`, e nao `Uint8Array` simples.
 *
 * Do TypeScript 5.7 em diante o tipo e generico no buffer de tras, e o padrao `ArrayBufferLike`
 * inclui `SharedArrayBuffer` — que o construtor de `Blob` nao aceita. Fixar `ArrayBuffer` diz o
 * que este arquivo de fato usa e faz o erro aparecer em quem passa a coisa errada, e nao aqui.
 */
type Bytes = Uint8Array<ArrayBuffer>;

export interface ArquivoDoZip {
  nome: string;
  dados: Bytes;
  /** Data de modificação. Sem ela, o ZIP fica com a data do começo dos tempos do DOS. */
  data?: Date;
}

const METODO_STORE = 0;
const SATURADO_32 = 0xffffffff;
const MAX_16 = 0xffff;
/** Acima disto, o campo de 32 bits não serve mais e o ZIP64 entra. */
const LIMITE_ZIP64 = 0xfffffffe;

/**
 * Monta o pacote e devolve as PARTES, na ordem, sem concatenar.
 *
 * Devolver partes em vez de um `Blob` é o que deixa este arquivo servir aos dois lados. No
 * navegador, o construtor de `Blob` junta as partes sem copiar — daí `montaZip` logo abaixo. No
 * servidor não existe motivo para materializar o pacote inteiro na memória: as partes vão para o
 * disco uma a uma, e um pacote de dez páginas de PDF em PNG pode passar de centenas de megabytes.
 */
export function montaZipPartes(arquivos: readonly ArquivoDoZip[]): Bytes[] {
  const pedacos: Bytes[] = [];
  const centrais: Bytes[] = [];
  let deslocamento = 0;

  for (const arquivo of arquivos) {
    const nome = new TextEncoder().encode(arquivo.nome);
    const crc = crc32(arquivo.dados);
    const tamanho = arquivo.dados.length;
    const { hora, dia } = dataDos(arquivo.data ?? new Date());
    const precisaZip64 = tamanho > LIMITE_ZIP64 || deslocamento > LIMITE_ZIP64;

    /* ---------- cabeçalho local ---------- */
    const extraLocal = precisaZip64 ? extraZip64(tamanho, tamanho) : new Uint8Array(0);
    const local = new Uint8Array(30 + nome.length + extraLocal.length);
    const vl = new DataView(local.buffer);
    vl.setUint32(0, 0x04034b50, true); // assinatura
    // Versão mínima 4.5 quando há ZIP64; 2.0 basta para o resto. Declarar menos do que se usa
    // faz o extrator recusar o arquivo.
    vl.setUint16(4, precisaZip64 ? 45 : 20, true);
    // Bit 11: o nome está em UTF-8. Sem ele, "coração.webp" abre com o nome corrompido.
    vl.setUint16(6, 0x0800, true);
    vl.setUint16(8, METODO_STORE, true);
    vl.setUint16(10, hora, true);
    vl.setUint16(12, dia, true);
    vl.setUint32(14, crc, true);
    vl.setUint32(18, precisaZip64 ? SATURADO_32 : tamanho, true); // comprimido
    vl.setUint32(22, precisaZip64 ? SATURADO_32 : tamanho, true); // original
    vl.setUint16(26, nome.length, true);
    vl.setUint16(28, extraLocal.length, true);
    local.set(nome, 30);
    local.set(extraLocal, 30 + nome.length);

    pedacos.push(local, arquivo.dados);

    /* ---------- entrada do diretório central ---------- */
    const extraCentral = precisaZip64
      ? extraZip64(tamanho, tamanho, deslocamento)
      : new Uint8Array(0);
    const central = new Uint8Array(46 + nome.length + extraCentral.length);
    const vc = new DataView(central.buffer);
    vc.setUint32(0, 0x02014b50, true);
    vc.setUint16(4, precisaZip64 ? 45 : 20, true); // versão que criou
    vc.setUint16(6, precisaZip64 ? 45 : 20, true); // versão necessária
    vc.setUint16(8, 0x0800, true);
    vc.setUint16(10, METODO_STORE, true);
    vc.setUint16(12, hora, true);
    vc.setUint16(14, dia, true);
    vc.setUint32(16, crc, true);
    vc.setUint32(20, precisaZip64 ? SATURADO_32 : tamanho, true);
    vc.setUint32(24, precisaZip64 ? SATURADO_32 : tamanho, true);
    vc.setUint16(28, nome.length, true);
    vc.setUint16(30, extraCentral.length, true);
    vc.setUint32(42, precisaZip64 ? SATURADO_32 : deslocamento, true);
    central.set(nome, 46);
    central.set(extraCentral, 46 + nome.length);
    centrais.push(central);

    deslocamento += local.length + tamanho;
  }

  /* ---------- diretório central e fecho ---------- */
  const inicioCentral = deslocamento;
  let tamanhoCentral = 0;
  for (const c of centrais) {
    pedacos.push(c);
    tamanhoCentral += c.length;
  }

  const precisaZip64Final =
    arquivos.length > MAX_16 || inicioCentral > LIMITE_ZIP64 || tamanhoCentral > LIMITE_ZIP64;

  if (precisaZip64Final) {
    // Registro de fim do diretório central em ZIP64, mais o localizador dele. O fecho clássico
    // continua obrigatório depois, com os campos saturados: é ele que os extratores procuram
    // primeiro, varrendo o fim do arquivo.
    const fim64 = new Uint8Array(56);
    const v = new DataView(fim64.buffer);
    v.setUint32(0, 0x06064b50, true);
    v.setBigUint64(4, 44n, true); // tamanho deste registro, menos os 12 primeiros bytes
    v.setUint16(12, 45, true);
    v.setUint16(14, 45, true);
    v.setUint32(16, 0, true); // este disco
    v.setUint32(20, 0, true); // disco do diretório central
    v.setBigUint64(24, BigInt(arquivos.length), true);
    v.setBigUint64(32, BigInt(arquivos.length), true);
    v.setBigUint64(40, BigInt(tamanhoCentral), true);
    v.setBigUint64(48, BigInt(inicioCentral), true);

    const loc = new Uint8Array(20);
    const vloc = new DataView(loc.buffer);
    vloc.setUint32(0, 0x07064b50, true);
    vloc.setUint32(4, 0, true);
    vloc.setBigUint64(8, BigInt(inicioCentral + tamanhoCentral), true);
    vloc.setUint32(16, 1, true); // total de discos

    pedacos.push(fim64, loc);
  }

  const fim = new Uint8Array(22);
  const vf = new DataView(fim.buffer);
  vf.setUint32(0, 0x06054b50, true);
  vf.setUint16(8, precisaZip64Final ? MAX_16 : arquivos.length, true);
  vf.setUint16(10, precisaZip64Final ? MAX_16 : arquivos.length, true);
  vf.setUint32(12, precisaZip64Final ? SATURADO_32 : tamanhoCentral, true);
  vf.setUint32(16, precisaZip64Final ? SATURADO_32 : inicioCentral, true);
  pedacos.push(fim);

  return pedacos;
}


/** Campo extra 0x0001 do ZIP64: os tamanhos de verdade, em 64 bits. */
function extraZip64(original: number, comprimido: number, deslocamento?: number): Bytes {
  const corpo = deslocamento === undefined ? 16 : 24;
  const e = new Uint8Array(4 + corpo);
  const v = new DataView(e.buffer);
  v.setUint16(0, 0x0001, true);
  v.setUint16(2, corpo, true);
  v.setBigUint64(4, BigInt(original), true);
  v.setBigUint64(12, BigInt(comprimido), true);
  if (deslocamento !== undefined) v.setBigUint64(20, BigInt(deslocamento), true);
  return e;
}

/**
 * Data e hora no formato do MS-DOS, que é o que o ZIP guarda.
 *
 * O ano é contado de 1980 e vive em 7 bits; os segundos vão em passos de 2. É o formato de 1989
 * e não há alternativa dentro do ZIP clássico. Antes de 1980 satura em 1980 — a data de um
 * arquivo convertido agora não vai ser essa, mas relógio errado acontece, e um ano negativo
 * escreveria lixo no campo.
 */
function dataDos(d: Date): { hora: number; dia: number } {
  const ano = Math.max(1980, d.getFullYear());
  return {
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    dia: ((ano - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * CRC-32, o do ZIP (polinômio 0xEDB88320, refletido).
 *
 * A tabela é montada uma vez, na primeira chamada. Sem tabela, o cálculo bit a bit é oito vezes
 * mais lento, e isto roda sobre cada byte de cada arquivo do pacote.
 */
let tabelaCrc: Uint32Array | undefined;

function crc32(dados: Bytes): number {
  if (!tabelaCrc) {
    tabelaCrc = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tabelaCrc[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < dados.length; i++) {
    crc = tabelaCrc[(crc ^ dados[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Resolve o choque de nomes dentro do pacote.
 *
 * Converter `foto.png` e `foto.jpg` para WebP dá dois `foto.webp`. Um ZIP aceita nomes
 * repetidos — a norma não proíbe —, mas o extrator então sobrescreve um com o outro em silêncio,
 * e o usuário perde um arquivo sem nunca saber. O sufixo entre parênteses é a convenção que o
 * Windows e o macOS já usam para isto, então o resultado não surpreende ninguém.
 */
export function nomesUnicos(nomes: readonly string[]): string[] {
  const vistos = new Map<string, number>();
  return nomes.map((nome) => {
    const chave = nome.toLowerCase();
    const quantos = vistos.get(chave) ?? 0;
    vistos.set(chave, quantos + 1);
    if (quantos === 0) return nome;
    const ponto = nome.lastIndexOf('.');
    return ponto <= 0
      ? `${nome} (${quantos})`
      : `${nome.slice(0, ponto)} (${quantos})${nome.slice(ponto)}`;
  });
}
