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
export declare function montaZip(arquivos: readonly ArquivoDoZip[]): Blob;
/**
 * Resolve o choque de nomes dentro do pacote.
 *
 * Converter `foto.png` e `foto.jpg` para WebP dá dois `foto.webp`. Um ZIP aceita nomes
 * repetidos — a norma não proíbe —, mas o extrator então sobrescreve um com o outro em silêncio,
 * e o usuário perde um arquivo sem nunca saber. O sufixo entre parênteses é a convenção que o
 * Windows e o macOS já usam para isto, então o resultado não surpreende ninguém.
 */
export declare function nomesUnicos(nomes: readonly string[]): string[];
export {};
//# sourceMappingURL=zip.d.ts.map